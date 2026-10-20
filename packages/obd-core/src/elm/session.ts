import { latin1Encode } from "../recording/format.js";
import type { Transport } from "../transport/types.js";
import type { VehicleProfile } from "../vehicles/profile.js";
import type { ElmError } from "./errors.js";
import { afterReply, allowedCommand, beforeWrite, NON_PRINTABLE, normalize, UNKNOWN_STATE, type HeaderState } from "./guard.js";
import { reassemble, type DroppedFrame, type Frame } from "./isotp.js";
import { ElmLineReader, parseElmResponse } from "./reader.js";

export interface SendOptions {
  timeoutMs?: number;
  retry?: boolean;
}

interface ResponseBody {
  frames: Frame[];
  dropped: DroppedFrame[];
  lines: string[];
  searching: boolean;
  raw: string;
  attempts: 1 | 2;
}

export type ElmResponse =
  | ({ kind: "data" } & ResponseBody)
  | ({ kind: "ok" } & ResponseBody)
  | ({ kind: "nodata" } & ResponseBody)
  | ({ kind: "error"; error: ElmError } & ResponseBody);

export interface InitResult {
  protocol: VehicleProfile["protocol"];
  fellBack: boolean;
  idBits: 11 | 29;
  voltage: string | undefined;
  response0100: ElmResponse;
}

export interface InitOptions {
  onInformationalReply?: (command: "ATI" | "ATDPN" | "ATRV", response: ElmResponse) => void;
}

export type SessionErrorKind = "timeout" | "closed" | "blocked" | "init";

export class ElmSessionError extends Error {
  readonly kind: SessionErrorKind;
  readonly command: string;
  readonly response?: ElmResponse;

  constructor(kind: SessionErrorKind, command: string, response?: ElmResponse) {
    super(`elm session: ${kind} on ${JSON.stringify(command)}`);
    this.name = "ElmSessionError";
    this.kind = kind;
    this.command = command;
    if (response !== undefined) this.response = response;
  }
}

export const DEFAULT_TIMEOUT_MS = 5000;
export const CAN_ERROR_RETRY_DELAY_MS = 500;
export const RESYNC_MS = 1000;

const PROTOCOLS: readonly string[] = ["0", "6", "7"];

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
  private unknown: boolean;
  private drain = false;
  private closed = false;
  private headerState: HeaderState = UNKNOWN_STATE;

  constructor(private readonly transport: Transport) {
    this.unknown = transport.startsIdle !== true;
    this.unsubscribe = transport.onData((chunk) => {
      this.onData(chunk);
    });
  }

  init(profile: VehicleProfile, options: InitOptions = {}): Promise<InitResult> {
    const { protocol } = profile;
    if (!PROTOCOLS.includes(protocol)) {
      return Promise.reject(new ElmSessionError("blocked", `ATSP${protocol}`));
    }
    return this.enqueue("ATZ", () => this.runInit(protocol, options));
  }

  send(cmd: string, opts: SendOptions = {}): Promise<ElmResponse> {
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
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(e);
      });
    });
  }

  private async attempt(cmd: string, timeoutMs: number): Promise<ElmResponse> {
    if (this.stale) {
      if (!(await this.resync(cmd))) throw new ElmSessionError("timeout", cmd);
      this.stale = false;
    } else if (this.drain) {
      await this.resync(cmd);
      this.drain = false;
    }
    this.reader.reset();
    return toResponse(cmd, await this.exchange(cmd, timeoutMs));
  }

  private async run(cmd: string, opts: SendOptions = {}): Promise<ElmResponse> {
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

  private async runInit(requested: VehicleProfile["protocol"], options: InitOptions): Promise<InitResult> {
    this.reader.reset();
    const reset = await this.run("ATZ");
    if (reset.kind === "error") throw new ElmSessionError("init", "ATZ", reset);
    const identity = await this.run("ATI");
    options.onInformationalReply?.("ATI", identity);
    for (const cmd of ["ATE0", "ATL0", "ATS0", "ATH1", `ATSP${requested}`]) await this.required(cmd);
    const dpn = await this.run("ATDPN");
    options.onInformationalReply?.("ATDPN", dpn);
    const rv = await this.run("ATRV");
    options.onInformationalReply?.("ATRV", rv);
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

function retryAfter(r: ElmResponse): number | undefined {
  if (r.kind === "error" && r.error.kind === "can-error") return CAN_ERROR_RETRY_DELAY_MS;
  if (r.kind === "error" && r.error.kind === "data-error") return 0;
  if (r.kind === "data" && r.dropped.some((d) => d.reason === "incomplete" || d.reason === "sequence")) return 0;
  return undefined;
}

function toResponse(cmd: string, raw: string): ElmResponse {
  const parsed = parseElmResponse(raw, cmd);
  const printable = parsed.lines.filter((l) => !NON_PRINTABLE.test(l));
  const isAt = normalize(cmd).startsWith("AT");
  const r = isAt ? { frames: [], dropped: [], text: printable } : reassemble(printable);
  const body: ResponseBody = { frames: r.frames, dropped: r.dropped, lines: r.text, searching: parsed.searching, raw, attempts: 1 };
  const status = parsed.status;
  return status.kind === "error" ? { kind: "error", error: status.error, ...body } : { kind: status.kind, ...body };
}
