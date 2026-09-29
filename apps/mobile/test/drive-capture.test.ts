// T2.12 Stage A E2E cases D1-D4: docs/specs/T2.12-test-drive-capture.md §Verification. Each case drives runDriveCapture against a
// fake ELM on a fake clock, and the flushed file goes through driveCaptureSummary. Artifacts: /tmp/t2.12-<case>.jsonl and
// /tmp/t2.12-<case>-summary.md. Everything the fake ELM answers is synthetic; its encodings follow the spec's §Sources scalings.
// @ts-expect-error Node built-in types are not part of the mobile target.
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { latin1Decode, latin1Encode, parseRecording, type RecordingLine } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { chargeLogFromRecording } from "obd-battery/session";
import { allowedCommand } from "../../../packages/obd-core/src/elm/guard.js";
import { RECOVERY_WAIT_S, type StreamTargets } from "../src/chargeLogger.js";
import { DRIVE_S, DRIVE_SILENT_S, runDriveCapture, type DriveCaptureResult } from "../src/driveCapture.js";
import { RecordingBuffer } from "../src/recording.js";

/** The script is Node-only, so it is imported by URL, outside the mobile typecheck (as charge-logger.test.ts does for charge-log.ts). */
async function driveCaptureSummary(lines: readonly RecordingLine[], recording: string): Promise<string> {
  const script = new URL("../../../packages/obd-battery/scripts/drive-capture.ts", import.meta.url).href;
  const module = (await import(/* @vite-ignore */ script)) as { driveCaptureSummary: (lines: readonly RecordingLine[], recording: string) => Promise<string> };
  return module.driveCaptureSummary(lines, recording);
}

