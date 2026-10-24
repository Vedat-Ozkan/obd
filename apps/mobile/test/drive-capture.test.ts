// @ts-expect-error Node built-in types are not part of the mobile target.
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { latin1Decode, latin1Encode, parseRecording, type RecordingLine } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { chargeLogFromRecording } from "obd-battery/session";
import { allowedCommand } from "../../../packages/obd-core/src/elm/guard.js";
import { groupsUnderLoad } from "../../../packages/obd-battery/src/driveGroups.js";
import { RECOVERY_WAIT_S, type StreamTargets } from "../src/chargeLogger.js";
import { CONTEXT_DIDS, CONTEXT_EVERY, DRIVE_SILENT_S, GROUP_DIDS, runDriveCapture, type DriveCaptureResult } from "../src/driveCapture.js";
import { RecordingBuffer } from "../src/recording.js";
import { CODES_SCAN_COMMANDS } from "../src/codesScan.js";
import { createDriveReportHistory, preDriveReport } from "../src/driveReports.js";
import { createBatteryReportHistory, type ReportTextStore } from "../src/batteryReports.js";
import { createGarageFlow } from "../src/garage/flow.js";
import { codesReportFromRecording } from "obd-core/report";
import { driveReportFromRecording, renderDriveReport } from "../../../packages/obd-battery/src/driveReport.js";
import { batteryDiagnosisFromRecording } from "../../../packages/obd-battery/src/report.js";

async function driveCaptureSummary(lines: readonly RecordingLine[], recording: string): Promise<string> {
  const script = new URL("../../../packages/obd-battery/scripts/drive-capture.ts", import.meta.url).href;
  const module = (await import(/* @vite-ignore */ script)) as { driveCaptureSummary: (lines: readonly RecordingLine[], recording: string) => Promise<string> };
  return module.driveCaptureSummary(lines, recording);
}

const write = writeFileSync as (path: string, text: string) => void;
const signals = importObdbMode22(signalsetJson);
const FILE = "2026-09-29-test-drive.jsonl";
const META = { synthetic: true, car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "T2.13 test drive (20 min): synthetic fake ELM, T2.13 Stage A2 test", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
const SLOW = 300_000;
const BLOCK_S = 5;

beforeEach(() => { vi.useFakeTimers({ now: new Date("2026-09-29T00:00:00Z") }); });
afterEach(() => { vi.useRealTimers(); });

type Clock = () => number;
interface Plan {
  amps(s: number): number;
  inject?(command: string, s: number): string | null | undefined;
  offAt?: number;
}

const drivePlan = (s: number): number => {
  const phase = s % 30;
  return phase >= 10 && phase < 16 ? 150 : phase >= 20 && phase < 24 ? -60 : 1;
};

const hex = (bytes: readonly number[]) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
function frames(module: string, did: string, data: readonly number[]): string {
  const header = `18DAF1${module}`;
  const payload = [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16), ...data];
  if (payload.length <= 7) return `${header}${hex([payload.length, ...payload])}\r\r>`;
  const lines = [`${header}${hex([0x10 | (payload.length >> 8), payload.length & 0xff, ...payload.slice(0, 6)])}`];
  for (let i = 6, n = 1; i < payload.length; i += 7, n++) lines.push(`${header}${hex([0x20 | (n & 0x0f), ...payload.slice(i, i + 7)])}`);
  return `${lines.join("\r")}\r\r>`;
}
const GROUP_RECORDS = (() => {
  const records = Array.from({ length: 80 }, (_, i) => [...u16(39000 + (i % 5) * 2), Math.floor(i / 8) + 1]).flat();
  while (records.length < 7 * 36) records.push(0, 0, 0);
  return records;
})();

class FakeElm implements Transport {
  private target = "";
  private lost = false;
  private writes = 0;
  private reported = 1;
  private readonly listeners = new Set<(bytes: Uint8Array) => void>();
  constructor(private readonly plan: Plan, private readonly clock: Clock) {}

