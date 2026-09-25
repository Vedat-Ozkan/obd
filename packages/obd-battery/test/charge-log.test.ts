import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRecording, type RecordingLine } from "../../obd-core/src/recording/format.js";
import { importObdbMode22 } from "../../obd-core/src/vehicles/obdb/import.js";
import { chargeLogSummary } from "../scripts/charge-log.js";
import { bmsEnergyCapacity, integratedCurrentCapacity } from "../src/capacity.js";
import { groupImbalance } from "../src/imbalance.js";
import { chargeLogFromRecording, chargePhases, largestGap } from "../src/session.js";

// Spec: docs/specs/T2.4-charge-logger.md §Verification, Stage A.
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "latin1");
const readUtf8 = (path: string) => readFileSync(new URL(path, root), "utf8");
const signals = importObdbMode22(JSON.parse(read("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json")));
const synthetic = "fixtures/synthetic/charge-log-rested.jsonl";
const real = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-discovery-targeted.redacted.jsonl";
const artifact = "packages/obd-battery/test/charge-log-reports.md";

interface Label {
  synthetic: true;
  reference: { method: "synthetic-generator"; capacity_ah: number; capacity_kwh: number };
  windows: Record<"preRest" | "charge" | "postRest", { start: number; end: number }>;
  weak_group: { index: number; module: number };
  planted: {
    current_gap: { seconds: number; at: number };
    group_gap: { seconds: number; at: number };
    not_80_group_set: { at: number; valid: number };
  };
}
const label = JSON.parse(read("fixtures/synthetic/charge-log-rested.label.json")) as Label;

async function load(path: string): Promise<{ lines: RecordingLine[]; summary: string }> {
  const lines = parseRecording(read(path));
  return { lines, summary: await chargeLogSummary(lines, path) };
}

describe("pnpm charge-log artifact", () => {
  it("regenerates packages/obd-battery/test/charge-log-reports.md byte for byte", async () => {
    const sections = [(await load(synthetic)).summary, (await load(real)).summary];
    expect(readUtf8(artifact)).toBe(sections.join("\n"));
  }, 60_000);
});

