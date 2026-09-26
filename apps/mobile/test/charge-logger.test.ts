// T2.4 Stage B1 failure modes 1–13, the Decision 16 error split and Decisions 17–19 and 22–25: docs/specs/T2.4-charge-logger.md §Verification, Stage B1. Each run drives
// runChargeLog against a fake ELM on a fake clock; the flushed file is the artifact (/tmp/t2.4-b1-<case>.jsonl).
// Everything the fake ELM answers is synthetic. Its reply encodings follow the spec's §Sources scalings.
// @ts-expect-error Node built-in types are not part of the mobile target.
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { latin1Decode, latin1Encode, parseRecording, type RecordingLine } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { ChargeLogBuilder, chargeLogFromRecording, chargePhases, CYCLE_S, largestGap, MAX_GAP_S, MAX_RECOVERIES_PER_RUN, POST_REST_S, PRE_REST_S, RECOVERY_GAP_S, span, TRANSITION_S, type ChargeLog, type ChargePhases } from "obd-battery/session";
import { integratedCurrentCapacity } from "../../../packages/obd-battery/src/capacity.js";
import { allowedCommand } from "../../../packages/obd-core/src/elm/guard.js";
import { MAX_RUN_S, RECOVERY_WAIT_S, runChargeLog, SILENT_STOP_S, WAIT_FOR_CHARGE_S, type ChargeLogResult, type StreamTargets } from "../src/chargeLogger.js";
import { RecordingBuffer } from "../src/recording.js";

const write = writeFileSync as (path: string, text: string) => void;
const signals = importObdbMode22(signalsetJson);
const FILE = "2026-09-25-charge-log.jsonl";
const META = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "synthetic fake ELM, T2.4 B1 test", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
const SLOW = 120_000;

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-09-25T00:00:00Z") }); });
afterEach(() => { vi.useRealTimers(); });

// ---- The fake ELM --------------------------------------------------------------------------------------------

/** Seconds since the fake clock started the run. */
type Clock = () => number;
interface Plan {
  /** Pack current (A, negative = into the pack) at run time s. */
  amps(s: number): number;
  /** Overrides the reply: a string (with '>'), null = never answer, "lost" = the write rejects. */
  inject?(command: string, s: number): string | null | undefined;
  /** Every 22 read answers NO DATA. */
  silent?: boolean;
  /** Default 20–30 ms, a deterministic jitter so sample times are not an exact 5 s grid (Decision 10). */
  latencyMs?: number;
  /** 2B43 byte at run time s; default 128. */
  soc?(s: number): number;
}

const hex = (bytes: readonly number[]) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
/** ISO-TP frames as the ELM prints them with ATH1 and ATS0 (same layout as the Stage A synthetic generator). */
function frames(module: string, did: string, data: readonly number[]): string {
  const header = `18DAF1${module}`;
  const payload = [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16), ...data];
  if (payload.length <= 7) return `${header}${hex([payload.length, ...payload])}\r\r>`;
  const lines = [`${header}${hex([0x10 | (payload.length >> 8), payload.length & 0xff, ...payload.slice(0, 6)])}`];
  for (let i = 6, n = 1; i < payload.length; i += 7, n++) lines.push(`${header}${hex([0x20 | (n & 0x0f), ...payload.slice(i, i + 7)])}`);
  return `${lines.join("\r")}\r\r>`;
}
// CB/2AE1–2AE7: 80 records [u16 x 0.0001 V][module 1–10] plus 4 zero records (spec §Sources; Decision 8).
const GROUP_RECORDS = (() => {
  const records = Array.from({ length: 80 }, (_, i) => [...u16(39000 + (i % 5) * 2), Math.floor(i / 8) + 1]).flat();
  while (records.length < 7 * 36) records.push(0, 0, 0);
  return records;
})();
const GROUP_DIDS = ["2AE1", "2AE2", "2AE3", "2AE4", "2AE5", "2AE6", "2AE7"];

class FakeElm implements Transport {
  private target = "";
  private lost = false;
  private writes = 0;
  private readonly listeners = new Set<(bytes: Uint8Array) => void>();
  constructor(private readonly plan: Plan, private readonly clock: Clock) {}

  write(bytes: Uint8Array): Promise<void> {
    const command = latin1Decode(bytes).replace(/\r$/, "");
    const injected = this.lost ? "lost" : this.plan.inject?.(command, this.clock());
    if (injected === "lost") { this.lost = true; return Promise.reject(new Error("BLE link lost")); }
    const reply = injected === undefined ? this.answer(command) : injected;
    if (reply !== null) setTimeout(() => { this.listeners.forEach((cb) => { cb(latin1Encode(reply)); }); }, this.plan.latencyMs ?? 20 + (this.writes++ % 11));
    return Promise.resolve();
  }