const write = writeFileSync as (path: string, text: string) => void;
const signals = importObdbMode22(signalsetJson);
const FILE = "2026-09-29-test-drive.jsonl";
const META = { synthetic: true, car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "T2.12 test drive: synthetic fake ELM, T2.12 Stage A test", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
const SLOW = 300_000;
/** A block is about 3 s (spec §Design); the cap is checked after every pair, so this is generous. */
const BLOCK_S = 5;

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-09-29T00:00:00Z") }); });
afterEach(() => { vi.useRealTimers(); });

// ---- The fake ELM --------------------------------------------------------------------------------------------

type Clock = () => number;
interface Plan {
  /** Pack current (A, positive = out of the pack) at run time s. */
  amps(s: number): number;
  /** Overrides the reply: a string (with '>'), null = never answer, "lost" = the write rejects. */
  inject?(command: string, s: number): string | null | undefined;
  /** From this run time on the car is off: every 22 answers NO DATA and 0100 answers UNABLE TO CONNECT. */
  offAt?: number;
}

/** 1 A idle, +150 A for 6 s from s = 10 of every 30 s, and -60 A for 4 s from s = 20 (spec §Verification, fake ELM). */
const drivePlan = (s: number): number => {
  const phase = s % 30;
  return phase >= 10 && phase < 16 ? 150 : phase >= 20 && phase < 24 ? -60 : 1;
};

const hex = (bytes: readonly number[]) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
/** ISO-TP frames as the ELM prints them with ATH1 and ATS0. */
function frames(module: string, did: string, data: readonly number[]): string {
  const header = `18DAF1${module}`;
  const payload = [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16), ...data];
  if (payload.length <= 7) return `${header}${hex([payload.length, ...payload])}\r\r>`;
  const lines = [`${header}${hex([0x10 | (payload.length >> 8), payload.length & 0xff, ...payload.slice(0, 6)])}`];
  for (let i = 6, n = 1; i < payload.length; i += 7, n++) lines.push(`${header}${hex([0x20 | (n & 0x0f), ...payload.slice(i, i + 7)])}`);
  return `${lines.join("\r")}\r\r>`;
}
// CB/2AE1-2AE7: 80 records [u16 x 0.0001 V][module 1-10] plus 4 zero records.
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
  /** The current the last 22 2414 reported: 2885 answers for the same instant, so each pair is self-consistent. */
  private reported = 1;
  private readonly listeners = new Set<(bytes: Uint8Array) => void>();
  constructor(private readonly plan: Plan, private readonly clock: Clock) {}

  write(bytes: Uint8Array): Promise<void> {
    const command = latin1Decode(bytes).replace(/\r$/, "");
    const injected = this.lost ? "lost" : this.plan.inject?.(command, this.clock());
    if (injected === "lost") { this.lost = true; return Promise.reject(new Error("BLE link lost")); }
    const reply = injected === undefined ? this.answer(command) : injected;
    // Single reads 68-82 ms, AT 20-40 ms (spec §Design, from T2.4's recorded reply times).
    const latency = command.startsWith("22 ") ? 68 + (this.writes++ % 15) : 20 + (this.writes++ % 21);
    if (reply !== null) setTimeout(() => { this.listeners.forEach((cb) => { cb(latin1Encode(reply)); }); }, latency);
    return Promise.resolve();
  }

  onData(cb: (bytes: Uint8Array) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  close(): Promise<void> { this.lost = true; this.listeners.clear(); return Promise.resolve(); }

  private answer(command: string): string {
    const s = this.clock();
    const off = this.plan.offAt !== undefined && s >= this.plan.offAt;
    if (command === "ATZ") return "\r\rELM327 v1.5\r\r>";
    if (command === "ATI") return "ELM327 v1.5\r\r>";
    if (command === "ATDPN") return "A0\r\r>";
    if (command === "ATRV") return "12.7V\r\r>";
    if (command === "0100") return off ? "UNABLE TO CONNECT\r\r>" : "18DAF1CB06410080000001\r\r>";
    if (command.startsWith("ATSH DA")) this.target = command.slice(7, 9);
    if (command.startsWith("AT")) return "OK\r\r>";
    const did = command.slice(3);
    if (off) return "NO DATA\r\r>";
    // 17/2414 s16 / 20 A; 17/2885 u16 / 100 V; CB/2B43 byte x 100/255 %; CB/2AF5 u16 / 10000 V (spec §Sources).
    if (this.target === "17" && did === "2414") { this.reported = this.plan.amps(s); return frames("17", did, u16(Math.round(this.reported * 20) & 0xffff)); }
    if (this.target === "17" && did === "2885") return frames("17", did, u16(Math.round((330 - 0.1 * this.reported) * 100)));
    if (this.target === "CB" && did === "2B43") return frames("CB", did, [128]);
    if (this.target === "CB" && did === "2AF5") return frames("CB", did, [...u16(39004), ...u16(39000), ...u16(39008)]);
    if (this.target === "CB" && did === "2AF1") return frames("CB", did, [0x12, 0x34]);
    const group = GROUP_DIDS.indexOf(did);
    if (this.target === "CB" && group >= 0) return frames("CB", did, GROUP_RECORDS.slice(group * 36, group * 36 + 36));
    return "NO DATA\r\r>";
  }
}

// ---- The harness ------------------------------------------------------------------------------------------------

class MemoryStream implements StreamTargets {
  content = "";
  copies = 0;
  create(): string { return FILE; }
  append(name: string, text: string): void { expect(name).toBe(FILE); this.content += text; }
  copyToFolder(name: string): Promise<void> { expect(name).toBe(FILE); this.copies++; return Promise.resolve(); }
}

interface Options {
  /** n = 1 for the first call. Returns a transport or throws. */
  connect?: (n: number, clock: Clock) => Transport;
  stopAt?: number;
  /** Set true by a test to request a stop, e.g. from inside a plan's inject. */
  stop?: { requested: boolean };
}

interface Run { result: DriveCaptureResult; lines: RecordingLine[]; summary: string; connects: number; endS: number; statuses: string[] }

const isBoundary = (l: RecordingLine) => l.dir === "meta" && l.event === "charge-log session";
const boundaries = (lines: readonly RecordingLine[]) => lines.filter(isBoundary).map((l) => (l.dir === "meta" ? l.reason : undefined));

/** In every case: only allowlisted commands, no 0902 or 22 4193, and ATZ first after each session boundary. */
function expectSafeAndFirstWrite(lines: readonly RecordingLine[]): void {
  for (const line of lines) {
    if (line.dir !== "tx") continue;
    const command = line.data.replace(/\r$/, "");
    expect(allowedCommand(command), command).toBeDefined();
    expect(command.replace(/ /g, "")).not.toBe("0902");
    expect(command.replace(/ /g, "")).not.toBe("224193");
  }
  lines.forEach((line, i) => {
    if (!isBoundary(line)) return;
    const next = lines.slice(i + 1).find((l) => l.dir === "tx" || isBoundary(l));
    if (next?.dir === "tx") expect(next.data).toBe("ATZ\r");
  });
}

