import { latin1Encode } from "../recording/format.js";
import type { Transport } from "../transport/types.js";
import type { VehicleProfile } from "../vehicles/profile.js";
import type { ElmError } from "./errors.js";
import { afterReply, allowedCommand, beforeWrite, NON_PRINTABLE, normalize, UNKNOWN_STATE, type HeaderState } from "./guard.js";
import { reassemble, type DroppedFrame, type Frame } from "./isotp.js";
import { ElmLineReader, parseElmResponse } from "./reader.js";

// Behavior: docs/specs/T0.4-elm327-session.md "src/elm/session.ts"; ELM rules: docs/ELM327.md §Framing,
// §Init sequence, §Responses, §Clone quirks.

export interface SendOptions {
  /** Default DEFAULT_TIMEOUT_MS; measured from just before transport.write(). */
  timeoutMs?: number;
  /** Default true; `pnpm replay` passes false (recordings from the Python tools contain no retries). */
  retry?: boolean;
}

interface ResponseBody {
  /** [] for AT commands. */
  frames: Frame[];
  /** [] for AT commands. */
  dropped: DroppedFrame[];
  /** AT commands: all content lines; others: Reassembly.text. Non-printable lines removed. */
  lines: string[];
  searching: boolean;
  /** Verbatim text of the final attempt, '>' excluded. */
  raw: string;
  attempts: 1 | 2;
}

export type ElmResponse =
  | ({ kind: "data" } & ResponseBody)
  | ({ kind: "ok" } & ResponseBody)
  | ({ kind: "nodata" } & ResponseBody)
  | ({ kind: "error"; error: ElmError } & ResponseBody); // frames kept: BUFFER FULL still returns complete messages

export interface InitResult {
  /** The ATSP value in effect after init ("0" after a fallback). */
  protocol: VehicleProfile["protocol"];
  fellBack: boolean;
  /** From response0100.frames[0].header length (3 -> 11, 8 -> 29). */
  idBits: 11 | 29;
  /** ATRV content line as printed ("12.7V"); undefined if ATRV was not data. */
  voltage: string | undefined;
  /** kind "data", frames.length >= 1; T0.5 reuses it instead of re-sending 0100. */
  response0100: ElmResponse;
}

export type SessionErrorKind = "timeout" | "closed" | "blocked" | "init";

export class ElmSessionError extends Error {
  readonly kind: SessionErrorKind;
  readonly command: string;
  /** "init": the response that failed the step. */
  readonly response?: ElmResponse;

  constructor(kind: SessionErrorKind, command: string, response?: ElmResponse) {
    super(`elm session: ${kind} on ${JSON.stringify(command)}`);
    this.name = "ElmSessionError";
    this.kind = kind;
    this.command = command;
    if (response !== undefined) this.response = response;
  }
}

/** tools/spike/discover.py CMD_TIMEOUT_S = 5 (longest seen: 2.3 s, 0100 with SEARCHING...). */
export const DEFAULT_TIMEOUT_MS = 5000;
/** docs/ELM327.md §Responses: CAN ERROR -> retry once after 500 ms. */
export const CAN_ERROR_RETRY_DELAY_MS = 500;
/** Policy value, not an ELM constant (spec Risks): how long to wait for a late '>' after a timeout. */
export const RESYNC_MS = 1000;

const PROTOCOLS: readonly string[] = ["0", "6", "7"];

/** The one thing the current queue slot waits for: a '>' (reply or resync) or a timer (timeout, delay). */
interface Wait {
  cmd: string;
  timer: ReturnType<typeof setTimeout>;
  onPrompt: ((raw: string) => void) | undefined;
  reject: (e: unknown) => void;
}

export class Elm327Session {
  private readonly reader = new ElmLineReader();
  private readonly unsubscribe: () => void;
  private tail: Promise<unknown> = Promise.resolve();
  private wait: Wait | undefined;
  private stale = false;
  // docs/ELM327.md §Write safety: a new session cannot tell whether the ELM is idle, so until an ATZ or ATI is
  // answered cleanly only those two are written. STOPPED starts the state again.
  private unknown: boolean;
  /** After STOPPED: wait for the second '>' before the next write. */
  private drain = false;
  private closed = false;
  private headerState: HeaderState = UNKNOWN_STATE;