  onData(cb: (bytes: Uint8Array) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  close(): Promise<void> { this.lost = true; this.listeners.clear(); return Promise.resolve(); }

  private answer(command: string): string {
    // Init replies as in fixtures/synthetic/battery-diagnosis-full-scan.jsonl lines 2–40 (copied from the spike).
    if (command === "ATZ") return "\r\rELM327 v1.5\r\r>";
    if (command === "ATI") return "ELM327 v1.5\r\r>";
    if (command === "ATDPN") return "A0\r\r>";
    if (command === "ATRV") return "12.7V\r\r>";
    if (command === "0100") return "18DAF1CB06410080000001\r\r>";
    if (command.startsWith("ATSH DA")) this.target = command.slice(7, 9);
    if (command.startsWith("AT")) return "OK\r\r>";
    const did = command.slice(3);
    if (this.plan.silent) return "NO DATA\r\r>";
    const s = this.clock();
    // 17/2414 s16 / 20 A; 17/2885 u16 / 100 V; CB/27AF u16 / 100 kWh; CB/2B43 byte x 100/255 %; CB/2AF5 u16 / 10000 V (spec §Sources).
    if (this.target === "17" && did === "2414") return frames("17", did, u16(Math.round(this.plan.amps(s) * 20) & 0xffff));
    if (this.target === "17" && did === "2885") return frames("17", did, u16(33000));
    if (this.target === "CB" && did === "27AF") return frames("CB", did, u16(4000));
    if (this.target === "CB" && did === "2B43") return frames("CB", did, [this.plan.soc?.(s) ?? 128]);
    if (this.target === "CB" && did === "2AF5") return frames("CB", did, [...u16(39004), ...u16(39000), ...u16(39008)]);
    const group = GROUP_DIDS.indexOf(did);
    if (this.target === "CB" && group >= 0) return frames("CB", did, GROUP_RECORDS.slice(group * 36, group * 36 + 36));
    // 27C6, 276D, 2AF7, 2AF1 are polled raw with no sourced payload here: NO DATA is a valid reply.
    return "NO DATA\r\r>";
  }
}

// ---- The harness ------------------------------------------------------------------------------------------------

class MemoryStream implements StreamTargets {
  content = "";
  readonly appends: { text: string; buffered: number }[] = [];
  copies = 0;
  created = 0;
  copyError?: Error;
  constructor(private readonly recording: RecordingBuffer) {}
  create(): string { this.created++; return FILE; }
  append(name: string, text: string): void {
    expect(name).toBe(FILE);
    this.appends.push({ text, buffered: this.recording.lines().length });
    this.content += text;
  }
  copyToFolder(name: string): Promise<void> {
    expect(name).toBe(FILE);
    this.copies++;
    return this.copyError ? Promise.reject(this.copyError) : Promise.resolve();
  }
}

interface Options {
  /** n = 1 for the first call. Returns a transport or throws. */
  connect?: (n: number, clock: Clock) => Transport;
  stopAt?: number;
  copyError?: Error;
  /** Set true by a test to request a stop, e.g. from inside a plan's inject. */
  stop?: { requested: boolean };
  /** Called after each status line is recorded; may throw. */
  onStatus?: (line: string) => void;
}

interface Run { result: ChargeLogResult; lines: RecordingLine[]; stream: MemoryStream; recording: RecordingBuffer; statuses: string[]; connects: number; endS: number }

async function run(name: string, plan: Plan, options: Options = {}): Promise<Run> {
  const t0 = Date.now() / 1000;
  const clock: Clock = () => Date.now() / 1000 - t0;
  const recording = new RecordingBuffer(() => Date.now() / 1000);
  recording.start(META);
  const stream = new MemoryStream(recording);
  if (options.copyError) stream.copyError = options.copyError;
  const statuses: string[] = [];
  let connects = 0;
  const running = runChargeLog({
    connect: async () => {
      connects++;
      await Promise.resolve();
      return options.connect ? options.connect(connects, clock) : new FakeElm(plan, clock);
    },
    recording,
    signals,
    now: () => Date.now() / 1000,
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    onStatus: (line) => { statuses.push(line); options.onStatus?.(line); },
    stream,
    stopRequested: () => options.stop?.requested === true || (options.stopAt !== undefined && clock() >= options.stopAt),
  });
  let settled = false;
  running.then(() => { settled = true; }, () => { settled = true; });
  const done = () => settled;
  while (!done()) {
    await vi.advanceTimersToNextTimerAsync();
    if (!done() && vi.getTimerCount() === 0) { await Promise.resolve(); if (!done() && vi.getTimerCount() === 0) throw new Error(`${name}: run stuck with no timer pending`); }
  }
  const result = await running;
  const endS = clock();
  write(`/tmp/t2.4-b1-${name}.jsonl`, stream.content);
  const lines = parseRecording(stream.content);
  expectSafeAndFirstWrite(lines);
  expect(stream.copies).toBe(1);
  expect(result.file).toBe(FILE);
  const last = lines.at(-1);
  expect(last?.dir === "meta" && String(last.note)).toContain(result.stopReason);
  return { result, lines, stream, recording, statuses, connects, endS };
}

const txs = (lines: readonly RecordingLine[]) => lines.filter((l) => l.dir === "tx").map((l) => l.data.replace(/\r$/, ""));
const isBoundary = (l: RecordingLine) => l.dir === "meta" && l.event === "charge-log session";
const boundaries = (lines: readonly RecordingLine[]) => lines.filter(isBoundary).map((l) => (l.dir === "meta" ? l.reason : undefined));

/** Failure mode 12 in every case, plus the first-write rule for every fresh session. */
function expectSafeAndFirstWrite(lines: readonly RecordingLine[]): void {
  for (const command of txs(lines)) {
    expect(allowedCommand(command), command).toBeDefined();
    expect(command.replace(/ /g, "")).not.toBe("0902");
    expect(command.replace(/ /g, "")).not.toBe("224193");
  }
  expect(lines.findIndex((l) => l.dir === "tx")).toBeGreaterThan(lines.findIndex(isBoundary));
  lines.forEach((line, i) => {
    if (!isBoundary(line)) return;
    const next = lines.slice(i + 1).find((l) => l.dir === "tx" || isBoundary(l));
    if (next?.dir === "tx") expect(next.data).toBe("ATZ\r");
  });
}

/** The next tx after the first tx of `command` at or after run time `s`, and the lines in between. */
function after(lines: readonly RecordingLine[], command: string, s: number): { between: RecordingLine[]; next?: string } {
  const at = lines.findIndex((l) => l.dir === "tx" && l.data === `${command}\r` && l.t >= s);
  expect(at, `${command} after ${String(s)} s`).toBeGreaterThan(0);
  const nextAt = lines.findIndex((l, i) => i > at && l.dir === "tx");
  return { between: lines.slice(at + 1, nextAt < 0 ? lines.length : nextAt), ...(nextAt < 0 ? {} : { next: lines[nextAt].dir === "tx" ? lines[nextAt].data.replace(/\r$/, "") : "" }) };
}

const REST = 0.5;
const CHARGE = -20;
/** Rest 0–700 s, 20 s other, charge 720–1020 s, then rest. */
const happyAmps = (s: number) => (s < 700 ? REST : s < 720 ? -3 : s < 1020 ? CHARGE : REST);

async function replay(text: string) {
  vi.useRealTimers();
  const log = await chargeLogFromRecording(parseRecording(text), FILE, signals);
  return { log, phases: chargePhases(log) };
}

// ---- Failure modes ------------------------------------------------------------------------------------------------

it("1 + 10: happy path stops by itself after the post-charge rest; every flush is crash safe", async () => {
  const r = await run("happy", { amps: happyAmps });
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged", saved: `Saved ${FILE} to the capture folder.` });
  expect(r.endS).toBeGreaterThanOrEqual(1020 + POST_REST_S);
  expect(r.endS).toBeLessThan(1020 + POST_REST_S + 30);
  expect(boundaries(r.lines)).toEqual(["start"]);
  expect(r.statuses.some((s) => s.includes("Do not plug in yet"))).toBe(true);
  expect(r.statuses).toContain("Plug in the charger now.");
  // 10: drain() leaves nothing flushed in memory; every flush ends on a whole line after a complete exchange.
  expect(r.stream.appends.length).toBeGreaterThan((1020 + POST_REST_S) / 30 - 2);
  expect(r.stream.appends.every((a) => a.buffered === 0 && a.text.endsWith("\n"))).toBe(true);
  expect(r.recording.lines()).toEqual([]);
  let snapshot = "";
  const snapshots: string[] = [];
  for (const a of r.stream.appends) { snapshot += a.text; snapshots.push(snapshot); }
  const { log, phases } = await replay(r.stream.content);
  for (const [i, text] of snapshots.entries()) {
    if (i % 10 !== 0 && i !== snapshots.length - 1) continue;
    const lines = parseRecording(text);
    const lastTx = lines.findLastIndex((l) => l.dir === "tx");
    expect(lines.slice(lastTx + 1).some((l) => l.dir === "rx" && l.data.includes(">")), `snapshot ${String(i)}`).toBe(true);
    await chargeLogFromRecording(lines, FILE, signals);
  }
  // 1: the flushed file replays into all three windows and a passing gate.
  expect(phases.preRest && phases.charge && phases.postRest && phases.postRestRun).toBeTruthy();
  expect(phases.currentGap.seconds).toBeLessThanOrEqual(MAX_GAP_S);
  expect(phases.groupGap.seconds).toBeLessThanOrEqual(MAX_GAP_S);
  const post = phases.postRestRun ?? { start: 0, end: 0 };
  expect(span(post.start, post.end)).toBeGreaterThanOrEqual(POST_REST_S);
  expect(log.groups.length).toBeGreaterThan(0);
}, SLOW);

it("2: one CAN ERROR is retried by core and starts no recovery", async () => {
  let fired = false;
  const r = await run("can-error-retry", {
    amps: () => REST,
    inject: (command, s) => { if (command === "22 2AF5" && s >= 10 && !fired) { fired = true; return "CAN ERROR\r\r>"; } return undefined; },
  }, { stopAt: 30 });
  expect(fired).toBe(true);
  expect(after(r.lines, "22 2AF5", 10).next).toBe("22 2AF5");
  expect(txs(r.lines).filter((c) => c === "ATZ")).toHaveLength(1);
  expect(boundaries(r.lines)).toEqual(["start"]);
  expect(r.result.stopReason).toBe("disconnect pressed");
}, SLOW);

it("3: LV RESET mid-cycle ends the cycle; the next write is ATZ of a new session after a boundary", async () => {
  let fired = false;
  const r = await run("lv-reset", {
    amps: () => REST,
    inject: (command, s) => { if (command === "22 2AE3" && s >= 20 && !fired) { fired = true; return "LV RESET\r\r>"; } return undefined; },
  }, { stopAt: 60 });
  const { between, next } = after(r.lines, "22 2AE3", 20);
  expect(next).toBe("ATZ");
  expect(between.filter(isBoundary).map((l) => l.dir === "meta" && l.reason)).toEqual(["lv-reset"]);
  const reset = r.lines.find((l) => l.dir === "meta" && l.reason === "lv-reset");
  const resetAt = reset?.t ?? Infinity;
  const lvLine = r.lines.find((l) => l.dir === "rx" && l.data.includes("LV RESET"));
  expect(resetAt - (lvLine?.t ?? 0)).toBeGreaterThanOrEqual(RECOVERY_WAIT_S);
  const { log } = await replay(r.stream.content);
  expect(log.sessions?.map((s) => s.reason)).toEqual(["start", "lv-reset"]);
  expect(log.current.some((p) => p.t > resetAt)).toBe(true);
}, SLOW);

it("3b: LV RESET at ATRV stops init before 0100; a first CAN ERROR at ATDPN is retried by core", async () => {
  let resets = 0;
  const lv = await run("init-lv-reset", {
    amps: () => REST,
    inject: (command) => { if (command === "ATRV" && resets === 0) { resets++; return "LV RESET\r\r>"; } return undefined; },
  }, { stopAt: 30 });
  expect(after(lv.lines, "ATRV", 0).next).toBe("ATZ");
  expect(boundaries(lv.lines)).toEqual(["start", "lv-reset"]);
  const firstAtz = lv.lines.filter((l) => l.dir === "tx" && l.data === "ATZ\r").map((l) => l.t);
  expect(firstAtz[1] - firstAtz[0]).toBeGreaterThanOrEqual(RECOVERY_WAIT_S);

  let errors = 0;
  const can = await run("init-can-error", {
    amps: () => REST,
    inject: (command) => { if (command === "ATDPN" && errors === 0) { errors++; return "CAN ERROR\r\r>"; } return undefined; },
  }, { stopAt: 30 });
  expect(after(can.lines, "ATDPN", 0).next).toBe("ATDPN");
  expect(txs(can.lines).filter((c) => c === "ATZ")).toHaveLength(1);
  expect(boundaries(can.lines)).toEqual(["start"]);
  expect(txs(can.lines)).toContain("0100");
}, SLOW);

it("4: a reply with no '>' is followed by no write until a new session writes ATZ", async () => {
  let fired = false;
  const r = await run("timeout", {
    amps: () => REST,
    inject: (command, s) => { if (command === "22 2885" && s >= 20 && !fired) { fired = true; return null; } return undefined; },
  }, { stopAt: 60 });
  const { between, next } = after(r.lines, "22 2885", 20);
  expect(next).toBe("ATZ");
  expect(between.filter(isBoundary).map((l) => l.dir === "meta" && l.reason)).toEqual(["timeout"]);
  expect(r.connects).toBe(1);
}, SLOW);

it("5: a lost transport reconnects and logs on; when reconnecting keeps failing, the run stops and still saves", async () => {
  const lostAt = (plan: Plan): Plan => ({ ...plan, inject: (command, s) => (s >= 30 && command === "22 2414" ? "lost" : undefined) });
  const plan: Plan = { amps: () => REST };
  const recover = await run("disconnect-recover", plan, {
    connect: (n, clock) => (n === 1 ? new FakeElm(lostAt(plan), clock) : new FakeElm(plan, clock)),
    stopAt: 70,
  });
  expect(recover.connects).toBe(2);
  expect(boundaries(recover.lines)).toEqual(["start", "disconnect"]);
  expect(after(recover.lines, "22 2414", 30).next).toBe("ATZ");
  const { log } = await replay(recover.stream.content);
  expect(log.current.some((p) => p.t > 40)).toBe(true);

  vi.useFakeTimers({ now: new Date("2026-09-25T00:00:00Z") });
  const giveUp = await run("disconnect-give-up", plan, {
    connect: (n, clock) => { if (n === 1) return new FakeElm(lostAt(plan), clock); throw new Error("dongle not found"); },
  });
  expect(giveUp.result).toMatchObject({ complete: false, stopReason: "no current for 10 min" });
  expect(giveUp.connects).toBeGreaterThan(2);
  expect(giveUp.endS).toBeGreaterThanOrEqual(30 + SILENT_STOP_S - 5);
  expect(giveUp.endS).toBeLessThan(30 + SILENT_STOP_S + 10);
  expect(boundaries(giveUp.lines)).toEqual(["start"]);
}, SLOW);

it("6: modules that answer NO DATA for 10 min stop the run as partial", async () => {
  const r = await run("silent", { amps: () => REST, silent: true });
  expect(r.result).toMatchObject({ complete: false, stopReason: "no current for 10 min" });
  expect(r.endS).toBeGreaterThanOrEqual(SILENT_STOP_S);
  expect(r.endS).toBeLessThan(SILENT_STOP_S + 10);
}, SLOW);

it("7: no charge within an hour of the pre-charge rest stops the run as partial", async () => {
  const r = await run("no-charge", { amps: () => REST });
  expect(r.result.complete).toBe(false);
  expect(r.result.stopReason).toContain("no charge");
  expect(r.endS).toBeGreaterThanOrEqual(600 + WAIT_FOR_CHARGE_S);
  expect(r.endS).toBeLessThan(600 + WAIT_FOR_CHARGE_S + 30);
}, SLOW);

it("8: the 16 h limit stops the run as partial", async () => {
  // A slow ELM (4 s per reply, under the 5 s timeout) keeps a 16 h run to a few hundred cycles.
  const r = await run("max-run", { amps: () => CHARGE, latencyMs: 4000 });
  expect(r.result.complete).toBe(false);
  expect(r.result.stopReason).toContain("16 h");
  expect(r.endS).toBeGreaterThanOrEqual(MAX_RUN_S);
  expect(r.endS).toBeLessThan(MAX_RUN_S + 200);
}, SLOW);

it("9: Disconnect pressed lets the command in flight complete, then stops, flushes and copies", async () => {
  const stop = { requested: false };
  const r = await run("stop-requested", {
    amps: () => REST,
    inject: (command, s) => { if (command === "22 2B43" && s >= 20) stop.requested = true; return undefined; },
  }, { stop });
  expect(r.result).toMatchObject({ complete: false, stopReason: "disconnect pressed" });
  const { between, next } = after(r.lines, "22 2B43", 20);
  expect(next).toBeUndefined();
  expect(between.some((l) => l.dir === "rx" && l.data.includes("622B43"))).toBe(true);
}, SLOW);

it("11: a failed copy to the folder still resolves and names the private file", async () => {
  const r = await run("copy-fails", { amps: () => REST }, { stopAt: 15, copyError: new Error("no capture folder remembered") });
  expect(r.result.saved).toBe(`NOT SAVED to the capture folder: no capture folder remembered. The log is in app storage (captures/${FILE}).`);
  expect(r.stream.content.length).toBeGreaterThan(0);
}, SLOW);

it("13: a core retry on the first post-charge 2414 leaves the live samples and the replayed samples identical", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  let fired = false;
  const r = await run("retry-timestamps", {
    // A fixed latency: the reviewer's reproduction, where the pre-send clock made the replayed post-rest 1799.48 s.
    amps: happyAmps, latencyMs: 20,
    inject: (command, s) => { if (command === "22 2414" && s >= 1020 && !fired) { fired = true; return "CAN ERROR\r\r>"; } return undefined; },
  });
  expect(fired).toBe(true);
  expect(after(r.lines, "22 2414", 1020).next).toBe("22 2414");
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  await expectLiveEqualsReplay(r, logs);
}, SLOW);