async function run(name: string, plan: Plan, options: Options = {}): Promise<Run> {
  const t0 = Date.now() / 1000;
  const clock: Clock = () => Date.now() / 1000 - t0;
  const recording = new RecordingBuffer(() => Date.now() / 1000);
  recording.start(META);
  const stream = new MemoryStream();
  const statuses: string[] = [];
  let connects = 0;
  const running = runDriveCapture({
    connect: async () => {
      connects++;
      await Promise.resolve();
      return options.connect ? options.connect(connects, clock) : new FakeElm(plan, clock);
    },
    recording,
    signals,
    now: () => Date.now() / 1000,
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    onStatus: (line) => { statuses.push(line); },
    stream,
    stopRequested: () => options.stop?.requested === true || (options.stopAt !== undefined && clock() >= options.stopAt),
  });
  let settled = false;
  running.then(() => { settled = true; }, () => { settled = true; });
  // A function, not the variable inline: TypeScript would keep the declaration's narrowing across the awaits.
  const done = () => settled;
  while (!done()) {
    await vi.advanceTimersToNextTimerAsync();
    if (!done() && vi.getTimerCount() === 0) { await Promise.resolve(); if (!done() && vi.getTimerCount() === 0) throw new Error(`${name}: run stuck with no timer pending`); }
  }
  const result = await running;
  const endS = clock();
  vi.useRealTimers();
  write(`/tmp/t2.12-${name}.jsonl`, stream.content);
  const lines = parseRecording(stream.content);
  expectSafeAndFirstWrite(lines);
  expect(stream.copies).toBe(1);
  expect(result.file).toBe(FILE);
  const last = lines.at(-1);
  expect(last?.dir === "meta" && String(last.note)).toContain(result.stopReason);
  const summary = await driveCaptureSummary(lines, `/tmp/t2.12-${name}.jsonl`);
  write(`/tmp/t2.12-${name}-summary.md`, summary);
  return { result, lines, summary, connects, endS, statuses };
}

/** The first number after `label` in the summary line that starts with `- <prefix>`. */
const value = (summary: string, prefix: string, label: string): number => {
  const line = summary.split("\n").find((l) => l.startsWith(`- ${prefix}`)) ?? "";
  const match = new RegExp(`${label} ([0-9.]+)`).exec(line);
  expect(match, `${prefix} / ${label} in: ${line}`).not.toBeNull();
  return Number(match?.[1]);
};
const stepRows = (summary: string) => summary.split("\n").filter((l) => /^\| [0-9]/.test(l)).map((row) => {
  const cells = row.split("|").map((c) => c.trim());
  return { t: Number(cells[1]), dt: Number(cells[2]), lines: (cells[6] ?? "").split(",").map((n) => Number(n)) };
});
const txAt = (lines: readonly RecordingLine[], number: number): string => {
  const line = lines.at(number - 1);
  return line?.dir === "tx" ? line.data.replace(/\r$/, "") : "";
};
const lastCurrentT = async (lines: readonly RecordingLine[]) => (await chargeLogFromRecording(lines, FILE, signals)).current.at(-1)?.t ?? NaN;

// ---- Cases ------------------------------------------------------------------------------------------------------

