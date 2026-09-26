import { Elm327Session, ElmSessionError, type ElmResponse, type SendOptions } from "obd-core/elm/session";
import { latin1Decode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { genericProfile, scanMode22Profile, type ObdbMode22Signal } from "obd-core/vehicles";
import { CHARGE_LOG_PROFILE, ChargeLogBuilder, chargePhases, isRecoveryGap, MAX_GAP_S, POST_REST_S, PRE_REST_S, REST_CURRENT_A, span, type ChargePhases, type Point, type Window } from "obd-battery/session";
import type { RecordingBuffer } from "./recording.js";

// Behavior: docs/specs/T2.4-charge-logger.md §Interfaces (Stage B1), §Policy values, §Sources (init, per-cycle
// setup and reply handling), Decisions 3 and 9. Read-only: the only commands are genericProfile's init and
// scanMode22Profile(CHARGE_LOG_PROFILE), both through Elm327Session's allowlist.

// Policy values (spec §Policy values; Decision 3).
export const CYCLE_S = 5;
export const FLUSH_S = 30;
export const RECOVERY_WAIT_S = 5;
export const SILENT_STOP_S = 600;
export const WAIT_FOR_CHARGE_S = 3600;
export const MAX_RUN_S = 16 * 3600;

export interface ChargeLogDeps {
  /** First call returns the connected transport; later calls reconnect to the same device (B2 wraps connectVeepeak). Rejects on failure. */
  connect(): Promise<Transport>;
  /** Already started (meta line written by the caller). */
  recording: RecordingBuffer;
  signals: readonly ObdbMode22Signal[];
  /** Seconds, same clock as recording. */
  now(): number;
  sleep(ms: number): Promise<void>;
  /** One plain sentence, e.g. "Resting 4:12 of 10:00. Do not plug in yet." */
  onStatus(line: string): void;
  stream: StreamTargets;
  /** True once the caller wants the run to end now (Disconnect pressed). */
  stopRequested(): boolean;
}

export interface StreamTargets {
  /** Creates captures/<date>-charge-log[-N].jsonl in app storage, never overwriting; returns its name. Throws on failure. */
  create(): string;
  /** Appends to that file. Throws on failure. */
  append(name: string, text: string): void;
  /** Copies the private file into the already remembered capture folder. Never shows a picker. Rejects when no folder is remembered or the copy fails. */
  copyToFolder(name: string): Promise<void>;
}

export interface ChargeLogResult {
  /** Private name. */
  file: string;
  /** True only when a post-charge rest of POST_REST_S was logged. */
  complete: boolean;
  stopReason: string;
  /** One status sentence: saved to folder, or NOT SAVED to folder with the private path. */
  saved: string;
}

/** Decision 9 lists start, lv-reset, timeout and disconnect; "elm-error" covers any other final ELM error reply. */
type SessionReason = "start" | "lv-reset" | "timeout" | "disconnect" | "elm-error";

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** A final error reply, after core's own retry (spec §Sources: CAN ERROR once inside Elm327Session, LV RESET re-init). */
class ReplyError extends Error {
  constructor(readonly response: Extract<ElmResponse, { kind: "error" }>, command: string) {
    super(`${response.error.line} at ${command}`);
  }
}

class StopRequested extends Error {}

/** transport.write rejected: the link is gone (Decision 16: only these, not any error, are a disconnect). */
class LinkError extends Error {}

/** Each Mode 22 reply goes to the builder; an error reply ends the cycle; a stop request ends it before the next command. */
class CycleSession extends Elm327Session {
  private target = "";
  constructor(transport: Transport, private readonly deps: ChargeLogDeps, private readonly builder: ChargeLogBuilder, private readonly lastTx: () => number) {
    super(transport);
  }

  override async send(command: string, opts?: SendOptions): Promise<ElmResponse> {
    if (this.deps.stopRequested()) throw new StopRequested();
    const response = await super.send(command, opts);
    if (response.kind === "error") throw new ReplyError(response, command);
    if (command.startsWith("ATSH DA")) this.target = command.slice(7, 9);
    const did = /^22 ([0-9A-F]{4})$/.exec(command)?.[1];
    // The tx t of the attempt that was answered (after any core retry), as chargeLogFromRecording uses (Decision 15).
    if (did !== undefined) this.builder.add(this.lastTx(), this.target, did, response.frames);
    return response;
  }
}

/** Only ELM replies, session errors and link errors start a new session; any other error stops the run (Decision 16). */
function reasonFor(error: ReplyError | ElmSessionError | LinkError): Exclude<SessionReason, "start"> {
  const response = error instanceof ReplyError || error instanceof ElmSessionError ? error.response : undefined;
  if (response?.kind === "error" && response.error.kind === "lv-reset") return "lv-reset";
  if (error instanceof ElmSessionError && error.kind === "timeout") return "timeout";
  if (error instanceof ReplyError || error instanceof ElmSessionError) return "elm-error";
  return "disconnect";
}

const clock = (seconds: number) => `${String(Math.floor(seconds / 60))}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** Never rejects. Ends with a final flush, the copy to the folder, and a last meta line naming the stop reason. */
export async function runChargeLog(deps: ChargeLogDeps): Promise<ChargeLogResult> {
  const { recording, stream } = deps;
  let file: string;
  try { file = stream.create(); }
  catch (error) {
    return { file: "", complete: false, stopReason: `the log file could not be created: ${message(error)}`, saved: `NOT SAVED: ${message(error)}.` };
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
  // Called before every write, so a flush always ends after a complete exchange (spec failure mode 10).
  const maybeFlush = () => { if (deps.now() - lastFlush >= FLUSH_S) flush(); };

  const builder = new ChargeLogBuilder(file, false, deps.signals);
  let seen = 0;
  let previous: Point | undefined;
  let restRun: Window | undefined;
  // Sample times are recording times (Decision 15), so the checks against them use recording.elapsed().
  let lastCurrent = recording.elapsed();
  let preRestDoneAt: number | undefined;
  let phases: ChargePhases | undefined;
  let complete = false;
  // A function, not the variable inline: TypeScript keeps the declaration's narrowing across the closures that set it.
  const isComplete = (): boolean => complete;

  /** After each cycle: the newest current samples, the phases, and the status line. */
  const update = (): string => {
    const log = builder.log();
    for (const point of log.current.slice(seen)) {
      if (Math.abs(point.value) > REST_CURRENT_A) restRun = undefined;
      else if (restRun !== undefined && previous !== undefined && (span(previous.t, point.t) <= MAX_GAP_S || isRecoveryGap(previous.t, point.t, log.recoveries))) restRun.end = point.t;
      else restRun = { start: point.t, end: point.t };
      previous = point;
      lastCurrent = point.t;
    }
    seen = log.current.length;
    phases = chargePhases(log);
    const post = phases.postRestRun;
    complete = post !== undefined && span(post.start, post.end) >= POST_REST_S;
    if (phases.charge === undefined && preRestDoneAt === undefined && restRun !== undefined && span(restRun.start, restRun.end) >= PRE_REST_S) preRestDoneAt = restRun.end;
    if (post !== undefined) return `Charge done. Resting ${clock(span(post.start, post.end))} of ${clock(POST_REST_S)}.`;
    if (phases.charge !== undefined) return `Charging. ${clock(span(phases.charge.start, phases.charge.end))} logged.`;
    if (preRestDoneAt !== undefined) return "Plug in the charger now.";
    if (restRun !== undefined) return `Resting ${clock(span(restRun.start, restRun.end))} of ${clock(PRE_REST_S)}. Do not plug in yet.`;
    return "Waiting for the car to rest. Do not plug in yet.";
  };

  const stopFor = (): string | undefined => {
    const elapsed = recording.elapsed();
    if (deps.stopRequested()) return "disconnect pressed";
    if (complete) return "post-charge rest logged";
    if (deps.now() - start >= MAX_RUN_S) return "16 h limit reached";
    if (elapsed - lastCurrent >= SILENT_STOP_S) return "no current for 10 min";
    if (preRestDoneAt !== undefined && phases?.charge === undefined && elapsed - preRestDoneAt >= WAIT_FOR_CHARGE_S) return "no charge within 60 min after the pre-charge rest";
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

  let reason: SessionReason = "start";
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
      const session = new CycleSession(link.view, deps, builder, () => lastTx);
      let failure: unknown;
      try {
        const boundary = recording.meta({ event: "charge-log session", reason });
        // Decision 19: the live log knows the boundary as replay does, so a short recovery gap does not end a run.
        if (reason !== "start") builder.recovery(boundary);
        deps.onStatus("Starting the ELM327.");
        await session.init(genericProfile, {
          onInformationalReply(command, response) { if (response.kind === "error") throw new ReplyError(response, command); },
        });
        for (;;) {
          const cycleStart = deps.now();
          await scanMode22Profile(session, CHARGE_LOG_PROFILE);
          const status = update();
          if (stopFor() !== undefined) break;
          deps.onStatus(status);
          const wait = cycleStart + CYCLE_S - deps.now();
          if (wait > 0) await deps.sleep(wait * 1000);
        }
      } catch (error) {
        failure = error;
      } finally {
        await session.close();
      }
      if (failure === undefined || failure instanceof StopRequested) continue;
      if (!(failure instanceof ReplyError || failure instanceof ElmSessionError || failure instanceof LinkError)) {
        // Not a link error (a callback or the decoder threw): stop as partial, then save as usual (Decision 16).
        stopReason = message(failure);
        complete = false;
        break;
      }
      reason = reasonFor(failure);
      if (reason === "disconnect") { await link.close(); link = undefined; }
      deps.onStatus(`Lost the ELM327 (${message(failure)}). New session in ${String(RECOVERY_WAIT_S)} s.`);
      await deps.sleep(RECOVERY_WAIT_S * 1000);
    }
  } catch (error) {
    // A callback outside a session threw (Decision 16), handled as above.
    stopReason = message(error);
    complete = false;
  }

  await link?.close();
  recording.meta(`charge log stopped: ${stopReason} (${isComplete() ? "complete" : "partial"})`);
  flush();
  let saved: string;
  try { await stream.copyToFolder(file); saved = `Saved ${file} to the capture folder.`; }
  catch (error) { saved = `NOT SAVED to the capture folder: ${message(error)}. The log is in app storage (captures/${file}).`; }
  if (writeError !== undefined) saved = `Lines missing from captures/${file}: ${writeError}. ${saved}`;
  // Never rejects (Decision 17): the result carries the same sentence.
  try { deps.onStatus(`Charge log stopped: ${stopReason}. ${saved}`); } catch { /* the caller still gets the result */ }
  return { file, complete: isComplete(), stopReason, saved };
}