it("13 (Decision 17): a core retry on group DIDs 2AE3 and 2AE7 in the post-charge rest keeps the live and replayed logs identical", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const fired = new Set<string>();
  // The default jitter, not a fixed latency: sample times are off the 5 s grid.
  const r = await run("retry-group", {
    amps: happyAmps,
    inject: (command, s) => {
      const at = command === "22 2AE3" ? 1500 : command === "22 2AE7" ? 1600 : undefined;
      if (at === undefined || s < at || fired.has(command)) return undefined;
      fired.add(command);
      return "CAN ERROR\r\r>";
    },
  });
  expect([...fired].sort()).toEqual(["22 2AE3", "22 2AE7"]);
  expect(after(r.lines, "22 2AE3", 1500).next).toBe("22 2AE3");
  expect(after(r.lines, "22 2AE7", 1600).next).toBe("22 2AE7");
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  await expectLiveEqualsReplay(r, logs);
}, SLOW);

/** The 2AE3 reply with its first consecutive-frame line missing: core gets a data reply with an incomplete message and retries it. */
const missingCf = () => frames("CB", "2AE3", GROUP_RECORDS.slice(2 * 36, 3 * 36)).split("\r").filter((_, i) => i !== 1).join("\r");

for (const cycles of [[1500], [1500, 1505, 1510]]) {
  it(`13 (Decision 18): a core retry on 22 2AE3 after a lost consecutive frame, in ${String(cycles.length)} cycle(s), keeps the live and replayed logs identical`, async () => {
    const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
    const fired = new Set<number>();
    const r = await run(cycles.length === 1 ? "retry-cf" : "retry-cf-3", {
      amps: happyAmps,
      inject: (command, s) => {
        const at = cycles.find((c) => s >= c && s < c + 5);
        if (command !== "22 2AE3" || at === undefined || fired.has(at)) return undefined;
        fired.add(at);
        return missingCf();
      },
    });
    expect([...fired]).toEqual(cycles);
    for (const at of cycles) expect(after(r.lines, "22 2AE3", at).next).toBe("22 2AE3");
    expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
    await expectLiveEqualsReplay(r, logs);
  }, SLOW);
}

