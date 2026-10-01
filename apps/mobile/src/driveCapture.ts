import { ElmSessionError } from "obd-core/elm/session";
import { latin1Decode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { genericProfile, scanMode22Profile } from "obd-core/vehicles";
import { ChargeLogBuilder } from "obd-battery/session";
import { clock, CycleSession, FLUSH_S, LinkError, RECOVERY_WAIT_S, reasonFor, ReplyError, StopRequested, type ChargeLogDeps } from "./chargeLogger.js";

// Behavior: docs/specs/T2.12-test-drive-capture.md §Design (Stop rule, Recovery) and docs/specs/T2.13-drive-check.md §Design (Capture
// schedule, 7F 22 21, 10-minute option). Read-only: the only commands are genericProfile's init, scanMode22Profile, the three module-switch
// lines scanMode22Profile sends and bare `22 <DID>` repeats, all through Elm327Session's allowlist. The run copies runChargeLog's
// recovery, flushing and session boundaries, so chargeLogFromRecording replays the file unchanged.

// obd-core/vehicles does not export VehicleProfile and obd-core is frozen for this task, so the type is taken from its consumer.
type VehicleProfile = Parameters<typeof scanMode22Profile>[1];

// Policy values, not vehicle constants (spec §Design).
export const DRIVE_MINUTES = [10, 20] as const;
export const DRIVE_SILENT_S = 60;
export const FAST_PAIRS = 10;
/** SOC and the raw temperature change slowly: read every 10th block (about 30 s), and in block 0 (spec §Capture schedule). */
export const CONTEXT_EVERY = 10;

/** Spec §Sources: 17/2414 pack current and 17/2885 pack voltage. */
export const DRIVE_FAST_PROFILE: VehicleProfile = { protocol: "7", mode22: [{ target: "17", dids: ["2414", "2885"] }] };
/** Spec §Sources: CB/2AE1-2AE7 group voltages; CB/2AF5 cell min/max, 2B43 SOC, 2AF1 raw. */
export const GROUP_DIDS: readonly string[] = ["2AE1", "2AE2", "2AE3", "2AE4", "2AE5", "2AE6", "2AE7"];
export const CONTEXT_DIDS: readonly string[] = ["2AF5", "2B43", "2AF1"];

/**
 * The three per-module setup lines scanMode22Profile sends for a non-first module (spec §Sources); ATCP, ATFCSD and ATFCSM are not resent.
 * Evidence (spec §Sources row, A2-1): in 2026-09-23-discovery-targeted.redacted.jsonl `ATCP 18` (line 218), `ATFCSD 300000` (226) and `ATFCSM 1` (228)
 * are sent once; the CB switch at lines 505-509 resends none of them and the multi-frame reply at line 516 completes. Caveat: this shows the
 * replies complete, not that the non-default values persisted (the ELM may complete with its defaults). Stage B confirms it on the car.
 */
async function switchTo(session: CycleSession, target: string): Promise<void> {
  for (const command of [`ATSH DA${target}F1`, `ATCRA 18DAF1${target}`, `ATFCSH 18DA${target}F1`]) {
    const response = await session.send(command);
    if (response.kind !== "ok") throw new ElmSessionError("init", command, response);
  }
}

export interface DriveCaptureResult { file: string; stopReason: string; saved: string }

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Never rejects. Ends with a final flush, the copy to the folder, and a last meta line naming the stop reason. */
export async function runDriveCapture(deps: ChargeLogDeps, minutes: 10 | 20): Promise<DriveCaptureResult> {
  const { recording, stream } = deps;
  let file: string;
  try { file = stream.create(); }
  catch (error) {
    return { file: "", stopReason: `the drive file could not be created: ${message(error)}`, saved: `NOT SAVED: ${message(error)}.` };
  }

  const start = deps.now();
  let pending = "";
  let writeError: string | undefined;
  let lastFlush = start;
  const flush = () => {
    pending += recording.drain();
    lastFlush = deps.now();
    if (pending === "") return;
    try { stream.append(file, pending); pending = ""; writeError = undefined; }
    catch (error) { writeError = message(error); }
  };
  // Called before every write, so a flush always ends after a complete exchange.
  const maybeFlush = () => { if (deps.now() - lastFlush >= FLUSH_S) flush(); };

  const builder = new ChargeLogBuilder(file, false, deps.signals);
  let samples = 0;
  // Recording time of the newest decoded current sample; the silent rule is measured on the recording's own clock.
  let lastCurrent = recording.elapsed();
  const update = () => {
    const current = builder.log().current;
    samples = current.length;
    const last = current.at(-1);
    if (last !== undefined) lastCurrent = last.t;
  };
  const stopFor = (): string | undefined => {
    if (deps.stopRequested()) return "disconnect pressed";
    if (deps.now() - start >= minutes * 60) return `${String(minutes)} min recorded`;
    if (recording.elapsed() - lastCurrent >= DRIVE_SILENT_S) return "no current for 60 s (car off or not in Ready)";
    return undefined;
  };

  // One recorded link per connected transport: rx is recorded even between sessions; each session gets a view
  // whose close() leaves the transport open for the next session.
  let link: { view: Transport; close(): Promise<void> } | undefined;
  let lastTx = 0;
  const open = (transport: Transport) => {
    const listeners = new Set<(bytes: Uint8Array) => void>();
    const unsubscribe = transport.onData((bytes) => { recording.rx(bytes); listeners.forEach((cb) => { cb(bytes); }); });
    const view: Transport = {
      startsIdle: transport.startsIdle,
      async write(bytes) {
        maybeFlush();
        lastTx = recording.tx(latin1Decode(bytes));
        try { await transport.write(bytes); }
        catch (error) { throw new LinkError(message(error)); }
      },
      onData(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
      close: () => Promise.resolve(),
    };
    return { view, async close() { unsubscribe(); try { await transport.close(); } catch { /* the link is already gone */ } } };
  };

  let reason: "start" | ReturnType<typeof reasonFor> = "start";
  let stopReason: string | undefined;
  try {
    while ((stopReason = stopFor()) === undefined) {
      maybeFlush();
      if (link === undefined) {
        try { link = open(await deps.connect()); }
        catch (error) {
          deps.onStatus(`Cannot reach the dongle (${message(error)}). Retrying in ${String(RECOVERY_WAIT_S)} s.`);
          await deps.sleep(RECOVERY_WAIT_S * 1000);
          continue;
        }
      }
      // A fresh session writes only ATZ or ATI until one is answered cleanly (docs/ELM327.md §Write safety).
      const session = new CycleSession(link.view, deps, builder, () => lastTx, true);
      let failure: unknown;
      // Stops are checked after every pair and after the group block.
      // Returning true leaves the block; the loop condition then names the reason again.
      const checkpoint = (): boolean => { update(); return stopFor() !== undefined; };
      try {
        recording.meta({ event: "charge-log session", reason });
        deps.onStatus("Starting the ELM327.");
        await session.init(genericProfile, {
          onInformationalReply(command, response) { if (response.kind === "error") throw new ReplyError(response, command); },
        });
        block: {
          await scanMode22Profile(session, DRIVE_FAST_PROFILE);
          if (checkpoint()) break block;
          // The header stays DA17F1 until switchTo changes it, so the bare pairs carry no setup. Block 0 follows the pair above.
          for (let b = 0; ; b++) {
            for (let pair = b === 0 ? 1 : 0; pair < FAST_PAIRS; pair++) {
              await session.send("22 2414");
              await session.send("22 2885");
              if (checkpoint()) break block;
            }
            if (b % CONTEXT_EVERY === 0) {
              await switchTo(session, "CB");
              for (const did of CONTEXT_DIDS) await session.send(`22 ${did}`);
              await switchTo(session, "17");
            }
            await session.send("22 2414");
            await switchTo(session, "CB");
            for (const did of GROUP_DIDS) await session.send(`22 ${did}`);
            await switchTo(session, "17");
            if (checkpoint()) break block;
            deps.onStatus(`Test drive: ${clock(deps.now() - start)} of ${clock(minutes * 60)} recorded; ${String(samples)} current samples.`);
          }
        }
      } catch (error) {
        failure = error;
      } finally {
        await session.close();
      }
      if (failure === undefined || failure instanceof StopRequested) continue;
      if (!(failure instanceof ReplyError || failure instanceof ElmSessionError || failure instanceof LinkError)) {
        // Not a link error (a callback or the decoder threw): stop and save as usual (T2.4 Decision 16).
        stopReason = message(failure);
        break;
      }
      // The unanswered tx has no '>'; recordings.test.ts (`timedOut`) needs this marker to replay the file.
      if (failure instanceof LinkError || (failure instanceof ElmSessionError && failure.kind === "timeout")) recording.meta(`timeout waiting for '>' (${message(failure)})`);
      update();
      reason = reasonFor(failure);
      if (reason === "disconnect") { await link.close(); link = undefined; }
      deps.onStatus(`Lost the ELM327 (${message(failure)}). New session in ${String(RECOVERY_WAIT_S)} s.`);
      await deps.sleep(RECOVERY_WAIT_S * 1000);
    }
  } catch (error) {
    // A callback outside a session threw (T2.4 Decision 16), handled as above.
    stopReason = message(error);
  }

  await link?.close();
  recording.meta(`test drive stopped: ${stopReason}`);
  flush();
  let saved: string;
  try { await stream.copyToFolder(file); saved = `Saved ${file} to the capture folder.`; }
  catch (error) { saved = `NOT SAVED to the capture folder: ${message(error)}. The recording is in app storage (captures/${file}).`; }
  if (writeError !== undefined) saved = `Lines missing from captures/${file}: ${writeError}. ${saved}`;
  // Never rejects: the result carries the same sentence.
  try { deps.onStatus(`Test drive stopped: ${stopReason}. ${saved}`); } catch { /* the caller still gets the result */ }
  return { file, stopReason, saved };
}
