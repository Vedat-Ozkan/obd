import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importObdbMode22 } from "obd-core/vehicles";
import { batteryDiagnosisFromRecording, parseBatteryDiagnosis, renderBatteryDiagnosis } from "obd-battery/report";

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

describe("battery diagnosis recording replay", () => {
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