/** A full 2AE3 reply plus a stray first frame with no consecutive frames: the message is in frames, an incomplete in dropped. */
const strayFf = () => {
  const full = frames("CB", "2AE3", GROUP_RECORDS.slice(2 * 36, 3 * 36));
  return full.replace(/\r\r>$/, `\r${full.split("\r")[0]}\r\r>`);
};

// Pins Decision 18's structural rule against a rule that skips any reply with a dropped incomplete frame (review probe H2).
it("13 (Decision 18): the answered retry of 22 2AE3 keeps its sample when it also carries a stray first frame, live and replay alike", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  let n = 0;
  const r = await run("retry-cf-stray-ff", {
    amps: happyAmps,
    inject: (command, s) => {
      if (command !== "22 2AE3" || s < 1500 || n >= 2) return undefined;
      n++;
      return n === 1 ? missingCf() : strayFf();
    },
  });
  expect(n).toBe(2);
  expect(after(r.lines, "22 2AE3", 1500).next).toBe("22 2AE3");
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  await expectLiveEqualsReplay(r, logs);
}, SLOW);

/** The Gate line `pnpm charge-log` prints for the flushed file. The script is Node-only, so it is imported by URL, outside the mobile typecheck. */
async function gateLine(text: string): Promise<string> {
  vi.useRealTimers();
  const script = new URL("../../../packages/obd-battery/scripts/charge-log.ts", import.meta.url).href;
  const { chargeLogSummary } = (await import(/* @vite-ignore */ script)) as { chargeLogSummary: (lines: readonly RecordingLine[], recording: string) => Promise<string> };
  return (await chargeLogSummary(parseRecording(text), FILE)).split("\n").find((line) => line.startsWith("Gate ")) ?? "";
}