  constructor(private readonly transport: Transport) {
    this.unknown = transport.startsIdle !== true;
    this.unsubscribe = transport.onData((chunk) => {
      this.onData(chunk);
    });
  }

  init(profile: VehicleProfile): Promise<InitResult> {
    // Runtime check: the profile may come from outside TypeScript, and ATSP<protocol> is written verbatim.
    // Read once: the queued init must use the validated value, not a later (mutated or getter) read.
    const { protocol } = profile;
    if (!PROTOCOLS.includes(protocol)) {
      return Promise.reject(new ElmSessionError("blocked", `ATSP${protocol}`));
    }
    return this.enqueue("ATZ", () => this.runInit(protocol));
  }

  send(cmd: string, opts: SendOptions = {}): Promise<ElmResponse> {
    // AGENTS.md hard rule 5; docs/ELM327.md §Write safety.
    if (allowedCommand(cmd) === undefined) return Promise.reject(new ElmSessionError("blocked", cmd));
    return this.enqueue(cmd, () => this.run(cmd, opts));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const w = this.wait;
    if (w !== undefined) {
      clearTimeout(w.timer);
      this.wait = undefined;
      w.reject(new ElmSessionError("closed", w.cmd));
    }
    this.unsubscribe();
    await this.transport.close();
  }

  private enqueue<T>(cmd: string, job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => {
      if (this.closed) throw new ElmSessionError("closed", cmd);
      return job();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private onData(chunk: Uint8Array): void {
    for (const raw of this.reader.push(chunk)) {
      const w = this.wait;
      if (w?.onPrompt !== undefined) {
        clearTimeout(w.timer);
        this.wait = undefined;
        w.onPrompt(raw);
      } else {
        // A '>' with nothing in flight (late prompt after a timeout, or a second segment): discard.
        this.stale = false;
      }
    }
  }

  private arm(cmd: string, ms: number, onTimer: () => void, onPrompt: Wait["onPrompt"], reject: Wait["reject"]): void {
    if (this.closed) {
      reject(new ElmSessionError("closed", cmd));
      return;
    }
    const timer = setTimeout(() => {
      this.wait = undefined;
      onTimer();
    }, ms);
    this.wait = { cmd, timer, onPrompt, reject };
  }

  private delay(cmd: string, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.arm(cmd, ms, resolve, undefined, reject);
    });
  }