  write(bytes: Uint8Array): Promise<void> {
    const command = latin1Decode(bytes).replace(/\r$/, "");
    const injected = this.lost ? "lost" : this.plan.inject?.(command, this.clock());
    if (injected === "lost") { this.lost = true; return Promise.reject(new Error("BLE link lost")); }
    const reply = injected === undefined ? this.answer(command) : injected;
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

class MemoryStream implements StreamTargets {
  content = "";
  copies = 0;
  create(): string { return FILE; }
  append(name: string, text: string): void { expect(name).toBe(FILE); this.content += text; }
  copyToFolder(name: string): Promise<void> { expect(name).toBe(FILE); this.copies++; return Promise.resolve(); }
}

interface Options {
  connect?: (n: number, clock: Clock) => Transport;
  stopAt?: number;
  stop?: { requested: boolean };
  minutes?: 10 | 20;
}

interface Run { result: DriveCaptureResult; lines: RecordingLine[]; summary: string; connects: number; endS: number; statuses: string[] }

const isBoundary = (l: RecordingLine) => l.dir === "meta" && l.event === "charge-log session";
const boundaries = (lines: readonly RecordingLine[]) => lines.filter(isBoundary).map((l) => (l.dir === "meta" ? l.reason : undefined));

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
  }, options.minutes ?? 20);
  let settled = false;
  running.then(() => { settled = true; }, () => { settled = true; });
  const done = () => settled;
  while (!done()) {
    await vi.advanceTimersToNextTimerAsync();
    if (!done() && vi.getTimerCount() === 0) { await Promise.resolve(); if (!done() && vi.getTimerCount() === 0) throw new Error(`${name}: run stuck with no timer pending`); }
  }
  const result = await running;
  const endS = clock();
  vi.useRealTimers();
  write(`/tmp/t2.13-${name}.jsonl`, stream.content);
  const lines = parseRecording(stream.content);
  expectSafeAndFirstWrite(lines);
  expect(stream.copies).toBe(1);
  expect(result.file).toBe(FILE);
  const last = lines.at(-1);
  expect(last?.dir === "meta" && String(last.note)).toContain(result.stopReason);
  const summary = await driveCaptureSummary(lines, `/tmp/t2.13-${name}.jsonl`);
  write(`/tmp/t2.13-${name}-summary.md`, summary);
  return { result, lines, summary, connects, endS, statuses };
}

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
const commands = (lines: readonly RecordingLine[]): string[] => lines.flatMap((l) => l.dir === "tx" ? [l.data.replace(/\r$/, "")] : []);
const switchTo = (tt: string): string[] => [`ATSH DA${tt}F1`, `ATCRA 18DAF1${tt}`, `ATFCSH 18DA${tt}F1`];
const lastCurrentT = async (lines: readonly RecordingLine[]) => (await chargeLogFromRecording(lines, FILE, signals)).current.at(-1)?.t ?? NaN;