// Decision 19: probes K and L of the B1 final review. The first attempt fails, core's retry gets no '>', and a timeout session follows.
for (const [probe, command, first] of [["K", "22 2AE3", missingCf], ["L", "22 2414", () => "CAN ERROR\r\r>"]] as const) {
  it(`Decision 19: one timeout recovery in the post-charge rest (probe ${probe}, ${command}) still stops complete; live equals replay and the gate passes`, async () => {
    const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
    let n = 0;
    const r = await run(`recovery-rest-${probe}`, {
      amps: happyAmps,
      inject: (c, s) => {
        if (c !== command || s < 1500 || n >= 2) return undefined;
        n++;
        return n === 1 ? first() : null;
      },
    });
    expect(n).toBe(2);
    expect(boundaries(r.lines)).toEqual(["start", "timeout"]);
    expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
    expect(r.endS).toBeLessThan(1020 + POST_REST_S + 60);
    const { phases } = await expectLiveEqualsReplay(r, logs);
    expect(phases.recoveryGaps).toHaveLength(1);
    expect(phases.recoveryGaps[0].seconds).toBeGreaterThan(MAX_GAP_S);
    expect(phases.recoveryGaps[0].seconds).toBeLessThanOrEqual(RECOVERY_GAP_S);
    expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): PASS \(.*, recovery gaps: 1, longest [\d.]+ s\)$/);
  }, SLOW);
}

/** Decision 22: the charge current steps from CHARGE to this while the recovery gap is open, so max(|I|) and min(|I|) differ. */
const STEP = -30;

it("Decision 19: a timeout recovery during the charge widens the integrated-current band by max(|I|) x gap / 3600 Ah", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  let fired = false;
  const r = await run("recovery-charge", {
    amps: (s) => (s >= 875 && s < 1020 ? STEP : happyAmps(s)),
    soc: (s) => (s < 720 ? 100 : s < 1020 ? 100 + Math.floor((s - 720) / 6) : 150),
    inject: (command, s) => { if (command === "22 2885" && s >= 870 && !fired) { fired = true; return null; } return undefined; },
  });
  expect(boundaries(r.lines)).toEqual(["start", "timeout"]);
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  const { log, phases } = await expectLiveEqualsReplay(r, logs);
  const boundary = r.lines.find((l) => l.dir === "meta" && l.reason === "timeout")?.t ?? NaN;
  const before = log.current.filter((p) => p.t < boundary).at(-1);
  const next = log.current.find((p) => p.t > boundary);
  if (before === undefined || next === undefined) throw new Error("no samples around the recovery");
  const gap = span(before.t, next.t);
  expect(gap).toBeGreaterThan(MAX_GAP_S);
  expect(phases.recoveryGaps).toEqual([{ seconds: gap, at: before.t }]);
  // Decision 22: different |I| on each side; the term uses the larger one, the step after the gap.
  expect([before.value, next.value]).toEqual([CHARGE, STEP]);
  const term = (Math.abs(STEP) * gap) / 3600;

  const estimate = integratedCurrentCapacity(log, phases);
  if (estimate.status !== "estimated") throw new Error(estimate.reason);
  const recovery = estimate.terms.filter((t) => t.name.startsWith("recovery gap"));
  expect(recovery).toHaveLength(1);
  expect(recovery[0].unit).toBe("Ah");
  expect(recovery[0].value).toBeCloseTo(term, 12);
  // The band is relative: the Ah terms over |Q| plus the SOC term over ΔSOC. The recovery term adds |value| x term / |Q|.
  const input = (name: string) => estimate.inputs.find((i) => i.name === name)?.value ?? NaN;
  const others = estimate.terms.filter((t) => !t.name.startsWith("recovery gap"));
  const ah = others.filter((t) => t.unit === "Ah").reduce((sum, t) => sum + t.value, 0);
  const pct = others.filter((t) => t.unit === "%").reduce((sum, t) => sum + t.value, 0);
  const without = Math.abs(estimate.value) * (ah / Math.abs(input("Q")) + pct / input("ΔSOC"));
  expect(estimate.band - without).toBeCloseTo((Math.abs(estimate.value) * term) / Math.abs(input("Q")), 12);
}, SLOW);

it("Decision 19: a recovery gap over 20 s still ends the post-charge rest run; the run stops as interrupted (Decision 23) and the gate fails", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const lost: Plan = { amps: happyAmps, inject: (command, s) => (s >= 1500 && command === "22 2414" ? "lost" : undefined) };
  const r = await run("recovery-long", { amps: happyAmps }, {
    connect: (n, clock) => {
      if (n === 1) return new FakeElm(lost, clock);
      if (n <= 4) throw new Error("dongle not found");
      return new FakeElm({ amps: happyAmps }, clock);
    },
  });
  expect(boundaries(r.lines)).toEqual(["start", "disconnect"]);
  expect(r.result).toMatchObject({ complete: false, stopReason: "post-charge rest interrupted" });
  const { log, phases } = await expectSameLog(r, logs);
  // The gap is not skipped as a recovery gap, so it ends the post-charge rest run before the boundary.
  const boundary = r.lines.find((l) => l.dir === "meta" && l.reason === "disconnect")?.t ?? NaN;
  expect(largestGap(log.current, undefined, log.recoveries).seconds).toBeGreaterThan(RECOVERY_GAP_S);
  expect(phases.postRestRun?.end).toBeLessThan(boundary);
  // Decision 23: it stops in the first cycle after the split, not at the 16 h limit.
  expect(r.endS).toBeLessThan(boundary + 3 * CYCLE_S);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): FAIL: .*post-charge rest [\d.]+ s < 1800 s/);
}, SLOW);

/** The gap between the last sample before `t` and the first after it. */
function gapAcross(samples: readonly { t: number }[], t: number): { seconds: number; at: number } {
  const before = samples.filter((p) => p.t < t).at(-1);
  const next = samples.find((p) => p.t > t);
  if (before === undefined || next === undefined) throw new Error(`no samples around t=${String(t)}`);
  return { seconds: span(before.t, next.t), at: before.t };
}
const boundaryTimes = (lines: readonly RecordingLine[]) => lines.filter((l) => isBoundary(l) && l.dir === "meta" && l.reason !== "start").map((l) => l.t);

