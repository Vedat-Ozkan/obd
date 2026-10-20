import { Elm327Session, ElmSessionError, type ElmResponse, type SendOptions } from "obd-core/elm/session";
import { latin1Decode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { genericProfile, scanMode22Profile, type ObdbMode22Signal } from "obd-core/vehicles";
import { bridgedRecoveries, CHARGE_CURRENT_A, CHARGE_LOG_PROFILE, ChargeLogBuilder, chargePhases, CYCLE_S, gateFailures, isRecoveryGap, MAX_GAP_S, POST_REST_S, PRE_REST_S, REST_CURRENT_A, span, TRANSITION_S, type ChargePhases, type Point, type Window } from "obd-battery/session";
import type { RecordingBuffer } from "./recording.js";

export const FLUSH_S = 30;
export const RECOVERY_WAIT_S = 5;
export const SILENT_STOP_S = 600;
export const WAIT_FOR_CHARGE_S = 3600;
export const MAX_RUN_S = 16 * 3600;

export interface ChargeLogDeps {
  connect(): Promise<Transport>;
  recording: RecordingBuffer;
  signals: readonly ObdbMode22Signal[];
  now(): number;
  sleep(ms: number): Promise<void>;
  onStatus(line: string): void;
  stream: StreamTargets;
  stopRequested(): boolean;
}

export interface StreamTargets {
  create(): string;
  append(name: string, text: string): void;
  copyToFolder(name: string): Promise<void>;
}

export interface ChargeLogResult {
  file: string;
  complete: boolean;
  stopReason: string;
  saved: string;
}

type SessionReason = "start" | "lv-reset" | "timeout" | "disconnect" | "elm-error";

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class ReplyError extends Error {
  constructor(readonly response: Extract<ElmResponse, { kind: "error" }>, command: string) {
    super(`${response.error.line} at ${command}`);
  }
}

export class StopRequested extends Error {}

export class LinkError extends Error {}

export class CycleSession extends Elm327Session {
  private target = "";
  constructor(transport: Transport, private readonly deps: ChargeLogDeps, private readonly builder: ChargeLogBuilder, private readonly lastTx: () => number, private readonly resendNrc21 = false) {
    super(transport);
  }

  override async send(command: string, opts?: SendOptions): Promise<ElmResponse> {
    if (this.deps.stopRequested()) throw new StopRequested();
    const did = /^22 ([0-9A-F]{4})$/.exec(command)?.[1];
    let response = await super.send(command, opts);
    if (response.kind === "error") throw new ReplyError(response, command);
    if (this.resendNrc21 && did !== undefined && response.frames.some((f) => f.negative?.service === 0x22 && f.negative.code === 0x21)) {
      response = await super.send(command, opts);
      if (response.kind === "error") throw new ReplyError(response, command);
    }
    if (command.startsWith("ATSH DA")) this.target = command.slice(7, 9);
    if (did !== undefined) this.builder.add(this.lastTx(), this.target, did, response.frames);
    return response;
  }
}

export function reasonFor(error: ReplyError | ElmSessionError | LinkError): Exclude<SessionReason, "start"> {
  const response = error instanceof ReplyError || error instanceof ElmSessionError ? error.response : undefined;
  if (response?.kind === "error" && response.error.kind === "lv-reset") return "lv-reset";
  if (error instanceof ElmSessionError && error.kind === "timeout") return "timeout";
  if (error instanceof ReplyError || error instanceof ElmSessionError) return "elm-error";
  return "disconnect";
}

export const clock = (seconds: number) => `${String(Math.floor(seconds / 60))}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

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
  const maybeFlush = () => { if (deps.now() - lastFlush >= FLUSH_S) flush(); };

  const builder = new ChargeLogBuilder(file, false, deps.signals);
  let seen = 0;
  let previous: Point | undefined;
  let restRun: Window | undefined;
  let lastCurrent = recording.elapsed();
  let preRestDoneAt: number | undefined;
  let phases: ChargePhases | undefined;
  let complete = false;
  let lastCharging: number | undefined;
  let unpassable: string | undefined;
  let gateFailed: string[] = [];
  const isComplete = (): boolean => complete;

  const update = (): string => {
    const log = builder.log();
    const bridged = bridgedRecoveries(log.current, log.recoveries);
    for (const point of log.current.slice(seen)) {
      if (Math.abs(point.value) > REST_CURRENT_A) restRun = undefined;
      else if (restRun !== undefined && previous !== undefined && (span(previous.t, point.t) <= MAX_GAP_S || isRecoveryGap(previous.t, point.t, bridged))) restRun.end = point.t;
      else restRun = { start: point.t, end: point.t };
      if (point.value <= -CHARGE_CURRENT_A) lastCharging = point.t;
      previous = point;
      lastCurrent = point.t;
    }
    seen = log.current.length;
    phases = chargePhases(log);
    const post = phases.postRestRun;
    const logged = post !== undefined && span(post.start, post.end) >= POST_REST_S;
    gateFailed = logged ? gateFailures(phases) : [];
    complete = logged && gateFailed.length === 0;
    const last = log.current.at(-1);
    unpassable = phases.charge === undefined ? undefined
      : post === undefined
        ? last !== undefined && lastCharging !== undefined && last.t >= lastCharging + TRANSITION_S
          ? `no post-charge rest within ${String(TRANSITION_S)} s of the charge`
          : undefined
        : !logged && last !== undefined && last.t > post.end ? "post-charge rest interrupted" : undefined;
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
    if (gateFailed.length > 0) return `post-charge rest logged; gate FAIL: ${gateFailed.join("; ")}`;
    if (unpassable !== undefined && lastCharging !== undefined && elapsed - lastCharging >= TRANSITION_S) return unpassable;
    if (deps.now() - start >= MAX_RUN_S) return "16 h limit reached";
    if (elapsed - lastCurrent >= SILENT_STOP_S) return "no current for 10 min";
    if (preRestDoneAt !== undefined && phases?.charge === undefined && elapsed - preRestDoneAt >= WAIT_FOR_CHARGE_S) return "no charge within 60 min after the pre-charge rest";
    return undefined;
  };

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
      const session = new CycleSession(link.view, deps, builder, () => lastTx);
      let failure: unknown;
      try {
        const boundary = recording.meta({ event: "charge-log session", reason });
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
        stopReason = message(failure);
        complete = false;
        break;
      }
      update();
      reason = reasonFor(failure);
      if (reason === "disconnect") { await link.close(); link = undefined; }
      deps.onStatus(`Lost the ELM327 (${message(failure)}). New session in ${String(RECOVERY_WAIT_S)} s.`);
      await deps.sleep(RECOVERY_WAIT_S * 1000);
    }
  } catch (error) {
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
  try { deps.onStatus(`Charge log stopped: ${stopReason}. ${saved}`); } catch { }
  return { file, complete: isComplete(), stopReason, saved };
}