it("D1: the 20 min cap; the summary recovers the fake's resistance and cites real tx lines", async () => {
  const r = await run("d1-cap", { amps: drivePlan });
  expect(r.result.stopReason).toBe("20 min recorded");
  expect(r.endS).toBeGreaterThanOrEqual(DRIVE_S);
  expect(r.endS).toBeLessThan(DRIVE_S + BLOCK_S);
  expect(boundaries(r.lines)).toEqual(["start"]);
  expect(r.statuses.some((s) => /^Test drive: \d+:\d\d of 20:00 recorded; \d+ current samples\.$/.test(s))).toBe(true);
  expect(r.statuses.at(-1)).toBe(`Test drive stopped: 20 min recorded. Saved ${FILE} to the capture folder.`);
  expect(value(r.summary, "Current, fast", "median")).toBeLessThan(value(r.summary, "Current, across a group read", "median"));
  expect(r.summary).toMatch(/Complete group sets: [1-9]\d*, dropped 0/);
  const steps = Number(/- Steps: (\d+)/.exec(r.summary)?.[1]);
  expect(steps).toBeGreaterThan(0);
  expect(value(r.summary, "R (mΩ)", "median")).toBeGreaterThanOrEqual(98);
  expect(value(r.summary, "R (mΩ)", "median")).toBeLessThanOrEqual(102);
  const rows = stepRows(r.summary);
  expect(rows.length).toBe(10);
  for (const row of rows) {
    expect(row.lines.map((n) => txAt(r.lines, n))).toEqual(["22 2414", "22 2885", "22 2414", "22 2885"]);
  }
}, SLOW);

it("D2: car off; the run stops after 60 s without current", async () => {
  const r = await run("d2-car-off", { amps: drivePlan, offAt: 300 });
  expect(r.result.stopReason).toBe("no current for 60 s (car off or not in Ready)");
  const last = await lastCurrentT(r.lines);
  expect(last).toBeGreaterThan(290);
  expect(r.endS - last).toBeGreaterThanOrEqual(DRIVE_SILENT_S);
  expect(r.endS - last).toBeLessThanOrEqual(DRIVE_SILENT_S + RECOVERY_WAIT_S + BLOCK_S);
  expect(r.summary).toContain("Stop: no current for 60 s (car off or not in Ready)");
}, SLOW);

it("D3: an unanswered read and a lost link each start a new session; the file replays with timeout markers", async () => {
  let unanswered: number | undefined;
  let lostAt: number | undefined;
  const plan: Plan = {
    amps: drivePlan,
    inject: (command, s) => {
      if (command === "22 2885" && s >= 100 && unanswered === undefined) { unanswered = s; return null; }
      if (command === "22 2414" && s >= 200 && lostAt === undefined) { lostAt = s; return "lost"; }
      return undefined;
    },
  };
  // The first transport carries both faults; the reconnect gets a healthy one (its inject flags are already set).
  const r = await run("d3-recovery", plan, { stopAt: 300 });
  expect(unanswered).toBeDefined();
  expect(lostAt).toBeDefined();
  expect(r.connects).toBe(2);
  expect(boundaries(r.lines)).toEqual(["start", "timeout", "disconnect"]);
  for (const [command, s] of [["22 2885", unanswered ?? 0], ["22 2414", lostAt ?? 0]] as const) {
    const at = r.lines.findIndex((l) => l.dir === "tx" && l.data === `${command}\r` && l.t >= s - 0.001);
    expect(at).toBeGreaterThan(0);
    const next = r.lines.findIndex((l, i) => i > at && l.dir === "tx");
    const between = r.lines.slice(at + 1, next < 0 ? r.lines.length : next);
    expect(between.some((l) => l.dir === "meta" && typeof l.note === "string" && l.note.startsWith("timeout waiting for '>'")), `${command} at ${String(s)}`).toBe(true);
  }
  expect(r.summary).toMatch(/Sessions: 3 \(timeout at t=[0-9.]+; disconnect at t=[0-9.]+\)/);
  const marks = r.lines.filter(isBoundary).map((l) => l.t);
  for (const row of stepRows(r.summary)) expect(marks.some((m) => m > row.t && m < row.t + row.dt), `step at ${String(row.t)}`).toBe(false);
}, SLOW);

it("D4: Disconnect mid-block stops with its reason; the partial file is saved and summarised", async () => {
  const stop = { requested: false };
  const r = await run("d4-disconnect", { amps: drivePlan, inject: (command, s) => { if (command === "22 2AE3" && s >= 50) stop.requested = true; return undefined; } }, { stop });
  expect(r.result.stopReason).toBe("disconnect pressed");
  expect(r.result.saved).toBe(`Saved ${FILE} to the capture folder.`);
  expect(r.summary).toContain("Stop: disconnect pressed");
  expect(r.summary).toMatch(/Complete group sets: [1-9]\d*, dropped 1/);
}, SLOW);