// Decision 22 (a): the B1b review's PROBE-B2. The link drops at 22 2AF5 and two reconnects fail: the current gap is under
// RECOVERY_GAP_S, and the group-set gap, which also lost the cycle in flight, runs one cycle longer.
it("Decision 22 (a): a link loss on 22 2AF5 with two failed reconnects in the post-charge rest stops complete; live equals replay and the gate passes", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const lost: Plan = { amps: happyAmps, inject: (command, s) => (s >= 1500 && command === "22 2AF5" ? "lost" : undefined) };
  const r = await run("recovery-link-2AF5", { amps: happyAmps }, {
    connect: (n, clock) => {
      if (n === 1) return new FakeElm(lost, clock);
      if (n <= 3) throw new Error("dongle not found");
      return new FakeElm({ amps: happyAmps }, clock);
    },
  });
  expect(r.connects).toBe(4);
  expect(boundaries(r.lines)).toEqual(["start", "disconnect"]);
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  const { log, phases } = await expectLiveEqualsReplay(r, logs);
  const [boundary] = boundaryTimes(r.lines);
  const current = gapAcross(log.current, boundary);
  const groups = gapAcross(log.groups, boundary);
  expect(current.seconds).toBeGreaterThan(MAX_GAP_S);
  expect(current.seconds).toBeLessThanOrEqual(RECOVERY_GAP_S);
  expect(groups.seconds).toBeGreaterThan(RECOVERY_GAP_S);
  expect(groups.seconds).toBeLessThanOrEqual(RECOVERY_GAP_S + CYCLE_S);
  expect(phases.recoveryGaps).toEqual([current]);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): PASS \(.*, recovery gaps: 1, longest [\d.]+ s\)$/);
}, SLOW);

// Decision 22 (b): one timeout recovery at each of four cycles in the post-charge rest. The 4th gap ends the rest run.
it("Decision 22 (b): a 4th recovery gap in the post-charge rest ends the run; the logger stops as interrupted (Decision 23) and the gate fails", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const at = [1200, 1300, 1400, 1500];
  const fired = new Set<number>();
  const r = await run("recovery-rest-4", {
    amps: happyAmps,
    inject: (command, s) => {
      const t = at.find((a) => s >= a && s < a + 50);
      if (command !== "22 2414" || t === undefined || fired.has(t)) return undefined;
      fired.add(t);
      return null;
    },
  });
  expect([...fired]).toEqual(at);
  expect(boundaries(r.lines)).toEqual(["start", "timeout", "timeout", "timeout", "timeout"]);
  expect(r.result).toMatchObject({ complete: false, stopReason: "post-charge rest interrupted" });
  const { log, phases } = await expectSameLog(r, logs);
  const times = boundaryTimes(r.lines);
  for (const t of times) {
    expect(gapAcross(log.current, t).seconds).toBeGreaterThan(MAX_GAP_S);
    expect(gapAcross(log.current, t).seconds).toBeLessThanOrEqual(RECOVERY_GAP_S);
  }
  expect(phases.recoveryGaps).toHaveLength(MAX_RECOVERIES_PER_RUN);
  expect(phases.postRestRun?.end).toBe(gapAcross(log.current, times[MAX_RECOVERIES_PER_RUN]).at);
  // Decision 23: it stops in the first cycle after the split, not at the 16 h limit.
  expect(r.endS).toBeLessThan(times[MAX_RECOVERIES_PER_RUN] + 3 * CYCLE_S);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): FAIL: post-charge rest [\d.]+ s < 1800 s \(recovery gaps: 3, longest [\d.]+ s\)$/);
}, SLOW);

// Decision 22 (d): the B1b review's PROBE-C fault, 22 2AF1 unanswered in every cycle, here for 690 s of the rest before the
// charge. Each cycle's current is decoded before 2AF1 fails, so it is recorded and there is no "no current for 10 min" stop.
it("Decision 22 (d): a DID after 2414 that fails every cycle for over 10 min does not stop the run for lack of current", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const late = (s: number) => happyAmps(s - 700);
  const r = await run("recovery-every-cycle", { amps: late, inject: (command, s) => (command === "22 2AF1" && s >= 10 && s < 700 ? null : undefined) });
  expect(boundaryTimes(r.lines).length).toBeGreaterThan(SILENT_STOP_S / 15);
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  const { log } = await expectLiveEqualsReplay(r, logs);
  expect(log.current.filter((p) => p.t > 10 && p.t < 700).length).toBeGreaterThan(SILENT_STOP_S / 15);
}, SLOW);

// Decision 23: the B1b review's PROBE-C exactly, 22 2AF1 unanswered in every cycle from 1030 s, in the post-charge rest. The 4th
// recovery gap splits the rest run, and the logger stops then instead of polling to the 16 h limit.
it("Decision 23: a DID that fails every cycle through the post-charge rest stops the run as interrupted after the 4th recovery gap", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const r = await run("recovery-rest-persistent", { amps: happyAmps, inject: (command, s) => (command === "22 2AF1" && s >= 1030 ? null : undefined) });
  expect(r.result).toMatchObject({ complete: false, stopReason: "post-charge rest interrupted" });
  const { log, phases } = await expectSameLog(r, logs);
  const times = boundaryTimes(r.lines);
  expect(times.length).toBeGreaterThan(MAX_RECOVERIES_PER_RUN);
  expect(phases.recoveryGaps).toHaveLength(MAX_RECOVERIES_PER_RUN);
  expect(phases.postRestRun?.end).toBe(gapAcross(log.current, times[MAX_RECOVERIES_PER_RUN]).at);
  // Decision 25: it stops once TRANSITION_S has passed since the last charging sample (a session here is one 5 s timeout
  // plus RECOVERY_WAIT_S), not at the 16 h limit.
  const tc = lastCharging(log);
  expect(r.endS).toBeGreaterThanOrEqual(tc + TRANSITION_S);
  expect(r.endS).toBeLessThan(Math.max(times[MAX_RECOVERIES_PER_RUN], tc + TRANSITION_S) + 3 * CYCLE_S);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): FAIL: post-charge rest [\d.]+ s < 1800 s \(recovery gaps: 3, longest [\d.]+ s\)$/);
}, SLOW);

// Decision 24, the B1c review's probes A and A2: the charge window is provisional while charging can resume, so a rest
// between two charging runs is not the post-charge rest the stop rule tests.
for (const [name, amps] of [
  // Probe A: charge 120 s, rest 30 s, charge 900 s, then rest.
  ["charge-pause", (s: number) => (s < 700 ? REST : s < 720 ? -3 : s < 840 ? CHARGE : s < 870 ? REST : s < 1770 ? CHARGE : REST)],
  // Probe A2: charge 90 s, one rest sample, charge 900 s, then rest.
  ["charge-dip", (s: number) => (s < 700 ? REST : s < 720 ? -3 : s < 810 ? CHARGE : s < 815 ? REST : s < 1715 ? CHARGE : REST)],
] as const) {
  it(`Decision 24: a rest during the charge (${name}) does not stop the run; it stops complete after the post-charge rest and the gate passes`, async () => {
    const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
    const r = await run(name, { amps });
    expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
    const { phases } = await expectLiveEqualsReplay(r, logs);
    expect(phases.charge?.start).toBeGreaterThan(800);
    expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): PASS /);
  }, SLOW);
}

/** A timeout recovery at the first 22 2414 of each `at` window: the reply never comes, and a timeout session follows. */
const timeoutsAt = (at: readonly number[], fired: Set<number>) => (command: string, s: number) => {
  const t = at.find((a) => s >= a && s < a + 50);
  if (command !== "22 2414" || t === undefined || fired.has(t)) return undefined;
  fired.add(t);
  return null;
};