describe("synthetic charge log (labeled synthetic)", () => {
  it("finds the generator's windows, passes the gate, and bands contain the generator's truth", async () => {
    const { lines, summary } = await load(synthetic);
    const log = await chargeLogFromRecording(lines, synthetic, signals);
    const phases = chargePhases(log);
    expect(log.synthetic).toBe(true);
    expect(summary).toContain("\nSynthetic: yes\n");
    expect(summary).toContain("\nGate (T2.4 verify line): PASS");
    expect(phases.preRest).toEqual(label.windows.preRest);
    expect(phases.charge).toEqual(label.windows.charge);
    expect(phases.postRest).toEqual(label.windows.postRest);

    const integrated = integratedCurrentCapacity(log, phases);
    if (integrated.status !== "estimated") throw new Error(integrated.reason);
    expect(integrated.unit).toBe("Ah");
    expect(Math.abs(integrated.value - label.reference.capacity_ah)).toBeLessThanOrEqual(integrated.band);

    const bms = bmsEnergyCapacity(log);
    for (const figure of [bms.first, bms.last]) {
      if (figure.status !== "estimated") throw new Error(figure.reason);
      expect(Math.abs(figure.value - label.reference.capacity_kwh)).toBeLessThanOrEqual(figure.band);
    }

    const imbalance = groupImbalance(log, phases);
    expect(imbalance.groups.length).toBeGreaterThan(0);
    for (const extremes of imbalance.groups) {
      expect([extremes.minIndex, extremes.minModule]).toEqual([label.weak_group.index, label.weak_group.module]);
    }
  });

  it("reports the planted early current gap, 2AE3 NO DATA cycle and not-80 group set, all outside the gate span", async () => {
    const { lines, summary } = await load(synthetic);
    const log = await chargeLogFromRecording(lines, synthetic, signals);
    const phases = chargePhases(log);
    const start = label.windows.preRest.start;
    expect(largestGap(log.current)).toEqual(label.planted.current_gap);
    expect(largestGap(log.groups)).toEqual(label.planted.group_gap);
    expect(label.planted.current_gap.at + label.planted.current_gap.seconds).toBeLessThanOrEqual(start);
    expect(label.planted.group_gap.at + label.planted.group_gap.seconds).toBeLessThanOrEqual(start);
    // Decision 8: a count other than 80 drops that cycle's set and is reported, never guessed.
    const planted = label.planted.not_80_group_set;
    expect(planted.valid).not.toBe(80);
    expect(planted.at).toBeLessThan(start);
    expect(log.droppedGroupSets.filter((d) => d.reason === "not-80-records")).toEqual([{ t: planted.at, reason: "not-80-records", valid: planted.valid }]);
    expect(log.groups.some((g) => g.t === planted.at)).toBe(false);
    expect(summary).toContain(`; not 80 valid records 1, t=${String(planted.at)} ${String(planted.valid)} records)\n`);
    expect(phases.currentGap.seconds).toBeLessThanOrEqual(10);
    expect(phases.groupGap.seconds).toBeLessThanOrEqual(10);
    expect(phases.currentGap.at).toBeGreaterThanOrEqual(start);
    expect(phases.groupGap.at).toBeGreaterThanOrEqual(start);
  });

  // Decision 10: a post-charge rest shorter than POST_REST_S (a partial run) must not pass.
  it.each([[1720, 0], [1760, 40], [3510, 1790]])("fails the gate and BM2 selection when the log stops before t=%i (post-charge rest %i s)", async (cutoff, rest) => {
    const lines = parseRecording(read(synthetic)).filter((line) => line.t < cutoff);
    const summary = await chargeLogSummary(lines, synthetic);
    expect(summary).toMatch(new RegExp(`\\nGate \\(T2\\.4 verify line\\): FAIL: .*post-charge rest ${String(rest)} s < 1800 s`));
    expect(summary).toMatch(/\n {2}BM2 selection: fail \(/);
    expect(summary).not.toContain("BM2 selection: pass");
  });

  // Decision 10 (reworded): the gate tests the uncut rest run, so millisecond jitter at the 1800 s clip cannot fail a complete log.
  // No +4 ms case: the fixture's 2414 cadence is exactly 10 s, so +4 ms makes a 10.004 s gap (> MAX_GAP_S), which ends the run.
  it.each([[-0.004]])("passes the gate and BM2 selection when the lines from t=3510 on are shifted by %f s", async (shift) => {
    const lines = parseRecording(read(synthetic)).map((line) => (line.t >= 3510 ? { ...line, t: line.t + shift } : line));
    const summary = await chargeLogSummary(lines, synthetic);
    expect(summary).toContain("\nGate (T2.4 verify line): PASS");
    expect(summary).toContain("\n  BM2 selection: pass\n");
  });
});

describe("P1 recording (real): the scaling check", () => {
  it("decodes the §7.4 values, fails the gate on the current gap, and estimates nothing integrated", async () => {
    const { lines, summary } = await load(real);
    const log = await chargeLogFromRecording(lines, real, signals);
    const phases = chargePhases(log);
    const txT = (line: number) => {
      const tx = lines[line - 1];
      if (tx.dir !== "tx" || tx.data !== "22 2414\r") throw new Error(`line ${String(line)} is not the 2414 request`);
      return tx.t;
    };
    const at = (line: number) => log.current.find((p) => p.t === txT(line))?.value;
    expect([at(26002), at(53458), at(81233)]).toEqual([12.9, -26.35, 1.2]);

    expect(log.packVolts.length).toBeGreaterThan(0);
    for (const p of log.packVolts) {
      expect(p.value).toBeGreaterThanOrEqual(326.0);
      expect(p.value).toBeLessThanOrEqual(329.5);
    }

    // §7.3: plugged in a few seconds before the line 44553 mark, so 74.76 is the last reading before it.
    const before = (line: number) => log.energyKwh.filter((p) => p.t < lines[line - 1].t).at(-1)?.value;
    expect([before(44553), before(74351)]).toEqual([74.76, 75.52]);

    const bms = bmsEnergyCapacity(log);
    for (const figure of [bms.first, bms.last]) {
      if (figure.status !== "estimated") throw new Error(figure.reason);
      expect(figure.value).toBeGreaterThanOrEqual(88.5 - figure.band);
      expect(figure.value).toBeLessThanOrEqual(88.7 + figure.band);
    }

    // Decision 8: an exact-equality statistic, regenerated, never a gate.
    const { agreement } = groupImbalance(log, phases);
    expect(agreement.of).toBeGreaterThan(0);
    expect([agreement.matching, agreement.of]).toEqual([27, 111]);

    expect(phases.currentGap.seconds).toBeGreaterThan(10);
    expect(summary).toMatch(/\nGate \(T2\.4 verify line\): FAIL: .*current gap/);
    expect(phases.preRest).toBeUndefined();
    expect(phases.postRest).toBeUndefined();
    const integrated = integratedCurrentCapacity(log, phases);
    expect(integrated.status).toBe("not-estimated");
    if (integrated.status === "not-estimated") {
      expect(integrated.reason).toContain("no pre-charge rest window");
      expect(integrated.reason).toContain("no post-charge rest window");
    }
    expect(summary).toContain("\nIntegrated current ÷ ΔSOC: NOT ESTIMATED: ");
    expect(summary).toContain("\nSynthetic: no\n");
  }, 60_000);
});
