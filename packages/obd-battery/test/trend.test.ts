import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importObdbMode22 } from "obd-core/vehicles";
import type { CodesReport } from "obd-core/report";
import { trendReportFromPaths } from "../scripts/trend-report.js";
import { bmsEnergyCapacity, bmsFigure } from "../src/capacity.js";
import type { BatteryDiagnosisReport } from "../src/report.js";
import { batteryDiagnosisFromRecording } from "../src/report.js";
import { chargeLogFromRecording } from "../src/session.js";
import { TREND_POLICY, groupZ, pointsFromReports, trendFlags, trendsByMethod, weightedTrend, type SessionPoint, type TrendResult } from "../src/trend.js";
import { renderTrendReport } from "../src/trendReport.js";

const root = new URL("../../../", import.meta.url);
const base = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const DAY_MS = 86_400_000;
const START = Date.parse("2025-10-01T00:00:00.000Z");
const at = (days: number) => new Date(START + days * DAY_MS).toISOString();

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussian = (next: () => number) => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());

const emptyModule = (ecu: string, stored: string[]): CodesReport["modules"][number] => ({
  ecu, stored: { status: "read", dtcs: stored }, pending: { status: "read", dtcs: [] }, permanent: { status: "read", dtcs: [] },
  readiness: { status: "not-read" }, pids: { "21": { status: "not-read" }, "30": { status: "not-read" }, "31": { status: "not-read" }, "4D": { status: "not-read" }, "4E": { status: "not-read" } },
  freezeFrame: { status: "not-read" },
});
const codes = (stored: string[]): CodesReport => ({
  modules: [emptyModule("7E0", stored)],
  recentlyCleared: { verdict: "unknown", strong: false, legs: { noStoredDtcs: "unknown", monitorsIncomplete: "unknown", countersLow: "unknown", permanentDtcs: "unknown" } },
});

const baseVolts = (offsets: Readonly<Record<number, number>> = {}) =>
  Array.from({ length: 80 }, (_, g) => Math.round((3.9 + ((g * 7) % 5 - 2) * 0.0005 + (offsets[g] ?? 0)) * 10000) / 10000);

interface MakeReport { id: number; day: number; capacityKwh: number; soc?: number; volts?: number[]; stored?: string[]; scanStatus?: "complete" | "partial"; restingV?: number }
function makeReport(o: MakeReport): BatteryDiagnosisReport {
  const recording = `synthetic-series/${String(o.id)}`;
  const soc = o.soc ?? 60;
  const energy = Math.round(((o.capacityKwh * soc) / 100) * 200) / 200;
  const source = { recording, command: "22 27AF", ecu: "CB" };
  const volts = o.volts ?? baseVolts();
  return {
    version: 1, garageVehicleId: "private-garage-id", catalogId: "chevrolet-equinox-ev-2024", scannedAt: at(o.day), recording, scanStatus: o.scanStatus ?? "complete", signals: [],
    parked: {
      bmsFigure: { valueKwh: energy / (soc / 100), energyKwh: energy, socPercent: soc, tier: "verified", energySource: source, socSource: { ...source, command: "22 2B43" } },
      groupVoltages: { volts, modules: Array.from({ length: 80 }, (_, i) => 1 + (i >> 3)), sources: [], completeSets: 1 },
    },
    twelveVolt: { observations: o.restingV === undefined ? [] : [{ source: "adapter-supply", command: "ATRV", volts: o.restingV, powerState: "other", recording }], batteryHealth: "not-assessed", rechargeAdvice: "not-assessed", reason: "synthetic" },
    codes: codes(o.stored ?? []),
    capacity: { status: "not-measured", reason: "synthetic" }, health: { status: "not-assessed", reason: "synthetic" },
  };
}

function fadingSeries(seed: number, fadePerYear: number, count = 10, spacingDays = 40): BatteryDiagnosisReport[] {
  const next = rng(seed);
  return Array.from({ length: count }, (_, k) => {
    const days = k * spacingDays;
    const capacity = 85 * (1 - (fadePerYear * days) / 365.25);
    return makeReport({ id: k, day: days, capacityKwh: capacity + gaussian(next) * 0.1 });
  });
}
const trends = (reports: readonly BatteryDiagnosisReport[]): TrendResult[] => trendsByMethod(pointsFromReports(reports).points);
const flagsAt = (reports: readonly BatteryDiagnosisReport[], k: number) => trendFlags(reports.slice(0, k), [], trends(reports.slice(0, k)));