// Decision 23 rule 1, review probe C: the recovery at the end of the charge is a class change, so it is bridged and not
// counted; three counted gaps in the post-charge rest then stay within MAX_RECOVERIES_PER_RUN.
it("Decision 23: a recovery at a class change is bridged but not counted; three more in the post-charge rest still stop complete", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const at = [1017, 1300, 1500, 1700];
  const fired = new Set<number>();
  const r = await run("recovery-class-change", { amps: happyAmps, inject: timeoutsAt(at, fired) });
  expect([...fired]).toEqual(at);
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  const { log, phases } = await expectLiveEqualsReplay(r, logs);
  const [first] = boundaryTimes(r.lines);
  const across = log.current.filter((p) => p.t < first).at(-1);
  const next = log.current.find((p) => p.t > first);
  expect([across?.value, next?.value]).toEqual([CHARGE, REST]);
  expect(phases.recoveryGaps).toHaveLength(4);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): PASS \(.*, recovery gaps: 4, longest [\d.]+ s\)$/);
}, SLOW);

/** Charge 720–1320 s, then rest. */
const longChargeAmps = (s: number) => (s < 700 ? REST : s < 720 ? -3 : s < 1320 ? CHARGE : REST);

// Decision 22 (b), review probe D: the cap is per run, so the post-charge rest starts with none counted.
it("Decision 22 (b): three counted recovery gaps in the charge and three in the post-charge rest stop complete", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const at = [800, 950, 1100, 1500, 1700, 1900];
  const fired = new Set<number>();
  const r = await run("recovery-cap-reset", { amps: longChargeAmps, inject: timeoutsAt(at, fired) });
  expect([...fired]).toEqual(at);
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  const { phases } = await expectLiveEqualsReplay(r, logs);
  expect(phases.recoveryGaps).toHaveLength(6);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): PASS \(.*, recovery gaps: 6, longest [\d.]+ s\)$/);
}, SLOW);

// Decision 24, review probe E: a 4th counted gap in the charge fails the gate, so the phone does not say complete.
it("Decision 24: a 4th counted recovery gap in the charge stops partial after the post-charge rest, naming the gate's failed condition", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const at = [800, 950, 1100, 1250];
  const fired = new Set<number>();
  const r = await run("recovery-charge-4", { amps: longChargeAmps, inject: timeoutsAt(at, fired) });
  expect([...fired]).toEqual(at);
  const { log, phases } = await expectSameLog(r, logs);
  const gate = await gateLine(r.stream.content);
  expect(gate).toMatch(/^Gate \(T2\.4 verify line\): FAIL: .*largest current gap [\d.]+ s at t=[\d.]+ > 10 s/);
  const failed = gate.replace(/^Gate \(T2\.4 verify line\): FAIL: /, "").replace(/ \(recovery gaps: .*\)$/, "");
  expect(r.result).toMatchObject({ complete: false, stopReason: `post-charge rest logged; gate FAIL: ${failed}` });
  // Decision 25 (M8): the integrated-current estimate uses the bridged recoveries, so the 4th gap, which holds a boundary
  // and lasts under RECOVERY_GAP_S but is not bridged, is a current gap there too.
  const [, , , fourth] = boundaryTimes(r.lines);
  const estimate = integratedCurrentCapacity(log, phases);
  expect(estimate).toMatchObject({ status: "not-estimated", reason: `current gap of ${String(gapAcross(log.current, fourth).seconds)} s at t=${String(gapAcross(log.current, fourth).at)}` });
}, SLOW);

// Decision 24, review probe F: the first rest run after the charge is cut by a non-rest, non-charging taper; the run
// stops as interrupted TRANSITION_S after the last charging sample (Decision 25) instead of polling to the 16 h limit.
it("Decision 24: a taper that splits the first post-charge rest stops the run as interrupted", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const amps = (s: number) => (s < 1020 ? happyAmps(s) : s < 1030 ? -1.5 : s < 1040 ? -2.5 : REST);
  const r = await run("taper-flicker", { amps });
  expect(r.result).toMatchObject({ complete: false, stopReason: "post-charge rest interrupted" });
  const { log } = await expectSameLog(r, logs);
  const tc = lastCharging(log);
  expect(r.endS).toBeGreaterThanOrEqual(tc + TRANSITION_S);
  expect(r.endS).toBeLessThan(tc + TRANSITION_S + CYCLE_S + RECOVERY_WAIT_S);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): FAIL: .*post-charge rest [\d.]+ s < 1800 s/);
}, SLOW);

/** The t of the last charging-class current sample (Decision 25's tc). */
const lastCharging = (log: ChargeLog) => log.current.filter((p) => p.value <= CHARGE).at(-1)?.t ?? NaN;

// Decision 25, re-review probe P1: a restart after a charge pause passes through one −3 A sample span. The pause's rest run
// ended short, but charging resumes within TRANSITION_S, so the run goes on and the longer charge becomes the window.
it("Decision 25: a charge pause whose restart passes through a −3 A span stops complete; the gate passes (probe P1)", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const amps = (s: number) => (s < 700 ? REST : s < 720 ? -3 : s < 840 ? CHARGE : s < 870 ? REST : s < 880 ? -3 : s < 1770 ? CHARGE : REST);
  const r = await run("charge-pause-ramp", { amps });
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  const { phases } = await expectLiveEqualsReplay(r, logs);
  expect(phases.charge?.start).toBeGreaterThan(880);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): PASS /);
}, SLOW);

// Decision 25, probe P2: −3 A for 400 s after the charge, then rest. No rest run starts within TRANSITION_S of the charge,
// so the log cannot pass; the run stops then instead of polling to the 16 h limit (stopAt only bounds a failing run).
it("Decision 25: a −3 A taper longer than TRANSITION_S after the charge stops partial with no post-charge rest (probe P2)", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const amps = (s: number) => (s < 1020 ? happyAmps(s) : s < 1420 ? -3 : REST);
  const r = await run("taper-long", { amps }, { stopAt: 2000 });
  expect(r.result).toMatchObject({ complete: false, stopReason: `no post-charge rest within ${String(TRANSITION_S)} s of the charge` });
  const { log, phases } = await expectSameLog(r, logs);
  expect(phases.charge).toBeDefined();
  expect(phases.postRestRun).toBeUndefined();
  const tc = lastCharging(log);
  expect(r.endS).toBeGreaterThanOrEqual(tc + TRANSITION_S);
  expect(r.endS).toBeLessThan(tc + TRANSITION_S + CYCLE_S + RECOVERY_WAIT_S);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): FAIL: .*no post-charge rest window/);
}, SLOW);