  /** Resolves true on a '>', false when RESYNC_MS passes without one. */
  private resync(cmd: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.arm(cmd, RESYNC_MS, () => {
        resolve(false);
      }, () => {
        resolve(true);
      }, reject);
    });
  }

  private exchange(cmd: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      // Defense in depth: the only transport.write; nothing off the allowlist (control bytes, empty) goes out.
      if (allowedCommand(cmd) === undefined) {
        reject(new ElmSessionError("blocked", cmd));
        return;
      }
      this.arm(
        cmd,
        timeoutMs,
        () => {
          this.stale = true;
          reject(new ElmSessionError("timeout", cmd));
        },
        resolve,
        reject,
      );
      const w = this.wait;
      if (w === undefined) return;
      this.transport.write(latin1Encode(cmd + "\r")).catch((e: unknown) => {
        if (this.wait !== w) return;
        clearTimeout(w.timer);
        this.wait = undefined;
        this.stale = true;
        // A transport.write rejection propagates as-is (spec "Resolve vs reject").
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(e);
      });
    });
  }

  private async attempt(cmd: string, timeoutMs: number): Promise<ElmResponse> {
    if (this.stale) {
      // docs/ELM327.md §Write safety: a busy ELM discards the first character it receives, so nothing is
      // written until a '>' shows it is idle; without one the session stays stale.
      if (!(await this.resync(cmd))) throw new ElmSessionError("timeout", cmd);
      this.stale = false;
    } else if (this.drain) {
      // docs/ELM327.md §Write safety (DS p.9, p.48): only the interrupting character is discarded, so the rest
      // of the stopped command may still be answered. Written either way; the unknown state limits it to ATZ/ATI.
      await this.resync(cmd);
      this.drain = false;
    }
    this.reader.reset();
    return toResponse(cmd, await this.exchange(cmd, timeoutMs));
  }

  private async run(cmd: string, opts: SendOptions = {}): Promise<ElmResponse> {
    // docs/ELM327.md §Write safety: checked in queue order; if an attempt throws, the in-flight state stays.
    const norm = normalize(cmd);
    const probe = norm === "ATZ" || norm === "ATI";
    if (this.unknown && !probe) throw new ElmSessionError("blocked", cmd);
    const inFlight = beforeWrite(this.headerState, norm);
    if (inFlight === undefined) throw new ElmSessionError("blocked", cmd);
    this.headerState = inFlight;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let r = await this.attempt(cmd, timeoutMs);
    const retry = opts.retry === false ? undefined : retryAfter(r);
    if (retry !== undefined) {
      if (retry > 0) await this.delay(cmd, retry);
      r = { ...(await this.attempt(cmd, timeoutMs)), attempts: 2 };
    }
    this.headerState = afterReply(this.headerState, norm, r.kind);
    if (r.kind === "error" && r.error.kind === "stopped") {
      this.unknown = true;
      this.drain = true;
    } else if (probe && r.kind !== "error") {
      this.unknown = false;
    }
    return r;
  }

  private async required(cmd: string): Promise<void> {
    const r = await this.run(cmd);
    if (r.kind !== "ok") throw new ElmSessionError("init", cmd, r);
  }

  private async runInit(requested: VehicleProfile["protocol"]): Promise<InitResult> {
    this.reader.reset();
    // An ATZ answered with an error reset nothing; ATE0 must not follow it (docs/ELM327.md §Write safety).
    const reset = await this.run("ATZ");
    if (reset.kind === "error") throw new ElmSessionError("init", "ATZ", reset);
    await this.run("ATI");
    for (const cmd of ["ATE0", "ATL0", "ATS0", "ATH1", `ATSP${requested}`]) await this.required(cmd);
    await this.run("ATDPN");
    const rv = await this.run("ATRV");
    let protocol = requested;
    let response0100 = await this.run("0100");
    if (!answered(response0100) && protocol !== "0") {
      await this.required("ATSP0");
      protocol = "0";
      response0100 = await this.run("0100");
    }
    if (!answered(response0100)) throw new ElmSessionError("init", "0100", response0100);
    return {
      protocol,
      fellBack: protocol !== requested,
      idBits: response0100.frames[0].header.length === 3 ? 11 : 29,
      voltage: rv.kind === "data" ? rv.lines.at(0) : undefined,
      response0100,
    };
  }
}

function answered(r: ElmResponse): boolean {
  return r.kind === "data" && r.frames.length >= 1;
}

/** Milliseconds to wait before the one retry, or undefined for no retry (docs/ELM327.md §Responses, §Clone quirks). */
function retryAfter(r: ElmResponse): number | undefined {
  if (r.kind === "error" && r.error.kind === "can-error") return CAN_ERROR_RETRY_DELAY_MS;
  if (r.kind === "error" && r.error.kind === "data-error") return 0;
  if (r.kind === "data" && r.dropped.some((d) => d.reason === "incomplete" || d.reason === "sequence")) return 0;
  return undefined;
}

function toResponse(cmd: string, raw: string): ElmResponse {
  const parsed = parseElmResponse(raw, cmd);
  // The clone's reset garbage (docs/ELM327.md §Clone quirks) survives as a content line; it stays in raw.
  const printable = parsed.lines.filter((l) => !NON_PRINTABLE.test(l));
  const isAt = normalize(cmd).startsWith("AT");
  const r = isAt ? { frames: [], dropped: [], text: printable } : reassemble(printable);
  const body: ResponseBody = { frames: r.frames, dropped: r.dropped, lines: r.text, searching: parsed.searching, raw, attempts: 1 };
  const status = parsed.status;
  return status.kind === "error" ? { kind: "error", error: status.error, ...body } : { kind: status.kind, ...body };
}
