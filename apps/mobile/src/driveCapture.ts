import { Elm327Session, ElmSessionError } from "obd-core/elm/session";
import { latin1Decode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { genericProfile, scanMode22Profile } from "obd-core/vehicles";
import { ChargeLogBuilder } from "obd-battery/session";
import { CODES_SCAN_COMMANDS, codesScanStop } from "./codesScan.js";
import { clock, CycleSession, FLUSH_S, LinkError, RECOVERY_WAIT_S, reasonFor, ReplyError, StopRequested, type ChargeLogDeps } from "./chargeLogger.js";

type VehicleProfile = Parameters<typeof scanMode22Profile>[1];

export const DRIVE_MINUTES = [10, 20] as const;
export const DRIVE_SILENT_S = 60;
export const FAST_PAIRS = 10;
export const CONTEXT_EVERY = 10;

export const DRIVE_FAST_PROFILE: VehicleProfile = { protocol: "7", mode22: [{ target: "17", dids: ["2414", "2885"] }] };
export const GROUP_DIDS: readonly string[] = ["2AE1", "2AE2", "2AE3", "2AE4", "2AE5", "2AE6", "2AE7"];
export const CONTEXT_DIDS: readonly string[] = ["2AF5", "2B43", "2AF1"];

async function switchTo(session: CycleSession, target: string): Promise<void> {
  for (const command of [`ATSH DA${target}F1`, `ATCRA 18DAF1${target}`, `ATFCSH 18DA${target}F1`]) {
    const response = await session.send(command);
    if (response.kind !== "ok") throw new ElmSessionError("init", command, response);
  }
}

export interface DriveCaptureResult { file: string; stopReason: string; saved: string; rescan: "ran" | "not run" }

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

async function rescanCodes(view: Transport, recording: ChargeLogDeps["recording"]): Promise<void> {
  recording.meta({ event: "codes rescan" });
  const session = new Elm327Session(view);
  try {
    for (const command of CODES_SCAN_COMMANDS) {
      const response = await session.send(command, { retry: false });
      const stop = codesScanStop(command, response.kind === "error" ? `error: ${response.error.kind}` : response.kind);
      if (stop !== undefined) { recording.meta({ event: "codes rescan stopped", reason: stop }); return; }
    }
  } catch (error) {
    recording.meta({ event: "codes rescan stopped", reason: message(error) });
  } finally {
    await session.close();
  }
}

/** Never rejects. Ends with a final flush, the copy to the folder, and a last meta line naming the stop reason. */
export async function runDriveCapture(deps: ChargeLogDeps, minutes: 10 | 20): Promise<DriveCaptureResult> {
  const { recording, stream } = deps;
  let file: string;
  try { file = stream.create(); }
  catch (error) {
    return { file: "", stopReason: `the drive file could not be created: ${message(error)}`, saved: `NOT SAVED: ${message(error)}.`, rescan: "not run" };
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
  const maybeFlush = () => { if (deps.now() - lastFlush >= FLUSH_S) flush(); };

  const builder = new ChargeLogBuilder(file, false, deps.signals);
  let samples = 0;
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
    return { view, async close() { unsubscribe(); try { await transport.close(); } catch { } } };
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
      const session = new CycleSession(link.view, deps, builder, () => lastTx, true);
      let failure: unknown;
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
        stopReason = message(failure);
        break;
      }
      if (failure instanceof LinkError || (failure instanceof ElmSessionError && failure.kind === "timeout")) recording.meta(`timeout waiting for '>' (${message(failure)})`);
      update();
      reason = reasonFor(failure);
      if (reason === "disconnect") { await link.close(); link = undefined; }
      deps.onStatus(`Lost the ELM327 (${message(failure)}). New session in ${String(RECOVERY_WAIT_S)} s.`);
      await deps.sleep(RECOVERY_WAIT_S * 1000);
    }
  } catch (error) {
    stopReason = message(error);
  }

  const rescan = link !== undefined && (stopReason === `${String(minutes)} min recorded` || stopReason === "disconnect pressed");
  if (link !== undefined && rescan) await rescanCodes(link.view, recording);
  await link?.close();
  recording.meta(`test drive stopped: ${stopReason}`);
  flush();
  let saved: string;
  try { await stream.copyToFolder(file); saved = `Saved ${file} to the capture folder.`; }
  catch (error) { saved = `NOT SAVED to the capture folder: ${message(error)}. The recording is in app storage (captures/${file}).`; }
  if (writeError !== undefined) saved = `Lines missing from captures/${file}: ${writeError}. ${saved}`;
  try { deps.onStatus(`Test drive stopped: ${stopReason}. ${saved}`); } catch { }
  return { file, stopReason, saved, rescan: rescan ? "ran" : "not run" };
}