// Decision 25, probe P3 (Decision 23 rule 1, M10): three LV RESET recoveries at 22 2AE3 leave current gaps under MAX_GAP_S,
// which are not counted; the one timeout at 22 2AF1 after them leaves the only counted gap, so the rest run holds.
it("Decision 25: three short LV RESET recovery gaps and one timeout gap in the post-charge rest stop complete (probe P3)", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const fired = new Set<number>();
  const r = await run("recovery-short-gaps", {
    amps: happyAmps,
    inject: (command, s) => {
      const t = [1300, 1400, 1500, 1600].find((a) => s >= a && s < a + 50);
      const target = t === 1600 ? "22 2AF1" : "22 2AE3";
      if (t === undefined || command !== target || fired.has(t)) return undefined;
      fired.add(t);
      return t === 1600 ? null : "LV RESET\r\r>";
    },
  });
  expect(fired.size).toBe(4);
  expect(boundaries(r.lines)).toEqual(["start", "lv-reset", "lv-reset", "lv-reset", "timeout"]);
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  const { log, phases } = await expectLiveEqualsReplay(r, logs);
  const gaps = boundaryTimes(r.lines).map((t) => gapAcross(log.current, t).seconds);
  for (const gap of gaps.slice(0, 3)) expect(gap).toBeLessThanOrEqual(MAX_GAP_S);
  expect(gaps[3]).toBeGreaterThan(MAX_GAP_S);
  expect(gaps[3]).toBeLessThanOrEqual(RECOVERY_GAP_S);
  expect(phases.recoveryGaps).toHaveLength(4);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): PASS \(.*, recovery gaps: 4, longest [\d.]+ s\)$/);
}, SLOW);

// Decision 25 (M9, M12): four counted recovery gaps early in the pre-charge rest; the 4th ends that rest run. The count
// starts again with the next run, so three more there are bridged (M9), and the phone's pre-rest clock restarts with it (M12).
it("Decision 25: after a 4th recovery gap ends a rest run, the next run bridges three more, live and in the pre-rest clock", async () => {
  const logs = vi.spyOn(ChargeLogBuilder.prototype, "log");
  const at = [50, 100, 150, 200, 700, 900, 1100];
  const fired = new Set<number>();
  const T0 = Date.now() / 1000;
  let plugAt: number | undefined;
  const r = await run("recovery-cap-reset-prerest", {
    amps: (s) => (s < 1300 ? REST : s < 1320 ? -3 : s < 1620 ? CHARGE : REST),
    inject: timeoutsAt(at, fired),
  }, { onStatus: (line) => { if (line === "Plug in the charger now." && plugAt === undefined) plugAt = Date.now() / 1000 - T0; } });
  expect([...fired]).toEqual(at);
  expect(r.result).toMatchObject({ complete: true, stopReason: "post-charge rest logged" });
  const { log, phases } = await expectLiveEqualsReplay(r, logs);
  const fourth = boundaryTimes(r.lines)[MAX_RECOVERIES_PER_RUN];
  const restart = log.current.find((p) => p.t > fourth)?.t ?? NaN;
  expect(phases.preRest?.start).toBe(restart);
  expect(phases.recoveryGaps).toHaveLength(3);
  expect(plugAt).toBeGreaterThanOrEqual(restart + PRE_REST_S);
  expect(await gateLine(r.stream.content)).toMatch(/^Gate \(T2\.4 verify line\): PASS \(.*, recovery gaps: 3, longest [\d.]+ s\)$/);
}, SLOW);

type LogSpy = { mock: { results: { value: unknown }[] }; mockRestore(): void };

/** The log the live stop decision used equals the replay of the flushed file, and so do their phases. */
async function expectSameLog(r: Run, logs: LogSpy): Promise<{ log: ChargeLog; phases: ChargePhases }> {
  // The last log() before the run stopped is the one the live stop decision used.
  const live = logs.mock.results.at(-1)?.value as ChargeLog;
  logs.mockRestore();
  const { log, phases } = await replay(r.stream.content);
  // toEqual ignores undefined keys: the replay's sessions and states are the only fields the live builder lacks.
  expect({ ...log, sessions: undefined, states: undefined }).toEqual(live);
  expect(phases).toEqual(chargePhases(live));
  return { log, phases };
}

/** Failure mode 13: the live log equals the replay, and the replay gate passes. */
async function expectLiveEqualsReplay(r: Run, logs: LogSpy): Promise<{ log: ChargeLog; phases: ChargePhases }> {
  const { log, phases } = await expectSameLog(r, logs);
  expect(phases.preRest && phases.charge && phases.postRest && phases.postRestRun).toBeTruthy();
  expect(phases.currentGap.seconds).toBeLessThanOrEqual(MAX_GAP_S);
  expect(phases.groupGap.seconds).toBeLessThanOrEqual(MAX_GAP_S);
  const post = phases.postRestRun ?? { start: 0, end: 0 };
  expect(span(post.start, post.end)).toBeGreaterThanOrEqual(POST_REST_S);
  return { log, phases };
}

it("Decision 16: an error that is not a link error stops the run as partial, flushed and copied, with no reconnect", async () => {
  let thrown = false;
  const r = await run("callback-error", { amps: happyAmps }, {
    onStatus: (line) => { if (line === "Plug in the charger now." && !thrown) { thrown = true; throw new Error("status display failed"); } },
  });
  expect(thrown).toBe(true);
  expect(r.result).toMatchObject({ complete: false, stopReason: "status display failed" });
  expect(boundaries(r.lines)).toEqual(["start"]);
  expect(r.connects).toBe(1);
  expect(r.endS).toBeLessThan(720);
  expect(r.recording.lines()).toEqual([]);

  // The same between sessions: the status after an LV RESET throws.
  vi.useFakeTimers({ now: new Date("2026-09-25T00:00:00Z") });
  const between = await run("callback-error-between", {
    amps: () => REST,
    inject: (command, s) => (command === "22 2AE3" && s >= 20 ? "LV RESET\r\r>" : undefined),
  }, { onStatus: (line) => { if (line.startsWith("Lost the ELM327")) throw new Error("status display failed"); } });
  expect(between.result).toMatchObject({ complete: false, stopReason: "status display failed" });
  expect(boundaries(between.lines)).toEqual(["start"]);
  expect(between.endS).toBeLessThan(30);

  // Decision 17: the final "Charge log stopped" status throws; the run still resolves with its result and the file saved.
  vi.useFakeTimers({ now: new Date("2026-09-25T00:00:00Z") });
  const final = await run("callback-error-final", { amps: () => REST }, {
    stopAt: 15,
    onStatus: (line) => { if (line.startsWith("Charge log stopped")) throw new Error("status display failed"); },
  });
  expect(final.result).toMatchObject({ complete: false, stopReason: "disconnect pressed", saved: `Saved ${FILE} to the capture folder.` });
  expect(final.statuses.at(-1)).toMatch(/^Charge log stopped: disconnect pressed\./);
  expect(final.stream.content.length).toBeGreaterThan(0);
  expect(final.recording.lines()).toEqual([]);
}, SLOW);
