// X-2026-09-28-app-redesign C2 (spec §Verification, E2E (C2)): what the report screens show. The five committed Equinox
// *.redacted.jsonl recordings go through batteryDiagnosisFromRecording, and the four synthetic codes fixtures (labelled
// synthetic) through codesReportFromRecording, then through the view functions. Expected values are fixed literals per
// recording, read off renderBatteryDiagnosis / renderCodesReport output, not re-derived from the report.
// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BatteryDiagnosisReport } from "obd-battery/report";
import { parseRecording } from "obd-core/recording";
import { codesReportFromRecording } from "obd-core/report";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { batteryDiagnosisFromRecording } from "../../../packages/obd-battery/src/report.js";
import { back, type Route } from "../src/app/navigation.js";
import { codesView, findReport, historyPoints, moduleRows, reportSummary, sectionDetail } from "../src/app/reportView.js";

const read = readFileSync as (path: URL, encoding: "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const root = new URL("../../../", import.meta.url);
const signals = importObdbMode22(signalsetJson);
const ARTIFACT = "/tmp/x-redesign-report-view.json";
const artifact: Record<string, unknown> = {};
const save = () => { write(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`); };

const NO_THRESHOLD = "No threshold yet";
const CODE_POOR = "Project policy: a reported code is Poor";
const CLEARED_POOR = "Project policy (T0.7): the recently-cleared check says yes";
const NOT_READ = "No module answered a code read";
const OK_BASIS = "Project policy: no codes reported, and whether codes were cleared recently is unknown";
const GOOD_BASIS = "Project policy: no codes reported, and the recently-cleared check says no";
const LEG_LABELS = ["No stored codes (Mode 03)", "A readiness monitor incomplete (PID 01)", "A counter since codes cleared below policy (PIDs 30, 31, 4E)", "Permanent codes present (Mode 0A)"];

type Expected = {
  scannedAt: string; soc: number | null; cells: string; twelveVolt: string; codes: string; codesRating: string; codesBasis: string;
  cellRange: { minMv: number; avgMv: number; maxMv: number } | null; spreadVolts: number | null; legs: string[]; modules: string[];
};
const base = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const RECORDINGS: Record<string, Expected> = {
  "2026-09-22-spike.redacted.jsonl": {
    scannedAt: "2026-09-22T10:00:00.000Z", soc: 69.8, cells: "3.0 mV", twelveVolt: "12.7 V", codes: "No codes", codesRating: "ok", codesBasis: OK_BASIS,
    cellRange: { minMv: 3928.7, avgMv: 3929.7, maxMv: 3931.7 }, spreadVolts: 0.003, legs: ["yes", "no", "unknown", "no"], modules: ["17", "28", "40", "45", "CB"],
  },
  "2026-09-22-spike-2.redacted.jsonl": {
    scannedAt: "2026-09-22T11:00:00.000Z", soc: 69.8, cells: "3.0 mV", twelveVolt: "13.1 V", codes: "No codes", codesRating: "ok", codesBasis: OK_BASIS,
    cellRange: { minMv: 3927.8, avgMv: 3928.8, maxMv: 3930.8 }, spreadVolts: 0.003, legs: ["yes", "no", "unknown", "no"], modules: ["17", "28", "40", "45", "CB"],
  },
  // Codes: every module answered PIDs, none answered a code read (render: "Stored codes (Mode 03): not read" everywhere).
  "2026-09-23-discovery-targeted.redacted.jsonl": {
    scannedAt: "2026-09-23T10:00:00.000Z", soc: 85.1, cells: "2.7 mV", twelveVolt: "11.7 V", codes: "Not read", codesRating: "not-rated", codesBasis: NOT_READ,
    cellRange: { minMv: 4076.4, avgMv: 4077.2, maxMv: 4079.1 }, spreadVolts: 0.0027, legs: ["unknown", "no", "no", "unknown"], modules: ["17", "28", "40", "45", "CB"],
  },
  "2026-09-24-phone-console.redacted.jsonl": {
    scannedAt: "2026-09-24T10:00:00.000Z", soc: null, cells: "Not read", twelveVolt: "Not recorded", codes: "No codes", codesRating: "ok", codesBasis: OK_BASIS,
    cellRange: null, spreadVolts: null, legs: ["yes", "unknown", "unknown", "unknown"], modules: ["17", "28", "40", "45", "CB"],
  },
  "2026-09-24-phone-console-2.redacted.jsonl": {
    scannedAt: "2026-09-24T11:00:00.000Z", soc: null, cells: "Not read", twelveVolt: "Not recorded", codes: "No codes", codesRating: "ok", codesBasis: OK_BASIS,
    cellRange: null, spreadVolts: null, legs: ["yes", "unknown", "unknown", "unknown"], modules: ["17", "28", "40", "45", "CB"],
  },
};
const reports = new Map<string, BatteryDiagnosisReport>();
const load = async (name: string) => {
  const cached = reports.get(name);
  if (cached) return cached;
  const recording = base + name;
  const report = await batteryDiagnosisFromRecording(read(new URL(recording, root), "latin1"), {
    garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: RECORDINGS[name].scannedAt, recording, scanStatus: "complete",
  }, signals);
  reports.set(name, report);
  return report;
};

describe("report screens over the committed Equinox recordings", () => {
  it.each(Object.keys(RECORDINGS))("%s", async (name) => {
    const want = RECORDINGS[name];
    const report = await load(name);
    const summary = reportSummary(report);
    const sections = { soc: sectionDetail(report, "soc"), cells: sectionDetail(report, "cells"), capacity: sectionDetail(report, "capacity"), twelveVolt: sectionDetail(report, "twelveVolt") };
    const codes = codesView(report.codes);

    // SoC: the hero value, and never a rating.
    expect(summary.soc?.percent ?? null).toBe(want.soc);
    expect(sections.soc.hero.value).toBe(want.soc === null ? "Not read" : want.soc.toFixed(1));
    expect(sections.soc.rating).toBeUndefined();
    // Four rows in fixed order; cells, capacity and 12 V are not rated until a threshold exists.
    expect(summary.rows.map((row) => [row.section, row.label, row.value, row.rating.rating, row.rating.basis])).toEqual([
      ["cells", "Cell balance", want.cells, "not-rated", NO_THRESHOLD],
      ["capacity", "Capacity", "Not measured", "not-rated", NO_THRESHOLD],
      ["twelveVolt", "12 V battery", want.twelveVolt, "not-rated", NO_THRESHOLD],
      ["codes", "Diagnostic codes", want.codes, want.codesRating, want.codesBasis],
    ]);
    for (const section of ["cells", "capacity", "twelveVolt"] as const) expect(sections[section].rating).toEqual({ rating: "not-rated", basis: NO_THRESHOLD });
    // Provenance comes from the report's own tiers.
    expect([sections.soc.hero.tag, sections.cells.hero.tag, sections.capacity.hero.tag, sections.twelveVolt.hero.tag])
      .toEqual([want.soc === null ? "neutral" : "verified", want.cellRange ? "community" : "neutral", "neutral", "neutral"]);
    // "What this means" carries the report's own reason strings.
    expect(sections.cells.meaning.startsWith(report.health.reason)).toBe(true);
    expect(sections.capacity.meaning.startsWith(report.capacity.reason)).toBe(true);
    expect(sections.twelveVolt.meaning.startsWith(report.twelveVolt.reason)).toBe(true);
    // Chart 4: min ≤ avg ≤ max, and max − min is the report's own cell spread.
    expect(sections.cells.cellRange ?? null).toEqual(want.cellRange);
    if (want.cellRange && want.spreadVolts !== null) {
      const range = want.cellRange;
      expect(range.minMv <= range.avgMv && range.avgMv <= range.maxMv).toBe(true);
      expect(range.maxMv - range.minMv).toBeCloseTo((report.cellSpread?.volts ?? Number.NaN) * 1000, 6);
      expect(report.cellSpread?.volts).toBeCloseTo(want.spreadVolts, 9);
    }
    // Codes: rating, legs labelled as renderCodesReport, the policy thresholds, and one row per module.
    expect(codes.rating).toEqual({ rating: want.codesRating, basis: want.codesBasis });
    expect(codes.codeCount).toBe(0);
    expect(codes.legs).toEqual(LEG_LABELS.map((label, i) => ({ label, result: want.legs[i] })));
    expect(codes.thresholds).toEqual({ "30": 10, "31": 100, "4E": 600 });
    expect(codes.modules.map((m) => m.ecu)).toEqual(want.modules);
    const modules = Object.fromEntries(codes.modules.map((m) => [m.ecu, moduleRows(report.codes, m.ecu)]));
    artifact[name] = { summary, sections, codes, modules };
    save();
  });

  it("shows module detail rows as the module reported them (spike, module 17)", async () => {
    const report = await load("2026-09-22-spike.redacted.jsonl");
    const rows = moduleRows(report.codes, "17");
    expect(rows?.slice(0, 3)).toEqual([
      { label: "Stored codes (Mode 03)", value: "none" },
      { label: "Pending codes (Mode 07)", value: "none" },
      { label: "Permanent codes (Mode 0A)", value: "not answered (negative response 11)" },
    ]);
    expect(moduleRows(report.codes, "7E8")).toBeUndefined();
  });

  it("gives the scan-history chart one SoC point per check, oldest first", async () => {
    const spike = await load("2026-09-22-spike.redacted.jsonl");
    const spike2 = await load("2026-09-22-spike-2.redacted.jsonl");
    // batteryHistory.list is newest first; the chart reads left to right in date order.
    const two = historyPoints([spike2, spike]);
    expect(two).toEqual([{ scannedAt: "2026-09-22T10:00:00.000Z", percent: 69.8 }, { scannedAt: "2026-09-22T11:00:00.000Z", percent: 69.8 }]);
    // One check: one point, which the chart shows as its empty state.
    expect(historyPoints([spike])).toEqual([{ scannedAt: "2026-09-22T10:00:00.000Z", percent: 69.8 }]);
    // A check without an SoC reading adds no point.
    const all = await Promise.all(Object.keys(RECORDINGS).reverse().map(load));
    expect(historyPoints(all).map((p) => p.percent)).toEqual([69.8, 69.8, 85.1]);
    artifact.history = { two, one: historyPoints([spike]), all: historyPoints(all) };
    save();
  });
});

describe("codes rating over the synthetic codes fixtures (synthetic, no vehicle evidence)", () => {
  const cases: [string, string, string, number][] = [
    ["codes-cleared.jsonl", "poor", CLEARED_POOR, 0], // recently cleared: indicated, no codes
    ["codes-conflict.jsonl", "ok", OK_BASIS, 0], // no codes, checks disagree: unknown
    ["codes-permanent.jsonl", "poor", CODE_POOR, 1], // permanent P0133 (also indicated): the code decides
    ["codes-stored.jsonl", "poor", CODE_POOR, 2], // stored and permanent P0133, pending U0158; not indicated
  ];
  it.each(cases)("%s", async (name, rating, basis, count) => {
    const codes = await codesReportFromRecording(parseRecording(read(new URL(`fixtures/synthetic/${name}`, root), "latin1")));
    const view = codesView(codes);
    expect(view.rating).toEqual({ rating, basis });
    expect(view.codeCount).toBe(count);
    artifact[`synthetic/${name}`] = { synthetic: true, codes: view, modules: Object.fromEntries(view.modules.map((m) => [m.ecu, moduleRows(codes, m.ecu)])) };
    save();
  });

  it("rates Good only when the recently-cleared check says no (derived in this test, synthetic)", async () => {
    // No recording or fixture reaches this branch: the spike's codes (all code reads answered, none reported) with the verdict
    // set to not-indicated, as a counter read at or above policy would make it.
    const spike = await load("2026-09-22-spike.redacted.jsonl");
    const derived = { ...spike.codes, recentlyCleared: { ...spike.codes.recentlyCleared, verdict: "not-indicated" as const, legs: { ...spike.codes.recentlyCleared.legs, countersLow: "no" as const } } };
    expect(codesView(derived).rating).toEqual({ rating: "good", basis: GOOD_BASIS });
    // The same codes with the verdict unknown stay OK: Good needs the check to answer no.
    expect(codesView(spike.codes).rating.rating).toBe("ok");
    artifact["synthetic/derived-not-indicated"] = { synthetic: true, derivedFrom: `${base}2026-09-22-spike.redacted.jsonl`, rating: codesView(derived).rating };
    save();
  });
});

describe("report routes", () => {
  it("resolve their report from the route, across a history back-and-forth", async () => {
    const spike = await load("2026-09-22-spike.redacted.jsonl");
    const spike2 = await load("2026-09-22-spike-2.redacted.jsonl");
    const history = [spike2, spike];
    const reportRoute = (r: BatteryDiagnosisReport): Route => ({ name: "report", entryId: "1", scannedAt: r.scannedAt, recording: r.recording });
    const shown = (stack: readonly Route[]) => {
      const top = stack[stack.length - 1];
      return top.name === "report" ? findReport(history, top)?.recording : undefined;
    };
    // Car hero opens the latest report; then history opens the older one; back twice returns to the latest.
    let stack: readonly Route[] = [{ name: "garage" }, { name: "car", entryId: "1" }, reportRoute(spike2)];
    const path: (string | undefined)[] = [shown(stack)];
    stack = [...stack, { name: "history", entryId: "1" }, reportRoute(spike)];
    path.push(shown(stack));
    const pop = () => { const next = back(stack, false); if (typeof next === "string") throw new Error(next); stack = next; };
    pop(); pop();
    path.push(shown(stack));
    expect(path).toEqual([spike2.recording, spike.recording, spike2.recording]);
    // A route naming a report that is not in the list resolves to nothing, not to another report.
    expect(findReport(history, { scannedAt: "2026-09-24T10:00:00.000Z", recording: spike.recording })).toBeUndefined();
    artifact.routes = path;
    save();
  });
});