it("D1: the 20 min cap; the schedule, the context cadence, and the fake's resistance in the summary", async () => {
  const r = await run("d1-cap", { amps: drivePlan });
  expect(r.result.stopReason).toBe("20 min recorded");
  expect(r.endS).toBeGreaterThanOrEqual(20 * 60);
  expect(r.endS).toBeLessThan(20 * 60 + BLOCK_S);
  expect(boundaries(r.lines)).toEqual(["start"]);
  expect(r.statuses.some((s) => /^Test drive: \d+:\d\d of 20:00 recorded; \d+ current samples\.$/.test(s))).toBe(true);
  expect(r.statuses.at(-1)).toBe(`Test drive stopped: 20 min recorded. Saved ${FILE} to the capture folder.`);

  const txs = commands(r.lines.slice(0, r.lines.findIndex((l) => l.dir === "meta" && l.event === "codes rescan")));
  const first = GROUP_DIDS[0] ?? "";
  const starts = txs.flatMap((c, i) => c === `22 ${first}` ? [i] : []);
  expect(starts.length).toBeGreaterThan(100);
  for (const i of starts) {
    expect(txs.slice(i - 3, i)).toEqual(switchTo("CB"));
    expect(txs[i - 4]).toBe("22 2414");
    expect(txs.slice(i + 1, i + 7)).toEqual(GROUP_DIDS.slice(1).map((d) => `22 ${d}`));
    expect(txs.slice(i + 7, i + 10)).toEqual(switchTo("17"));
    if (i + 10 < txs.length) expect(txs[i + 10]).toBe("22 2414");
  }
  const contexts = txs.flatMap((c, i) => c === `22 ${CONTEXT_DIDS[0] ?? ""}` ? [i] : []);
  expect(contexts.length).toBe(Math.ceil(starts.length / CONTEXT_EVERY));
  contexts.forEach((i, n) => {
    expect(txs.slice(i - 3, i)).toEqual(switchTo("CB"));
    expect(txs.slice(i, i + 3)).toEqual(CONTEXT_DIDS.map((d) => `22 ${d}`));
    expect(txs.slice(i + 3, i + 6)).toEqual(switchTo("17"));
    expect(starts.filter((g) => g < i).length).toBe(n * CONTEXT_EVERY);
  });

  expect(value(r.summary, "Current, fast", "median")).toBeLessThan(value(r.summary, "Current, across a group read", "median"));
  expect(r.summary).toMatch(/Complete group sets: [1-9]\d*, dropped 0/);
  expect(r.summary).toContain("## Groups under load");
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

it("D2: car off; the run stops after 60 s without current and the groups section is not-checked", async () => {
  const r = await run("d2-car-off", { amps: drivePlan, offAt: 60 });
  expect(r.result.stopReason).toBe("no current for 60 s (car off or not in Ready)");
  const last = await lastCurrentT(r.lines);
  expect(last).toBeGreaterThan(50);
  expect(r.endS - last).toBeGreaterThanOrEqual(DRIVE_SILENT_S);
  expect(r.endS - last).toBeLessThanOrEqual(DRIVE_SILENT_S + RECOVERY_WAIT_S + BLOCK_S);
  expect(r.summary).toContain("Stop: no current for 60 s (car off or not in Ready)");
  expect(r.summary).toMatch(/- Status: not-checked \(fewer than 10 steady sets at or above 50 A \(\d+\)\)/);
}, SLOW);

it("D3: an unanswered read and a lost link each start a new session; the file replays with timeout markers", async () => {
  let unanswered: number | undefined;
  let lostAt: number | undefined;
  let afterGroups = false;
  const plan: Plan = {
    amps: drivePlan,
    inject: (command, s) => {
      if (command === "22 2885" && s >= 100 && unanswered === undefined) { unanswered = s; return null; }
      if (command === "22 2AE7" && s >= 200) afterGroups = true;
      if (command === "22 2414" && afterGroups && lostAt === undefined) { lostAt = s; return "lost"; }
      return undefined;
    },
  };
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

  const log = await chargeLogFromRecording(r.lines, FILE, signals);
  const straddles = (t: number): boolean => {
    const before = log.current.filter((c) => c.t < t).at(-1);
    const after = log.current.find((c) => c.t >= t);
    return before !== undefined && after !== undefined && marks.some((m) => m > before.t && m < after.t);
  };
  const straddling = log.groups.filter((g) => straddles(g.t));
  expect(straddling.length).toBeGreaterThan(0);
  expect(groupsUnderLoad({ ...log, groups: log.groups.filter((g) => !straddles(g.t)) }).steadySets).toBe(groupsUnderLoad(log).steadySets);
}, SLOW);

it("D4: Disconnect mid-block stops with its reason; the partial file is saved and summarised", async () => {
  const stop = { requested: false };
  const r = await run("d4-disconnect", { amps: drivePlan, inject: (command, s) => { if (command === "22 2AE3" && s >= 50) stop.requested = true; return undefined; } }, { stop });
  expect(r.result.stopReason).toBe("disconnect pressed");
  expect(r.result.saved).toBe(`Saved ${FILE} to the capture folder.`);
  expect(r.summary).toContain("Stop: disconnect pressed");
  expect(r.summary).toMatch(/Complete group sets: [1-9]\d*, dropped 1/);
}, SLOW);

it("D5: 7F 22 21 is re-sent once; a second 7F 22 21 is kept and the set is dropped", async () => {
  const busy = "18DAF1CB037F2221\r\r>";
  let block = 0;
  let once = 0;
  let twice = 0;
  const plan: Plan = {
    amps: drivePlan,
    inject: (command) => {
      if (command === "22 2AE1") block++;
      if (command === "22 2AE3" && block === 1 && once++ === 0) return busy;
      if (command === "22 2AE5" && block === 2 && twice++ < 2) return busy;
      return undefined;
    },
  };
  const r = await run("d5-resend", plan, { minutes: 10 });
  const txs = commands(r.lines.slice(0, r.lines.findIndex((l) => l.dir === "meta" && l.event === "codes rescan")));
  const at = (did: string): number[] => txs.flatMap((c, i) => c === `22 ${did}` ? [i] : []);
  const [a, b] = at("2AE3");
  expect(b).toBe(a + 1);
  expect(txs[b + 1]).toBe("22 2AE4");
  const sends = at("2AE5");
  expect(sends[2]).toBe((sends[1] ?? 0) + 1);
  expect(txs[(sends[2] ?? 0) + 1]).toBe("22 2AE6");
  expect(txs.some((c, i) => c.startsWith("22 ") && c === txs[i + 1] && c === txs[i + 2])).toBe(false);
  expect(r.lines.filter((l) => l.dir === "rx" && l.data.includes("037F2221")).length).toBe(3);
  expect(r.summary).toMatch(/Complete group sets: [1-9]\d*, dropped 1\n/);
  expect((await chargeLogFromRecording(r.lines, FILE, signals)).groups.length).toBe(at(GROUP_DIDS[0] ?? "").length - 1);
}, SLOW);

it("D6: the 10 min option stops with its own reason and status lines", async () => {
  const r = await run("d6-ten", { amps: drivePlan }, { minutes: 10 });
  expect(r.result.stopReason).toBe("10 min recorded");
  expect(r.endS).toBeGreaterThanOrEqual(10 * 60);
  expect(r.endS).toBeLessThan(10 * 60 + BLOCK_S);
  expect(r.statuses.some((s) => /^Test drive: \d+:\d\d of 10:00 recorded; \d+ current samples\.$/.test(s))).toBe(true);
  expect(r.statuses.some((s) => s.includes("of 20:00"))).toBe(false);
  expect(r.summary).toContain("Stop: 10 min recorded");
}, SLOW);

const readText = readFileSync as unknown as (path: string | URL, encoding: string) => string;
const repo = new URL("../../../", import.meta.url);
const STORED = "7E80443010133\r\r>";
const rescanStart = (lines: readonly RecordingLine[]) => lines.findIndex((l) => l.dir === "meta" && l.event === "codes rescan");
const driveInput = (stopReason: string) => ({ garageVehicleId: "1", scannedAt: "2026-09-29T00:20:00.000Z", recording: FILE, minutes: 20 as const, stopReason, signals });
const storedAnswer = (command: string): string | undefined => command === "03" ? STORED : undefined;

async function parkedReport() {
  const before = "fixtures/synthetic/codes-compare-before.jsonl";
  const full = "fixtures/synthetic/battery-diagnosis-full-scan.jsonl";
  const report = await batteryDiagnosisFromRecording(readText(new URL(full, repo), "latin1"), { garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-28T23:00:00.000Z", recording: full, scanStatus: "complete" }, signals);
  return { ...report, codes: await codesReportFromRecording(parseRecording(readText(new URL(before, repo), "latin1"))) };
}

it("D7: the cap rescans the codes in the same recording and the report compares them with the parked scan", async () => {
  const r = await run("d7-rescan", { amps: drivePlan, inject: storedAnswer });
  const at = rescanStart(r.lines);
  expect(at).toBeGreaterThan(0);
  const after = r.lines.slice(at);
  expect(commands(after)).toEqual(CODES_SCAN_COMMANDS);
  expect(r.result.rescan).toBe("ran");
  const parked = await parkedReport();
  const report = await driveReportFromRecording(readText("/tmp/t2.13-d7-rescan.jsonl", "latin1"), driveInput(r.result.stopReason), parked);
  const text = renderDriveReport(report);
  write("/tmp/t2.13-c-d7.md", text);
  expect(report.codes.status).toBe("compared");
  expect(text).toContain("stored: gone P0171; unchanged P0133");
  expect(text).toContain("Compared with the parked scan of 2026-09-28T23:00:00.000Z");
}, SLOW);

it("D8: car off sends no rescan and the report says car off", async () => {
  const r = await run("d8-car-off", { amps: drivePlan, offAt: 60 });
  expect(rescanStart(r.lines)).toBe(-1);
  expect(r.result.rescan).toBe("not run");
  const report = await driveReportFromRecording(readText("/tmp/t2.13-d8-car-off.jsonl", "latin1"), driveInput(r.result.stopReason));
  expect(report.codes).toEqual({ status: "not-run", reason: "car off" });
}, SLOW);

it("D9: Disconnect still rescans", async () => {
  const stop = { requested: false };
  const r = await run("d9-disconnect", { amps: drivePlan, inject: (command, s) => { if (command === "22 2AE3" && s >= 50) stop.requested = true; return storedAnswer(command); } }, { stop });
  expect(r.result.stopReason).toBe("disconnect pressed");
  expect(r.result.rescan).toBe("ran");
  expect(commands(r.lines.slice(rescanStart(r.lines)))).toEqual(CODES_SCAN_COMMANDS);
}, SLOW);

it("D10: a rescan refused with UNABLE TO CONNECT is not-run with that reason and the drive file is still saved", async () => {
  const r = await run("d10-refused", { amps: drivePlan, inject: (command, s) => command === "0100" && s >= 20 * 60 ? "UNABLE TO CONNECT\r\r>" : undefined });
  expect(r.result.saved).toBe(`Saved ${FILE} to the capture folder.`);
  expect(r.result.stopReason).toBe("20 min recorded");
  const report = await driveReportFromRecording(readText("/tmp/t2.13-d10-refused.jsonl", "latin1"), driveInput(r.result.stopReason));
  expect(report.codes.status).toBe("not-run");
  expect(JSON.stringify(report.codes)).toContain("UNABLE TO CONNECT");
  expect(report.groups.status).toBe("checked");
}, SLOW);

it("C6: drive reports save to their own history and leave a parked-only battery history loading", async () => {
  let driveText: string | undefined;
  let batteryText: string | undefined;
  const memory = (get: () => string | undefined, set: (t: string) => void): ReportTextStore => ({ read: () => Promise.resolve(get()), write: (t) => { set(t); return Promise.resolve(); } });
  const drives = createDriveReportHistory(memory(() => driveText, (t) => { driveText = t; }));
  const report = await driveReportFromRecording(readText("/tmp/t2.13-d7-rescan.jsonl", "latin1"), driveInput("20 min recorded"));
  await drives.save(report);
  expect((await drives.list("1")).map((x) => x.recording)).toEqual([FILE]);
  expect(await drives.list("2")).toEqual([]);

  let garageText: string | undefined;
  const garage = createGarageFlow(memory(() => garageText, (t) => { garageText = t; }));
  await garage.add("chevrolet-equinox-ev-2024", "mine");
  const parked = await parkedReport();
  const batteries = createBatteryReportHistory(memory(() => batteryText, (t) => { batteryText = t; }), garage);
  await batteries.save(parked);
  const reloaded = createBatteryReportHistory(memory(() => batteryText, (t) => { batteryText = t; }), garage);
  const list = await reloaded.list("1");
  expect(list).toHaveLength(1);
  expect(batteryText).not.toContain("groupRule");
  expect(preDriveReport(list, new Date("2026-09-29T00:00:00Z"))?.scannedAt).toBe(parked.scannedAt);
  expect(preDriveReport(list, new Date("2026-09-30T00:00:00Z"))).toBeUndefined();
});
