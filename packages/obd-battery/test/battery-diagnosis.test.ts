import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importObdbMode22 } from "obd-core/vehicles";
import { parseRecording } from "obd-core/recording";
import { batteryDiagnosisFromRecording, parseBatteryDiagnosis, renderBatteryDiagnosis, redFlagScreen, type BatteryDiagnosisReport } from "obd-battery/report";
import { codesReportFromRecording } from "obd-core/report";
import { chargeLogFromRecording, REST_CURRENT_A } from "obd-battery/session";

const root = new URL("../../../", import.meta.url);
const signalset = importObdbMode22(JSON.parse(readFileSync(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")));
const base = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const paths = ["2026-09-22-spike.redacted.jsonl", "2026-09-22-spike-2.redacted.jsonl"];
const replay = (name: string) => {
  const recording = base + name;
  return batteryDiagnosisFromRecording(readFileSync(new URL(recording, root), "latin1"), {
    garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z", recording, scanStatus: "complete",
  }, signalset);
};

const verdictPolicy = { groupAskMv: 5, groupRedMv: 10, spreadAskMv: 6, spreadRedMv: 12, label: "Project policy" };
const verdictNames = [
  "2026-09-22-spike.redacted.jsonl", "2026-09-22-spike-2.redacted.jsonl", "2026-09-23-discovery-targeted.redacted.jsonl",
  "2026-09-24-phone-console.redacted.jsonl", "2026-09-24-phone-console-2.redacted.jsonl",
  "2026-09-30-test-drive.redacted.jsonl", "2026-09-30-test-drive-2.redacted.jsonl",
];
const expectedCoverage = [
  ["not-checked", "checked", "not-checked", "shown-only", "not-checked"],
  ["not-checked", "checked", "not-checked", "shown-only", "not-checked"],
  ["checked", "not-checked", "shown-only", "shown-only", "shown-only"],
  ["not-checked", "not-checked", "not-checked", "not-checked", "not-checked"],
  ["not-checked", "not-checked", "not-checked", "not-checked", "not-checked"],
  ["not-checked", "not-checked", "not-checked", "shown-only", "shown-only"],
  ["not-checked", "not-checked", "not-checked", "shown-only", "shown-only"],
];
const coverageChecks = ["cell-groups-at-rest", "codes", "bms-capacity-figure", "twelve-volt-supply", "raw-temperature"];
const restMissing = "No complete 80-group set with rest-bracketed current in this report recording.";
const codesChecked = "Standard OBD stored, pending and permanent modes answered; this does not cover every vehicle module.";
const codesMissing = "No successful standard OBD read for stored, pending, permanent modes; other vehicle modules may also hold codes.";
const pendingPermanentMissing = "No successful standard OBD read for pending, permanent modes; other vehicle modules may also hold codes.";
const bmsMissing = "BMS capacity figure was not recorded.";
const bmsShown = "BMS figure is shown; no verified capacity verdict limit exists.";
const supplyMissing = "12 V supply was not recorded.";
const supplyShown = "12 V supply is shown; no 12 V verdict limit exists.";
const rawMissing = "Raw 2AF1 was not recorded.";
const rawShown = "Raw 2AF1 is shown; no decoded temperature verdict limit exists.";
const expectedReasons = [
  [restMissing, codesChecked, bmsMissing, supplyShown, rawMissing],
  [restMissing, codesChecked, bmsMissing, supplyShown, rawMissing],
  [undefined, codesMissing, bmsShown, supplyShown, rawShown],
  [restMissing, pendingPermanentMissing, bmsMissing, supplyMissing, rawMissing],
  [restMissing, pendingPermanentMissing, bmsMissing, supplyMissing, rawMissing],
  [restMissing, codesMissing, bmsMissing, supplyShown, rawShown],
  [restMissing, codesMissing, bmsMissing, supplyShown, rawShown],
];

describe("T2.15 report-derived verdict replay", () => {
  it("holds the seven real recordings to the fixed policy matrix", async () => {
    const rows = [];
    const markdown = [];
    for (const [index, name] of verdictNames.entries()) {
      const report = await replay(name);
      const screen = redFlagScreen(report);
      const rendered = renderBatteryDiagnosis(report);
      const groups = report.parked?.groupVoltages;
      const rest = groups ? (() => {
        const ticks = groups.volts.map((v) => Math.round(v * 10000));
        const sorted = [...ticks].sort((a, b) => a - b);
        const median = (sorted[39] + sorted[40]) / 2;
        return { medianV: median / 10000, spreadMv: (sorted[79] - sorted[0]) / 10, maxDeviationMv: Math.max(...ticks.map((v) => Math.abs(v - median))) / 10 };
      })() : null;
      rows.push({ recording: report.recording, scanStatus: report.scanStatus, headline: screen.headline, findings: screen.findings, coverage: screen.coverage, policy: screen.policy, rest });
      markdown.push(rendered);
      expect(screen.headline).toBe("Check incomplete");
      expect(screen.findings).toEqual([]);
      expect(screen.policy).toEqual(verdictPolicy);
      expect(screen.coverage.map((c) => c.status)).toEqual(expectedCoverage[index]);
      expect(screen.coverage.map((c) => c.check)).toEqual(coverageChecks);
      expect(screen.coverage.map((c) => c.reason)).toEqual(expectedReasons[index]);
      expect(report.scanStatus).toBe("complete");
      expect(rendered).toContain("## Red-flag screen");
      expect(rendered).toContain(screen.headline);
      expect(rendered).toContain("Project policy");
      for (const [row, check] of coverageChecks.entries()) {
        const status = expectedCoverage[index]?.[row];
        const reason = expectedReasons[index]?.[row];
        expect(rendered).toContain(`- ${check}: ${status}${reason ? ` — ${reason}` : ""}`);
      }
      expect(rest).toEqual(index === 2 ? { medianV: 4.0768, spreadMv: 2.7, maxDeviationMv: 1.9 } : null);
    }
    writeFileSync("/tmp/t2.15-real-recording-verdicts.json", `${JSON.stringify(rows, null, 2)}\n`);
    writeFileSync("/tmp/t2.15-real-recording-verdicts.md", markdown.join("\n\n---\n\n"));
  });

  it("shows synthetic group, spread, boundary and partial outcomes", async () => {
    const recording = "fixtures/synthetic/battery-diagnosis-full-scan.jsonl";
    const baseReport = await batteryDiagnosisFromRecording(readFileSync(new URL(recording, root), "latin1"), {
      garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-24T00:00:00.000Z", recording, scanStatus: "complete",
    }, signalset);
    const groups = baseReport.parked?.groupVoltages;
    if (!groups) throw new Error("synthetic full scan needs rest groups");
    const baseScreen = redFlagScreen(baseReport);
    expect(baseScreen.headline).toBe("No red flags found");
    const median = 4;
    const variant = (volts: number[], scanStatus: BatteryDiagnosisReport["scanStatus"] = "complete"): BatteryDiagnosisReport => ({ ...baseReport, scanStatus, parked: { ...baseReport.parked, groupVoltages: { ...groups, volts } } });
    const cases = {
      injected: variant(Array.from({ length: 80 }, (_, i) => median - (i === 0 ? 0.015 : 0))),
      ask: variant(Array.from({ length: 80 }, (_, i) => median - (i === 0 ? 0.007 : 0))),
      spread: variant(Array.from({ length: 80 }, (_, i) => median + (i === 0 ? 0.004 : i === 1 ? -0.004 : 0))),
      boundary: variant(Array.from({ length: 80 }, (_, i) => median + (i === 0 ? -0.005 : i === 1 ? 0.001 : 0))),
      partial: variant(Array.from({ length: 80 }, () => median), "partial"),
    };
    const screens = Object.fromEntries(Object.entries(cases).map(([key, report]) => [key, redFlagScreen(report)]));
    expect(screens.injected.headline).toBe("Red flag: get it inspected");
    expect(screens.injected.findings.map((f) => f.check)).toEqual(["cell-groups-at-rest", "cell-groups-at-rest"]);
    expect(screens.injected.findings[0]?.detail).toContain("Group 1 (module 1)");
    expect(screens.injected.findings[0]?.detail).toContain("15.0 mV");
    expect(screens.injected.findings).toEqual([
      { severity: "red-flag", check: "cell-groups-at-rest", detail: "Group 1 (module 1): 15.0 mV from set median; 3.9850 V." },
      { severity: "red-flag", check: "cell-groups-at-rest", detail: "80-group spread: 15.0 mV." },
    ]);
    expect(screens.ask.headline).toBe("Ask about this");
    expect(screens.ask.findings).toEqual([
      { severity: "ask-about-this", check: "cell-groups-at-rest", detail: "Group 1 (module 1): 7.0 mV from set median; 3.9930 V." },
      { severity: "ask-about-this", check: "cell-groups-at-rest", detail: "80-group spread: 7.0 mV." },
    ]);
    expect(screens.spread.headline).toBe("Ask about this");
    expect(screens.spread.findings).toEqual([{ severity: "ask-about-this", check: "cell-groups-at-rest", detail: "80-group spread: 8.0 mV." }]);
    expect(screens.boundary.findings).toEqual([]);
    expect(screens.boundary.headline).toBe("No red flags found");
    expect(screens.partial.headline).toBe("Check incomplete");
    expect(screens.partial.findings).toEqual([]);
    expect(renderBatteryDiagnosis(cases.partial)).toContain("Partial scan: some checks may be missing.");
    for (const [name, report] of Object.entries(cases)) writeFileSync(`/tmp/t2.15-synthetic-${name}.md`, renderBatteryDiagnosis(report));
    writeFileSync("/tmp/t2.15-synthetic-verdicts.json", `${JSON.stringify({ synthetic: true, base: baseScreen, cases: screens }, null, 2)}\n`);
  });

  it("shows synthetic code findings and incomplete coverage together", async () => {
    const baseReport = await replay("2026-09-22-spike.redacted.jsonl");
    const names = ["codes-stored.jsonl", "codes-permanent.jsonl", "codes-cleared.jsonl"];
    const expectedFindings = [
      ["stored code P0133 reported by ECU 7E8.", "pending code U0158 reported by ECU 7E8.", "permanent code P0133 reported by ECU 7E8."],
      ["permanent code P0133 reported by ECU 7E8.", "Recently cleared codes: indicated by the reported checks."],
      ["Recently cleared codes: indicated by the reported checks."],
    ];
    const rows = [];
    for (const [index, name] of names.entries()) {
      const codes = await codesReportFromRecording(parseRecording(readFileSync(new URL(`fixtures/synthetic/${name}`, root), "latin1")));
      const screen = redFlagScreen({ ...baseReport, codes });
      expect(screen.headline).toBe("Ask about this");
      expect(screen.coverage[0]?.status).toBe("not-checked");
      expect(screen.coverage[0]?.reason).toBe(restMissing);
      expect(screen.coverage[1]).toEqual({ check: "codes", status: "checked", reason: codesChecked });
      expect(screen.findings).toEqual(expectedFindings[index]?.map((detail) => ({ severity: "ask-about-this", check: "codes", detail })));
      rows.push({ synthetic: true, fixture: name, screen });
    }
    const failed = { ...baseReport, codes: { ...baseReport.codes, modules: baseReport.codes.modules.map((module) => ({ ...module, pending: { status: "not-read" as const } })) } };
    const incomplete = redFlagScreen(failed);
    expect(incomplete.headline).toBe("Check incomplete");
    expect(incomplete.coverage[1]?.reason).toContain("pending");
    expect(incomplete.coverage[1]).toEqual({ check: "codes", status: "not-checked", reason: "No successful standard OBD read for pending mode; other vehicle modules may also hold codes." });
    expect(incomplete.findings).toEqual([]);
    rows.push({ synthetic: true, fixture: "in-memory missing pending", screen: incomplete });
    const fixtureCodes = await codesReportFromRecording(parseRecording(readFileSync(new URL("fixtures/synthetic/codes-stored.jsonl", root), "latin1")));
    const fixtureStored = fixtureCodes.modules.flatMap((module) => module.stored.status === "read" ? module.stored.dtcs : [])[0];
    if (!fixtureStored) throw new Error("synthetic stored-code recording needs a decoded code");
    const observedWithFailedMode = redFlagScreen({ ...failed, codes: { ...failed.codes, modules: failed.codes.modules.map((module, index) => index === 0 ? { ...module, stored: { status: "read" as const, dtcs: [fixtureStored] } } : module) } });
    expect(observedWithFailedMode.headline).toBe("Ask about this");
    expect(observedWithFailedMode.findings).toEqual([{ severity: "ask-about-this", check: "codes", detail: "stored code P0133 reported by ECU 17." }]);
    expect(observedWithFailedMode.coverage[0]?.reason).toBe(restMissing);
    expect(observedWithFailedMode.coverage[1]).toEqual({ check: "codes", status: "not-checked", reason: "No successful standard OBD read for pending mode; other vehicle modules may also hold codes." });
    rows.push({ synthetic: true, fixture: "in-memory observed code and missing pending/rest", screen: observedWithFailedMode });
    writeFileSync("/tmp/t2.15-synthetic-codes.json", `${JSON.stringify(rows, null, 2)}\n`);
  });
});

describe("battery diagnosis recording replay", () => {
  it("replays the targeted watch as corroborating parked evidence", async () => {
    const name = "2026-09-23-discovery-targeted.redacted.jsonl";
    const report = await replay(name);
    const lines = parseRecording(readFileSync(new URL(report.recording, root), "latin1"));
    const log = await chargeLogFromRecording(lines, report.recording, signalset);
    const bracketed = log.groups.filter((group) => { const before = log.current.filter((point) => point.t < group.t).at(-1); const after = log.current.find((point) => point.t > group.t); return before !== undefined && after !== undefined && Math.abs(before.value) <= REST_CURRENT_A && Math.abs(after.value) <= REST_CURRENT_A; });
    const first = log.groups[0];
    const evidence = { recording: report.recording, sourceLines: { energy: "tx 572/rx 573–575", group: "tx 592/604/616/628/640/653/665; rx 593–676", soc: "tx 677/rx 678–686", raw: "tx 1953/rx 1954–1961" }, completeSets: log.groups.length, bracketedSets: bracketed.length, firstGroup: { count: first.volts.length, modules: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, first.modules.filter((module) => module === i + 1).length])) }, parked: report.parked, capacity: report.capacity.status, health: report.health.status };
    writeFileSync("/tmp/t2.14-targeted-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`);
    writeFileSync("/tmp/t2.14-targeted-report.md", renderBatteryDiagnosis(report));
    expect(report.parked?.groupVoltages?.volts).toHaveLength(80);
    expect(log.groups).toHaveLength(111);
    expect(evidence.firstGroup.modules).toEqual(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 8])));
    expect(report.parked?.groupVoltages !== undefined).toBe(bracketed.length > 0);
    expect(report.parked?.groupVoltages?.sources).toHaveLength(7);
    expect(report.parked?.bmsFigure?.valueKwh).toBeGreaterThan(0);
    expect(report.parked?.temperatureRaw?.payloadHex).toMatch(/^(61){20}(00){4}$/);
    expect(report.capacity.status).toBe("not-measured");
  });

  it("round trips the legacy recordings with absent parked fields", async () => {
    const names = [...paths, "2026-09-24-phone-console.redacted.jsonl"];
    const reports = await Promise.all(names.map(replay));
    const artifact = reports.map((report) => {
      const soc = report.signals.filter((signal) => signal.id === "EQUINOXEV_SOC").at(-1);
      return { recording: report.recording, parked: report.parked ?? null, signals: report.signals.length, soc: soc ? { status: "present", value: soc.value, source: soc.source } : { status: "absent" }, spread: report.cellSpread?.volts ?? null, codes: report.codes, capacity: report.capacity.status, health: report.health.status };
    });
    writeFileSync("/tmp/t2.14-legacy-reports.json", `${JSON.stringify(artifact, null, 2)}\n`);
    expect(artifact.map((item) => item.soc.status)).toEqual(["present", "present", "absent"]);
    expect(artifact.slice(0, 2).map((item) => "value" in item.soc ? item.soc.value : null)).toEqual([expect.closeTo(69.8, 1), expect.closeTo(69.8, 1)]);
    expect(artifact.map((item) => item.codes.modules.map((module) => [module.stored.status, module.pending.status, module.permanent.status]))).toEqual([
      [["read", "read", "failed"], ["read", "read", "read"], ["read", "read", "read"], ["read", "read", "read"], ["read", "read", "failed"]],
      [["read", "read", "failed"], ["read", "read", "read"], ["read", "read", "read"], ["read", "read", "read"], ["read", "read", "failed"]],
      Array.from({ length: 5 }, () => ["read", "not-read", "not-read"]),
    ]);
    expect(artifact.every((item) => item.codes.modules.every((module) => [module.stored, module.pending, module.permanent].every((read) => read.status !== "read" || read.dtcs.length === 0)))).toBe(true);
    expect(artifact.every((item) => item.parked === null)).toBe(true);
    for (const report of reports) expect(parseBatteryDiagnosis(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it.each(paths)("renders one sourced scan from %s", async (name) => {
    const report = await replay(name);
    expect(report.signals.filter((s) => s.tier === "verified")).toHaveLength(2);
    expect(report.signals.filter((s) => s.tier === "community")).toHaveLength(3);
    expect(report.signals.every((s) => s.source.recording === report.recording && s.source.command.startsWith("22 ") && s.source.ecu)).toBe(true);
    expect(report.cellSpread?.tier).toBe("community");
    expect(report.cellSpread?.min.command).toBe("22 2AF5");
    expect(report.cellSpread?.max.command).toBe("22 2AF5");
    expect(report.twelveVolt.observations).toHaveLength(1);
    expect(report.twelveVolt.observations[0]?.source).toBe("adapter-supply");
    expect(report.capacity.status).toBe("not-measured");
    expect(report.health.status).toBe("not-assessed");
    const artifact = renderBatteryDiagnosis(report);
    expect(artifact).toContain(report.recording);
    expect(artifact).toContain("capacity: NOT MEASURED");
    expect(artifact).toContain("battery health: not assessed");
    expect(artifact).toContain("not read");
    expect(artifact).not.toMatch(/\b[A-HJ-NPR-Z0-9]{17}\b/);
    expect(artifact).not.toContain("18DAF1CB");
    expect(parseBatteryDiagnosis(JSON.parse(JSON.stringify(report)))).toEqual(report);
    writeFileSync(`/tmp/t2.6a-${name}.md`, artifact);
  });

  it("keeps a phone console scan without Mode 22 separate", async () => {
    const report = await replay("2026-09-24-phone-console.redacted.jsonl");
    expect(report.signals).toHaveLength(0);
    expect(report.cellSpread).toBeUndefined();
    expect(report.capacity.status).toBe("not-measured");
    const artifact = renderBatteryDiagnosis(report);
    writeFileSync("/tmp/t2.6a-phone-console.md", artifact);
    expect(artifact).toContain("Battery observations: not read");
  });

  it("rejects two recorded sessions presented as one scan", async () => {
    const sources = paths.map((name) => base + name);
    const combined = sources.map((path) => readFileSync(new URL(path, root), "latin1")).join("");
    let error = "";
    try {
      await batteryDiagnosisFromRecording(combined, {
        garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z",
        recording: sources[0], scanStatus: "complete",
      }, signalset);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const result = { sources, rejected: error !== "", error };
    writeFileSync("/tmp/t2.6a-multiple-sessions.json", `${JSON.stringify(result, null, 2)}\n`);
    expect(result.rejected).toBe(true);
    expect(result.error).toMatch(/single recording session/);
  });

  const synthetic = "fixtures/synthetic/battery-diagnosis-full-scan.jsonl";
  const withStart = (note: string, powerState: unknown) => {
    const [, ...rest] = readFileSync(new URL(synthetic, root), "latin1").split("\n");
    const start = { t: 0, dir: "meta", car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note, powerState, writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
    return batteryDiagnosisFromRecording([JSON.stringify(start), ...rest].join("\n"), {
      garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-24T00:00:00.000Z", recording: synthetic, scanStatus: "complete",
    }, signalset);
  };
  const states = async (report: ReturnType<typeof withStart>) => (await report).twelveVolt.observations.map((o) => o.powerState);

  it("power-state-key-wins: the start line's powerState key wins over the note", async () => {
    expect(await states(withStart("synthetic; ready", "unknown"))).toEqual(["unknown"]);
    expect(await states(withStart("synthetic; power state not noted", "ready"))).toEqual(["ready"]);
  });

  it("power-state-invalid: a powerState key outside ready/unknown is refused", async () => {
    for (const value of ["other", 1]) {
      await expect(withStart("synthetic; ready", value)).rejects.toThrow("battery scan power state meta is invalid");
    }
  });

  it("rejects malformed, future, nonfinite and unsourced saved reports", async () => {
    const valid = await replay(paths[0]);
    const cases = [
      ["future-version", { ...valid, version: 2 }],
      ["nonfinite-observation", { ...valid, signals: [{ ...valid.signals[0], value: Infinity }] }],
      ["unsourced-observation", { ...valid, signals: [{ ...valid.signals[0], source: { ...valid.signals[0]?.source, recording: "" } }] }],
      ["invalid-capacity", { ...valid, capacity: { status: "measured", reason: "" } }],
    ] as const;
    const results = cases.map(([name, bad]) => {
      try { parseBatteryDiagnosis(bad); return { name, rejected: false }; }
      catch { return { name, rejected: true }; }
    });
    writeFileSync("/tmp/t2.6a-malformed-report.json", `${JSON.stringify(results)}\n`);
    expect(results.every((result) => result.rejected)).toBe(true);
  });
});
