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

it("shows saved upgraded and legacy detail states without changing summary rows", async () => {
  const synthetic = "fixtures/synthetic/battery-diagnosis-full-scan.jsonl";
  const upgraded = await batteryDiagnosisFromRecording(read(new URL(synthetic, root), "latin1"), { garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-24T00:00:00.000Z", recording: synthetic, scanStatus: "complete" }, signals);
  const legacy = await batteryDiagnosisFromRecording(read(new URL("fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl", root), "latin1"), { garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z", recording: "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl", scanStatus: "complete" }, signals);
  const output = { synthetic: true, upgraded: { summary: reportSummary(upgraded), cells: sectionDetail(upgraded, "cells"), capacity: sectionDetail(upgraded, "capacity") }, legacy: { summary: reportSummary(legacy), cells: sectionDetail(legacy, "cells"), capacity: sectionDetail(legacy, "capacity") } };
  write("/tmp/t2.14-report-views.json", `${JSON.stringify(output, null, 2)}\n`);
  expect(output.upgraded.summary.rows).toEqual(output.legacy.summary.rows);
  expect(output.upgraded.cells.readings.some((item) => item.label === "Group voltages at rest" && item.value.includes("80"))).toBe(true);
  expect(output.upgraded.cells.readings.filter((item) => item.label.startsWith("Module "))).toHaveLength(10);
  expect(output.upgraded.cells.readings.find((item) => item.label === "Module 1")?.value.split(", ")).toHaveLength(8);
  expect(output.upgraded.cells.meaning).toContain("The 80 cell-group voltages come from recorded 2AE1–2AE7 replies at rest.");
  expect(output.upgraded.cells.meaning).toContain("The legacy min/average/max and spread use a community signal definition not verified on this car.");
  expect(output.legacy.cells.meaning).not.toContain("80 cell-group voltages");
  expect(output.legacy.cells.meaning).toContain("The legacy min/average/max and spread use a community signal definition not verified on this car.");
  expect(output.upgraded.capacity.readings.some((item) => item.label === "BMS figure")).toBe(true);
  expect(output.upgraded.cells.readings.some((item) => item.label === "Raw 2AF1 response")).toBe(true);
  expect(output.legacy.cells.readings.some((item) => item.value === "Not available at rest")).toBe(true);
});

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
  it("delivers real and labeled synthetic replay verdicts with unchanged summary rows", async () => {
    const realNames = [...Object.keys(RECORDINGS), "2026-09-30-test-drive.redacted.jsonl", "2026-09-30-test-drive-2.redacted.jsonl"];
    const real = await Promise.all(realNames.map(async (name) => {
      if (name in RECORDINGS) return load(name);
      const recording = base + name;
      return batteryDiagnosisFromRecording(read(new URL(recording, root), "latin1"), { garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-30T10:00:00.000Z", recording, scanStatus: "complete" }, signals);
    }));
    const syntheticPath = "fixtures/synthetic/battery-diagnosis-full-scan.jsonl";
    const synthetic = await batteryDiagnosisFromRecording(read(new URL(syntheticPath, root), "latin1"), { garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-24T00:00:00.000Z", recording: syntheticPath, scanStatus: "complete" }, signals);
    const groups = synthetic.parked?.groupVoltages;
    if (!groups) throw new Error("synthetic full scan needs rest groups");
    const variant = (volts: number[], scanStatus: BatteryDiagnosisReport["scanStatus"] = "complete"): BatteryDiagnosisReport => ({ ...synthetic, scanStatus, parked: { ...synthetic.parked, groupVoltages: { ...groups, volts } } });
    const syntheticReports = [synthetic,
      variant(Array.from({ length: 80 }, (_, i) => 4 - (i === 0 ? 0.015 : 0))),
      variant(Array.from({ length: 80 }, (_, i) => 4 - (i === 0 ? 0.007 : 0))),
      variant(Array.from({ length: 80 }, (_, i) => 4 + (i === 0 ? 0.004 : i === 1 ? -0.004 : 0))),
      variant(Array.from({ length: 80 }, (_, i) => 4 + (i === 0 ? -0.005 : i === 1 ? 0.001 : 0))),
      variant(Array.from({ length: 80 }, () => 4), "partial")];
    const codeNames = ["codes-stored.jsonl", "codes-permanent.jsonl", "codes-cleared.jsonl"];
    const codeReports = await Promise.all(codeNames.map(async (name) => ({ name, codes: await codesReportFromRecording(parseRecording(read(new URL(`fixtures/synthetic/${name}`, root), "latin1"))) })));
    const codeCases = codeReports.map(({ name, codes }) => ({ name, report: { ...real[0], codes } }));
    const spike = real[0];
    const failed = { ...spike, codes: { ...spike.codes, modules: spike.codes.modules.map((module) => ({ ...module, pending: { status: "not-read" as const } })) } };
    const fixtureStored = codeReports[0]?.codes.modules.flatMap((module) => module.stored.status === "read" ? module.stored.dtcs : [])[0];
    if (!fixtureStored) throw new Error("synthetic stored-code recording needs a decoded code");
    const observedWithFailure = { ...failed, codes: { ...failed.codes, modules: failed.codes.modules.map((module, index) => index === 0 ? { ...module, stored: { status: "read" as const, dtcs: [fixtureStored] } } : module) } };
    const cases = [...real.map((report, index) => ({ name: realNames[index], synthetic: false, report })), ...syntheticReports.map((report, index) => ({ name: ["base", "injected", "ask", "spread", "boundary", "partial"][index], synthetic: true, report })), ...codeCases.map(({ name, report }) => ({ name, synthetic: true, report })), { name: "missing-pending", synthetic: true, report: failed }, { name: "observed-code-and-missing-pending", synthetic: true, report: observedWithFailure }];
    const rows = cases.map(({ name, synthetic, report }) => ({ name, synthetic, recording: report.recording, summary: reportSummary(report) }));
    expect(rows.map((row) => row.summary.verdict.headline)).toEqual([
      ...Array.from({ length: 7 }, () => "Check incomplete"), "No red flags found", "Red flag: get it inspected", "Ask about this", "Ask about this", "No red flags found", "Check incomplete",
      "Ask about this", "Ask about this", "Ask about this", "Check incomplete", "Ask about this",
    ]);
    expect(rows[0]?.summary.verdict.coverage[0]?.reason).toBe("No complete 80-group set with rest-bracketed current in this report recording.");
    expect(rows[2]?.summary.verdict.coverage[0]?.status).toBe("checked");
    const expectedRows = (cells: string, twelveVolt: string, codes: string, rating: string, basis: string) => [
      { section: "cells", label: "Cell balance", value: cells, rating: { rating: "not-rated", basis: NO_THRESHOLD } },
      { section: "capacity", label: "Capacity", value: "Not measured", rating: { rating: "not-rated", basis: NO_THRESHOLD } },
      { section: "twelveVolt", label: "12 V battery", value: twelveVolt, rating: { rating: "not-rated", basis: NO_THRESHOLD } },
      { section: "codes", label: "Diagnostic codes", value: codes, rating: { rating, basis } },
    ];
    for (const [index, want] of Object.values(RECORDINGS).entries()) {
      expect(rows[index]?.summary.soc?.percent ?? null).toBe(want.soc);
      expect(rows[index]?.summary.rows).toEqual(expectedRows(want.cells, want.twelveVolt, want.codes, want.codesRating, want.codesBasis));
    }
    expect(rows[5]?.summary.soc?.percent).toBe(74.5);
    expect(rows[5]?.summary.rows).toEqual(expectedRows("5.2 mV", "12.3 V", "Not read", "not-rated", NOT_READ));
    expect(rows[6]?.summary.soc?.percent).toBe(73.7);
    expect(rows[6]?.summary.rows).toEqual(expectedRows("4.8 mV", "12.8 V", "Not read", "not-rated", NOT_READ));
    for (const row of rows.slice(7, 13)) {
      expect(row.summary.soc).toEqual({ percent: 69.8, tier: "verified", scannedAt: "2026-09-24T00:00:00.000Z" });
      expect(row.summary.rows).toEqual(expectedRows("3.0 mV", "12.7 V", "No codes", "ok", OK_BASIS));
    }
    for (const [index, codes] of ["2 codes", "1 code", "No codes", "No codes", "1 code"].entries()) {
      const row = rows[index + 13];
      expect(row.summary.soc).toEqual({ percent: 69.8, tier: "verified", scannedAt: RECORDINGS["2026-09-22-spike.redacted.jsonl"].scannedAt });
      expect(row.summary.rows).toEqual(expectedRows("3.0 mV", "12.7 V", codes, index === 3 ? "ok" : "poor", index === 3 ? OK_BASIS : index === 2 ? CLEARED_POOR : CODE_POOR));
    }
    expect(rows.slice(13).map((row) => row.summary.verdict.coverage[1]?.status)).toEqual(["checked", "checked", "checked", "not-checked", "not-checked"]);
    expect(rows.slice(13).map((row) => row.summary.verdict.findings.map((finding) => finding.detail))).toEqual([
      ["stored code P0133 reported by ECU 7E8.", "pending code U0158 reported by ECU 7E8.", "permanent code P0133 reported by ECU 7E8."],
      ["permanent code P0133 reported by ECU 7E8.", "Recently cleared codes: indicated by the reported checks."],
      ["Recently cleared codes: indicated by the reported checks."], [], ["stored code P0133 reported by ECU 17."],
    ]);
    write("/tmp/t2.15-report-summary.json", `${JSON.stringify(rows, null, 2)}\n`);
  });
  it.each(Object.keys(RECORDINGS))("%s", async (name) => {
    const want = RECORDINGS[name];
    const report = await load(name);
    const summary = reportSummary(report);
    const sections = { soc: sectionDetail(report, "soc"), cells: sectionDetail(report, "cells"), capacity: sectionDetail(report, "capacity"), twelveVolt: sectionDetail(report, "twelveVolt") };
    const codes = codesView(report.codes);

    expect(summary.soc?.percent ?? null).toBe(want.soc);
    expect(sections.soc.hero.value).toBe(want.soc === null ? "Not read" : want.soc.toFixed(1));
    expect(sections.soc.rating).toBeUndefined();
    expect(summary.rows.map((row) => [row.section, row.label, row.value, row.rating.rating, row.rating.basis])).toEqual([
      ["cells", "Cell balance", want.cells, "not-rated", NO_THRESHOLD],
      ["capacity", "Capacity", "Not measured", "not-rated", NO_THRESHOLD],
      ["twelveVolt", "12 V battery", want.twelveVolt, "not-rated", NO_THRESHOLD],
      ["codes", "Diagnostic codes", want.codes, want.codesRating, want.codesBasis],
    ]);
    for (const section of ["cells", "capacity", "twelveVolt"] as const) expect(sections[section].rating).toEqual({ rating: "not-rated", basis: NO_THRESHOLD });
    expect([sections.soc.hero.tag, sections.cells.hero.tag, sections.capacity.hero.tag, sections.twelveVolt.hero.tag])
      .toEqual([want.soc === null ? "neutral" : "verified", want.cellRange ? "community" : "neutral", "neutral", "neutral"]);
    expect(sections.cells.meaning.startsWith(report.health.reason)).toBe(true);
    expect(sections.capacity.meaning.startsWith(report.capacity.reason)).toBe(true);
    expect(sections.twelveVolt.meaning.startsWith(report.twelveVolt.reason)).toBe(true);
    if (!report.parked?.bmsFigure) expect(sections.capacity.source).toBe("Not measured; needs a completed charge log");
    expect(sections.cells.cellRange ?? null).toEqual(want.cellRange);
    if (want.cellRange && want.spreadVolts !== null) {
      const range = want.cellRange;
      expect(range.minMv <= range.avgMv && range.avgMv <= range.maxMv).toBe(true);
      expect(range.maxMv - range.minMv).toBeCloseTo((report.cellSpread?.volts ?? Number.NaN) * 1000, 6);
      expect(report.cellSpread?.volts).toBeCloseTo(want.spreadVolts, 9);
    }
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

  it("shows only the spread when the adjacent reply lost its AVG (derived partial decode, synthetic)", async () => {
    const report = await load("2026-09-23-discovery-targeted.redacted.jsonl");
    const cells = report.signals.filter((s) => s.source.command === "22 2AF5");
    expect(cells.slice(0, 6).map((s) => s.id.replace("EQUINOXEV_HVBAT_C_V_", ""))).toEqual(["AVG", "MIN", "MAX", "AVG", "MIN", "MAX"]);
    const [, , max1, avg2, min2, max2] = cells;
    const derived: BatteryDiagnosisReport = {
      ...report,
      signals: report.signals.filter((s) => s !== max1 && s !== avg2),
      cellSpread: { volts: max2.value - min2.value, tier: "community", min: min2.source, max: max2.source },
    };
    const detail = sectionDetail(derived, "cells");
    expect(detail.cellRange).toBeUndefined();
    expect(detail.readings.filter((r) => ["Lowest cell", "Average cell", "Highest cell", "Spread"].includes(r.label))).toEqual([{ label: "Spread", value: `${((max2.value - min2.value) * 1000).toFixed(1)} mV`, tier: "community" }]);
    expect(detail.source).toContain("22 2AF5 from ECU CB");
    artifact["synthetic/derived-partial-2af5"] = { synthetic: true, derivedFrom: `${base}2026-09-23-discovery-targeted.redacted.jsonl`, cells: detail };
    save();
  });

  it("shows only the spread when the adjacent MIN and MAX do not give the report's spread (derived, synthetic)", async () => {
    const report = await load("2026-09-23-discovery-targeted.redacted.jsonl");
    const cells = report.signals.filter((s) => s.source.command === "22 2AF5");
    expect(cells.slice(0, 9).map((s) => s.id.replace("EQUINOXEV_HVBAT_C_V_", ""))).toEqual(["AVG", "MIN", "MAX", "AVG", "MIN", "MAX", "AVG", "MIN", "MAX"]);
    const [, min1, , , , max2, , min3, max3] = cells;
    const [from, to] = [report.signals.indexOf(min1), report.signals.indexOf(max2)];
    const derived: BatteryDiagnosisReport = {
      ...report,
      signals: report.signals.filter((_, i) => i <= from || i >= to),
      cellSpread: { volts: max3.value - min3.value, tier: "community", min: min3.source, max: max3.source },
    };
    expect(max2.value - min1.value).not.toBe(max3.value - min3.value);
    const detail = sectionDetail(derived, "cells");
    expect(detail.cellRange).toBeUndefined();
    expect(detail.readings.filter((r) => ["Lowest cell", "Average cell", "Highest cell", "Spread"].includes(r.label)).map((r) => r.label)).toEqual(["Spread"]);
    expect(detail.source).toContain("22 2AF5 from ECU CB");
    artifact["synthetic/derived-undecoded-between-replies"] = { synthetic: true, derivedFrom: `${base}2026-09-23-discovery-targeted.redacted.jsonl`, cells: detail };
    save();
  });

  it("gives the scan-history chart one SoC point per check, oldest first", async () => {
    const spike = await load("2026-09-22-spike.redacted.jsonl");
    const spike2 = await load("2026-09-22-spike-2.redacted.jsonl");
    const two = historyPoints([spike2, spike]);
    expect(two).toEqual([{ scannedAt: "2026-09-22T10:00:00.000Z", percent: 69.8 }, { scannedAt: "2026-09-22T11:00:00.000Z", percent: 69.8 }]);
    expect(historyPoints([spike])).toEqual([{ scannedAt: "2026-09-22T10:00:00.000Z", percent: 69.8 }]);
    const all = await Promise.all(Object.keys(RECORDINGS).reverse().map(load));
    expect(historyPoints(all).map((p) => p.percent)).toEqual([69.8, 69.8, 85.1]);
    artifact.history = { two, one: historyPoints([spike]), all: historyPoints(all) };
    save();
  });
});

describe("codes rating over the synthetic codes fixtures (synthetic, no vehicle evidence)", () => {
  const cases: [string, string, string, number][] = [
    ["codes-cleared.jsonl", "poor", CLEARED_POOR, 0],
    ["codes-conflict.jsonl", "ok", OK_BASIS, 0],
    ["codes-permanent.jsonl", "poor", CODE_POOR, 1],
    ["codes-stored.jsonl", "poor", CODE_POOR, 2],
  ];
  it.each(cases)("%s", async (name, rating, basis, count) => {
    const codes = await codesReportFromRecording(parseRecording(read(new URL(`fixtures/synthetic/${name}`, root), "latin1")));
    const view = codesView(codes);
    expect(view.rating).toEqual({ rating, basis });
    expect(view.codeCount).toBe(count);
    artifact[`synthetic/${name}`] = { synthetic: true, codes: view, modules: Object.fromEntries(view.modules.map((m) => [m.ecu, moduleRows(codes, m.ecu)])) };
    save();
  });

  it("rates a stored code alone Poor (derived from codes-stored.jsonl, synthetic)", async () => {
    const codes = await codesReportFromRecording(parseRecording(read(new URL("fixtures/synthetic/codes-stored.jsonl", root), "latin1")));
    const clear = <T extends { status: string }>(r: T): T => (r.status === "read" ? { ...r, dtcs: [] } : r);
    const derived = { ...codes, modules: codes.modules.map((m) => ({ ...m, pending: clear(m.pending), permanent: clear(m.permanent) })) };
    const view = codesView(derived);
    expect(view.rating).toEqual({ rating: "poor", basis: CODE_POOR });
    expect(view.codeCount).toBe(1);
    artifact["synthetic/derived-stored-only"] = { synthetic: true, derivedFrom: "fixtures/synthetic/codes-stored.jsonl", rating: view.rating, modules: view.modules };
    save();
  });

  it("rates Good only when the recently-cleared check says no (derived in this test, synthetic)", async () => {
    const spike = await load("2026-09-22-spike.redacted.jsonl");
    const derived = { ...spike.codes, recentlyCleared: { ...spike.codes.recentlyCleared, verdict: "not-indicated" as const, legs: { ...spike.codes.recentlyCleared.legs, countersLow: "no" as const } } };
    expect(codesView(derived).rating).toEqual({ rating: "good", basis: GOOD_BASIS });
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
    let stack: readonly Route[] = [{ name: "garage" }, { name: "car", entryId: "1" }, reportRoute(spike2)];
    const path: (string | undefined)[] = [shown(stack)];
    stack = [...stack, { name: "history", entryId: "1" }, reportRoute(spike)];
    path.push(shown(stack));
    const pop = () => { const next = back(stack, false); if (typeof next === "string") throw new Error(next); stack = next; };
    pop(); pop();
    path.push(shown(stack));
    expect(path).toEqual([spike2.recording, spike.recording, spike2.recording]);
    expect(findReport(history, { scannedAt: "2026-09-24T10:00:00.000Z", recording: spike.recording })).toBeUndefined();
    expect(findReport(history, { scannedAt: spike.scannedAt, recording: spike2.recording })).toBeUndefined();
    artifact.routes = path;
    save();
  });
});
