import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRecording } from "../../obd-core/src/recording/format.js";
import { reportFromRecording } from "../scripts/twelve-volt-report.js";
import { buildTwelveVoltReport, renderTwelveVoltReport, type RestedAgmOcv } from "../src/twelve-volt.js";

const root = new URL("../../../", import.meta.url);
const load = (path: string) => parseRecording(readFileSync(new URL(path, root), "latin1"));
const spike = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl";
const spike2 = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike-2.redacted.jsonl";
const synthetic = "fixtures/synthetic/twelve-volt-vpwr.jsonl";

describe("12 V report artifacts", () => {
  it.each([[spike, 12.7], [spike2, 13.1]])("replays %s with only its Ready adapter observation", async (path, volts) => {
    const report = await reportFromRecording(load(path), path);
    expect(report.observations).toEqual([{ source: "adapter-supply", command: "ATRV", volts, powerState: "ready", recording: path }]);
    expect(report.batteryHealth).toBe("not-assessed");
    expect(report.rechargeAdvice).toBe("not-assessed");
    const artifact = renderTwelveVoltReport(report);
    expect(artifact).toContain(`${String(volts)} V`);
    expect(artifact).toContain("ELM adapter supply");
    expect(artifact).toContain("ready");
    expect(artifact).toContain("12 V battery health: not assessed");
    expect(artifact).not.toMatch(/^12 V voltage: .*control-module supply/m);
  });

  it("replays labeled synthetic malformed ATRV and valid PID 42 without a health verdict", async () => {
    const report = await reportFromRecording(load(synthetic), synthetic);
    expect(report.observations).toEqual([{ source: "module-supply", command: "0142", volts: 12.5, ecu: "17", powerState: "unknown", recording: synthetic }]);
    const artifact = renderTwelveVoltReport(report);
    expect(artifact).toContain("control-module supply");
    expect(artifact).toContain("ECU 17");
    expect(artifact).toContain("12 V battery health: not assessed");
    expect(artifact).not.toContain("ELM adapter supply");
  });

  it("screens only fully documented independent AGM OCV and keeps health unassessed", () => {
    const ocv: RestedAgmOcv = { source: "independent-terminal-voltmeter", chemistry: "AGM", volts: 12.63, restHours: 24, vehicleOff: true, noChargerOrLoad: true, surfaceChargeRemoved: true, temperatureC: 20, measurementNote: "synthetic example; no vehicle measurement" };
    const below = buildTwelveVoltReport([], ocv);
    const boundary = buildTwelveVoltReport([], { ...ocv, volts: 12.64 });
    const shortRest = buildTwelveVoltReport([], { ...ocv, restHours: 23.9 });
    expect([below.rechargeAdvice, boundary.rechargeAdvice, shortRest.rechargeAdvice]).toEqual(["recharge-and-retest", "no-recharge-flag", "not-assessed"]);
    for (const report of [below, boundary, shortRest]) {
      expect(report.batteryHealth).toBe("not-assessed");
      expect(renderTwelveVoltReport(report)).toContain("12 V battery health: not assessed");
    }
    expect(renderTwelveVoltReport(below)).toContain("12 V voltage: not recorded");
    expect(renderTwelveVoltReport(below)).toContain("20 C");
    expect(renderTwelveVoltReport(below)).toContain("recharge and retest");
    expect(renderTwelveVoltReport(boundary)).not.toContain("recharge and retest");
    for (const invalid of [
      { ...ocv, source: "adapter-supply" }, { ...ocv, chemistry: "flooded" },
      { ...ocv, noChargerOrLoad: false }, { ...ocv, vehicleOff: false },
      { ...ocv, surfaceChargeRemoved: false }, { ...ocv, measurementNote: "" },
      { ...ocv, volts: Number.NaN },
    ]) expect(() => buildTwelveVoltReport([], invalid as RestedAgmOcv)).toThrow();
  });

  it("rejects invalid observation source and voltage at the public boundary", () => {
    expect(() => buildTwelveVoltReport([{ source: "module-supply", command: "0142", volts: 12, powerState: "unknown", recording: synthetic }])).toThrow();
    expect(() => buildTwelveVoltReport([{ source: "adapter-supply", command: "0142", volts: 12, powerState: "unknown", recording: synthetic }])).toThrow();
    expect(() => buildTwelveVoltReport([{ source: "adapter-supply", command: "ATRV", volts: Infinity, powerState: "unknown", recording: synthetic }])).toThrow();
  });
});