const pt = (id: string, days: number, value: number, band = 0.4, method: SessionPoint["method"] = "bms-kwh"): SessionPoint =>
  ({ id, at: at(days), method, value, band, unit: method === "bms-kwh" ? "kWh" : "Ah" });
const asTrend = (r: TrendResult) => { if (r.status !== "trend") throw new Error(`expected trend, got ${r.reason}`); return r; };

describe("E2E real recordings", () => {
  it("prints not-enough-data for both methods and lists every session", async () => {
    const paths = ["2026-09-30-test-drive", "2026-09-30-test-drive-2", "2026-09-24-phone-console", "2026-09-24-phone-console-2"].map((n) => `${base}${n}.redacted.jsonl`);
    const text = await trendReportFromPaths(paths);
    writeFileSync("/tmp/trend-report-real.md", text);
    expect(text).toContain("BMS-referenced capacity index, not state of health");
    expect(text).toMatch(/### bms-kwh[^\n]*\n\nNot enough data yet: 0 sessions over 0 days/);
    expect(text).toMatch(/### integrated-ah[^\n]*\n\nNot enough data yet: 0 sessions over 0 days/);
    for (const p of paths) expect(text).toContain(p);
    expect(text).toMatch(/Rejected[\s\S]*test-drive\.redacted\.jsonl[^\n]*no pre-charge rest window/);
    expect(text).toMatch(/Drive groups[\s\S]*(none flagged|group \d+)/);
    expect(text).not.toContain("private");
  }, 120_000);

  it("synthetic charge log shows one labelled integrated-Ah session and the power table", async () => {
    const text = await trendReportFromPaths(["fixtures/synthetic/charge-log-rested.jsonl"]);
    writeFileSync("/tmp/trend-report-synthetic.md", text);
    expect(text).toMatch(/synthetic/i);
    expect(text).toMatch(/\(undated, synthetic\): integrated-ah 1[12]\.\d+ Ah/);
    expect(text).toContain("Charge power by SOC");
    expect(text).toMatch(/Not enough data yet: 1 sessions? over 0 days/);
  }, 120_000);
});

describe("E2E seeded series", () => {
  const series = fadingSeries(1, 0.03);

  it("(a) 10 sessions over 12 months at 3 %/yr: trend within 2 SE of 3", () => {
    const kwh = asTrend(trends(series).find((t) => t.method === "bms-kwh") as TrendResult);
    expect(kwh.fit.n).toBe(10);
    expect(Math.abs(kwh.fit.fadePctPerYear - 3)).toBeLessThanOrEqual(2 * kwh.fit.sePerYear * 100);
  });

  it("(b) weak group from session 6: absent at 6-7, present once 3 of the last 5 hold", () => {
    const weak = series.map((r, k) => k >= 5 ? makeReport({ id: k, day: k * 40, capacityKwh: r.parked?.bmsFigure?.valueKwh ?? 85, volts: baseVolts({ 17: -0.01 }) }) : r);
    const kinds = (k: number) => flagsAt(weak, k).filter((f) => f.kind === "weak-group").length;
    expect([5, 6, 7].map(kinds)).toEqual([0, 0, 0]);
    expect(kinds(8)).toBe(1);
    expect(flagsAt(weak, 8).find((f) => f.kind === "weak-group")?.detail).toContain("group 18");
    expect(kinds(10)).toBe(1);
  });

  it("(b) boundary: fewer than 5 checks never flag, 5 of 5 flags", () => {
    const allWeak = Array.from({ length: 5 }, (_, k) => makeReport({ id: k, day: k * 40, capacityKwh: 85, volts: baseVolts({ 17: -0.01 }) }));
    expect([3, 4].map((k) => flagsAt(allWeak, k).filter((f) => f.kind === "weak-group").length)).toEqual([0, 0]);
    expect(flagsAt(allWeak, 5).filter((f) => f.kind === "weak-group")).toHaveLength(1);
  });

  it("(b) a check outside the 40-80 % bin or partial is rejected, not counted", () => {
    const { points, rejected } = pointsFromReports([makeReport({ id: 1, day: 0, capacityKwh: 85, soc: 90 }), makeReport({ id: 2, day: 1, capacityKwh: 85, scanStatus: "partial" }), makeReport({ id: 3, day: 2, capacityKwh: 85 })]);
    expect(points.map((p) => p.id)).toEqual(["synthetic-series/3"]);
    expect(rejected.map((r) => r.id).sort()).toEqual(["synthetic-series/1", "synthetic-series/2"]);
    expect(rejected.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("(c) a +4 mV spread step and a new DTC each produce their flag", () => {
    const quiet = Array.from({ length: 6 }, (_, k) => makeReport({ id: k, day: k * 40, capacityKwh: 85 }));
    expect(flagsAt(quiet, 6)).toEqual([]);
    const stepped = quiet.map((r, k) => k === 5 ? makeReport({ id: k, day: k * 40, capacityKwh: 85, volts: baseVolts({ 0: 0.006 }) }) : r);
    expect(flagsAt(stepped, 6).map((f) => f.kind)).toEqual(["spread-step"]);
    const coded = quiet.map((r, k) => k === 5 ? makeReport({ id: k, day: k * 40, capacityKwh: 85, stored: ["P0A80"] }) : r);
    const newCode = flagsAt(coded, 6);
    expect(newCode.map((f) => f.kind)).toEqual(["new-code"]);
    expect(newCode[0]?.detail).toContain("P0A80");
  });

  it("measured false alarms on 200 flat series stay at or under 5 %", () => {
    let significant = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const next = rng(seed * 7919);
      const points = Array.from({ length: 10 }, (_, k) => pt(String(k), k * 40, 85 + gaussian(next) * 0.2, 0.4));
      const result = weightedTrend(points);
      if (result.status === "trend" && result.fit.significant) significant++;
    }
    const rate = significant / 200;
    writeFileSync("/tmp/trend-false-alarm.txt", `${String(significant)} of 200 flat series significant (${(rate * 100).toFixed(1)} %)\n`);
    expect(rate).toBeLessThanOrEqual(0.05);
    const rendered = renderTrendReport({ reports: series, summaries: [], rejected: [] });
    writeFileSync(new URL("packages/obd-battery/test/trend-reports.md", root), [
      "# Trend report artifacts (T2.20 Stage A)", "",
      "All series below are synthetic, built in memory by `trend.test.ts`. No real multi-session series exists yet.", "",
      "## Measured false alarms", "",
      `${String(significant)} of 200 seeded flat series (10 sessions over 360 days, noise sd equal to the assumed sigma = band/2) were significant: ${(rate * 100).toFixed(1)} % (limit 5 %).`, "",
      "## Seeded series (a): 10 sessions, 12 months, 3 %/yr fade (synthetic)", "", rendered,
    ].join("\n"));
  });
});

describe("isolated failures", () => {
  it("1. WLS slope and SE match a hand-computed series, and scatter inflates SE", () => {
    const flat = [0, 1, 2, 3, 4].map((k) => pt(String(k), k * 100, 100 - k));
    const tight = asTrend(weightedTrend([0, 1, 2, 3, 4].map((k) => pt(String(k), k * 100, 100 - k * 1, 0.2))));
    const years = 100 / 365.25;
    expect(tight.cRef).toBe(99);
    expect(tight.fit.slopePerYear).toBeCloseTo(-1 / 99 / years, 9);
    expect(tight.fit.fadePctPerYear).toBeCloseTo(100 / 99 / years, 6);
    expect(tight.fit.chi2Inflation).toBe(1);
    const sxx = [0, 1, 2, 3, 4].reduce((s, k) => s + ((k - 2) * years) ** 2, 0);
    expect(tight.fit.sePerYear).toBeCloseTo(0.1 / 99 / Math.sqrt(sxx), 9);
    expect(flat).toHaveLength(5);
    const scatter = [0, 1, 2, 3, 4, 5].map((k) => pt(String(k), k * 100, 100 - k + (k % 2 === 0 ? 1.5 : -1.5), 0.2));
    const wide = asTrend(weightedTrend(scatter));
    expect(wide.fit.chi2Inflation).toBeGreaterThan(5);
    const unit = 0.1 / 99.5 / Math.sqrt([0, 1, 2, 3, 4, 5].reduce((s, k) => s + ((k - 2.5) * years) ** 2, 0));
    expect(wide.fit.sePerYear).toBeCloseTo(unit * wide.fit.chi2Inflation, 9);
  });

  it("2. the gate does not pass early", () => {
    const cases: [string, SessionPoint[], boolean][] = [
      ["n=4", [0, 1, 2, 3].map((k) => pt(String(k), k * 40, 100 - k * 2)), false],
      ["span 89 d", [0, 1, 2, 3, 4].map((k) => pt(String(k), (k * 89) / 4, 100 - k * 5)), false],
      ["|beta| < 2 SE", [0, 1, 2, 3, 4].map((k) => pt(String(k), k * 30, 100 + (k % 2 === 0 ? 0.3 : -0.3), 0.5)), false],
      ["all met", [0, 1, 2, 3, 4].map((k) => pt(String(k), k * 30, 100 - k * 2)), true],
    ];
    for (const [name, points, passes] of cases) {
      const result = weightedTrend(points);
      expect(result.status === "trend", name).toBe(passes);
    }
    const early = weightedTrend(cases[1]?.[1] ?? []);
    expect(early.status === "not-enough-data" && early.n).toBe(5);
  });

  it("3. kWh and Ah are never pooled and cRef comes from time order", () => {
    const kwh = [0, 1, 2, 3, 4, 5].map((k) => pt(`k${String(k)}`, k * 30, 85 - k, 0.3, "bms-kwh"));
    const ah = [0, 1, 2, 3, 4, 5].map((k) => pt(`a${String(k)}`, k * 30, 190 - k * 2, 0.3, "integrated-ah"));
    const mixed = [...kwh, ...ah];
    const shuffled = [...mixed].sort((a, b) => (a.value * 7) % 5 - (b.value * 7) % 5);
    const result = trendsByMethod(shuffled);
    expect(result.map((r) => r.method).sort()).toEqual(["bms-kwh", "integrated-ah"]);
    const sorted = trendsByMethod(mixed);
    for (const method of ["bms-kwh", "integrated-ah"] as const) {
      const a = asTrend(result.find((r) => r.method === method) as TrendResult);
      const b = asTrend(sorted.find((r) => r.method === method) as TrendResult);
      expect(a.cRef).toBe(b.cRef);
    }
    expect(asTrend(result.find((r) => r.method === "bms-kwh") as TrendResult).cRef).toBe(84);
    expect(() => weightedTrend(mixed)).toThrow();
  });

  it("4. groupZ never yields Infinity/NaN and flags only a planted outlier", () => {
    const constant = groupZ(Array.from({ length: 80 }, () => 3.9));
    expect(constant.every((z) => z === undefined)).toBe(true);
    const planted = groupZ(baseVolts({ 40: -0.02 }));
    expect(planted[40]).toBeLessThan(TREND_POLICY.weakGroupZ);
    expect(planted.filter((z) => z !== undefined && z < TREND_POLICY.weakGroupZ)).toHaveLength(1);
    expect(planted.every((z) => z === undefined || Number.isFinite(z))).toBe(true);
  });

  it("6. the report-derived band equals the log's bmsEnergyCapacity band", async () => {
    const signalset = importObdbMode22(JSON.parse(readFileSync(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")));
    const recording = `${base}2026-09-23-discovery-targeted.redacted.jsonl`;
    const text = readFileSync(new URL(recording, root), "latin1");
    const report = await batteryDiagnosisFromRecording(text, { garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-23T00:00:00.000Z", recording, scanStatus: "complete" }, signalset);
    const figure = report.parked?.bmsFigure;
    if (figure === undefined) throw new Error("recording has no BMS figure");
    const { parseRecording } = await import("obd-core/recording");
    const last = bmsEnergyCapacity(await chargeLogFromRecording(parseRecording(text), recording, signalset)).last;
    const recomputed = bmsFigure({ t: 0, value: figure.energyKwh }, { t: 0, value: figure.socPercent });
    if (last.status !== "estimated" || recomputed.status !== "estimated") throw new Error("not estimated");
    expect(recomputed.band).toBe(last.band);
    expect(pointsFromReports([report]).rejected[0]?.reason).toMatch(/SOC/);
  }, 60_000);
});
