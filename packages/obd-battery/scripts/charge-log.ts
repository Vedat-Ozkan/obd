import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecording, type RecordingLine } from "../../obd-core/src/recording/format.js";
import { importObdbMode22 } from "../../obd-core/src/vehicles/obdb/import.js";
import { BMS_LABEL, bmsEnergyCapacity, INTEGRATED_LABEL, integratedCurrentCapacity, powerCheck, type CapacityEstimate } from "../src/capacity.js";
import { groupImbalance } from "../src/imbalance.js";
import { chargeLogFromRecording, chargePhases, largestGap, MAX_GAP_S, POST_REST_S, span, type ChargePhases, type Window } from "../src/session.js";

// Layout: docs/specs/T2.4-charge-logger.md §Summary artifact. `num` is the convention in src/report.ts (4 decimals).
const num = (value: number) => String(Math.round(value * 10000) / 10000);
const root = fileURLToPath(new URL("../../../", import.meta.url));

/** BM2 selection threshold, printed but not enforced (docs/ML.md §Methods). */
const BM2_MIN_DELTA_SOC = 30;

const window = (name: string, w: Window | undefined, extra = "") =>
  w === undefined ? `${name}: not found` : `${name}: t=${num(w.start)}–${num(w.end)} (${num(w.end - w.start)} s)${extra}`;
const gapText = (gap: { seconds: number; at: number }) => `${num(gap.seconds)} s at t=${num(gap.at)}`;
/** Decision 19: recovery gaps are counted and printed, never a failed condition. */
const recoveryText = (gaps: ChargePhases["recoveryGaps"]) =>
  gaps.length === 0 ? "recovery gaps: 0" : `recovery gaps: ${String(gaps.length)}, longest ${num(Math.max(...gaps.map((g) => g.seconds)))} s`;
const input = (estimate: CapacityEstimate & { status: "estimated" }, name: string) => estimate.inputs.find((i) => i.name === name)?.value ?? NaN;

function capacityLines(estimate: CapacityEstimate): string[] {
  if (estimate.status !== "estimated") return [`Integrated current ÷ ΔSOC: NOT ESTIMATED: ${estimate.reason}`];
  return [
    `Integrated current ÷ ΔSOC: ${num(estimate.value)} Ah ± ${num(estimate.band)} Ah`,
    `  SOC0 → SOC1: ${num(input(estimate, "SOC0"))} % at t=${num(input(estimate, "t0"))} → ${num(input(estimate, "SOC1"))} % at t=${num(input(estimate, "t1"))} (ΔSOC ${num(input(estimate, "ΔSOC"))} %), Q ${num(input(estimate, "Q"))} Ah`,
    `  Bounded terms (worst case, added linearly): ${estimate.terms.map((t) => `${t.name} ${num(t.value)} ${t.unit}`).join("; ")}`,
    `  Unbounded: ${estimate.unbounded.join("; ")}`,
  ];
}

/** Decision 10: an uncut post-charge rest run shorter than POST_REST_S is a failed condition for the gate and BM2 selection. */
function shortPostRest(phases: ChargePhases): string | undefined {
  const rest = phases.postRestRun;
  if (rest === undefined || span(rest.start, rest.end) >= POST_REST_S) return undefined;
  return `post-charge rest ${num(span(rest.start, rest.end))} s < ${String(POST_REST_S)} s`;
}

function bm2Line(estimate: CapacityEstimate, phases: ChargePhases): string {
  if (estimate.status !== "estimated") return `  BM2 selection: fail (${estimate.reason})`;
  const delta = input(estimate, "ΔSOC");
  const failed = [
    delta >= BM2_MIN_DELTA_SOC ? undefined : `ΔSOC ${num(delta)} % < ${String(BM2_MIN_DELTA_SOC)} %`,
    shortPostRest(phases),
  ].filter((f) => f !== undefined);
  return failed.length === 0 ? "  BM2 selection: pass" : `  BM2 selection: fail (${failed.join("; ")})`;
}

function bmsLines(bms: ReturnType<typeof bmsEnergyCapacity>): string[] {
  const { first, last, range } = bms;
  if (first.status !== "estimated" || last.status !== "estimated" || range === undefined) {
    return [`BMS figure: NOT ESTIMATED: ${first.status === "not-estimated" ? first.reason : "no range"}`];
  }
  const figure = (e: typeof first) => `${num(e.value)} kWh ± ${num(e.band)} at t=${num(e.t)}`;
  return [
    `BMS figure first: ${figure(first)}; last: ${figure(last)}; range ${num(range.min)}–${num(range.max)} kWh over ${String(range.n)} cycles`,
    `  Bounded terms (each figure): ${first.terms.map((t) => `${t.name} ${num(t.value)} ${t.unit}`).join("; ")}`,
    `  Unbounded: ${first.unbounded.join("; ")}`,
  ];
}

export async function chargeLogSummary(lines: readonly RecordingLine[], recording: string): Promise<string> {
  const signals = importObdbMode22(JSON.parse(readFileSync(resolve(root, "packages/obd-core/vehicles/chevrolet-equinox-ev/default.json"), "utf8")));
  const log = await chargeLogFromRecording(lines, recording, signals);
  const phases = chargePhases(log);
  const integrated = integratedCurrentCapacity(log, phases);
  const power = powerCheck(log, phases);
  const imbalance = groupImbalance(log, phases);
  const charge = phases.charge;
  const meanCharge = charge === undefined ? 0 : (() => {
    const inside = log.current.filter((p) => p.t >= charge.start && p.t <= charge.end);
    return inside.reduce((sum, p) => sum + p.value, 0) / inside.length;
  })();

  const failed = [
    phases.preRest ? undefined : "no pre-charge rest window",
    phases.charge ? undefined : "no charge window",
    phases.postRest ? undefined : "no post-charge rest window",
    shortPostRest(phases),
    phases.currentGap.seconds > MAX_GAP_S ? `largest current gap ${gapText(phases.currentGap)} > ${String(MAX_GAP_S)} s` : undefined,
    phases.groupGap.seconds > MAX_GAP_S ? `largest group-set gap ${gapText(phases.groupGap)} > ${String(MAX_GAP_S)} s` : undefined,
  ].filter((f) => f !== undefined);
  const sessions = log.sessions ?? [];
  const dropped = log.droppedGroupSets;
  const incomplete = dropped.filter((d) => d.reason === "incomplete").length;
  const notEighty = dropped.filter((d) => d.reason === "not-80-records");

  const out = [
    `# Charge log: ${recording}`,
    "",
    `Synthetic: ${log.synthetic ? "yes" : "no"}`,
    `Sessions: ${sessions.length === 0 ? "1 (no charge-log session boundary; replayed as one session)" : `${String(sessions.length)}: ${sessions.map((s) => `t=${num(s.t)} ${s.reason}`).join("; ")}`}`,
    `Samples: current ${String(log.current.length)} (largest gap ${gapText(largestGap(log.current))}), pack voltage ${String(log.packVolts.length)}, energy ${String(log.energyKwh.length)}, SOC ${String(log.soc.length)}, group sets ${String(log.groups.length)} (largest gap ${gapText(largestGap(log.groups))}), cell min/max ${String(log.cellMinMax.length)}`,
    `Group sets dropped: ${String(dropped.length)} (incomplete ${String(incomplete)}; not 80 valid records ${String(notEighty.length)}${notEighty.map((d) => `, t=${num(d.t)} ${String(d.valid)} records`).join("")})`,
    window("Pre-charge rest", phases.preRest),
    window("Charge", charge, `, mean ${num(meanCharge)} A`),
    window("Post-charge rest", phases.postRest),
    failed.length === 0
      ? `Gate (T2.4 verify line): PASS (largest current gap ${gapText(phases.currentGap)}, largest group-set gap ${gapText(phases.groupGap)}, ${recoveryText(phases.recoveryGaps)})`
      : `Gate (T2.4 verify line): FAIL: ${failed.join("; ")}${phases.recoveryGaps.length === 0 ? "" : ` (${recoveryText(phases.recoveryGaps)})`}`,
    power === undefined
      ? `Power check: not computed: ${charge === undefined ? "no charge window" : "no paired samples in the charge window"}`
      : `Power check: I×V ${num(power.ivKw)} kW, 27AF slope ${num(power.energySlopeKw)} kW, ratio ${num(power.ratio)}`,
    "",
    "## Capacity (estimates, not truth)",
    "",
    INTEGRATED_LABEL,
    ...capacityLines(integrated),
    bm2Line(integrated, phases),
    BMS_LABEL,
    ...bmsLines(bmsEnergyCapacity(log)),
    "",
    "## Cell-group spread (community tier; no fault verdict)",
    "",
    ...(imbalance.cellMinMax.length === 0 ? ["2AF5 spread: not computed: no rest or charge window"] : imbalance.cellMinMax.map((p) =>
      `2AF5 spread at ${p.at}: ${num(p.spreadMv)} mV at t=${num(p.t)}${p.socPct === undefined ? "" : `, SOC ${num(p.socPct)} %`}`)),
    ...imbalance.groups.map((g) =>
      `Group extremes at t=${num(g.t)}: min record ${String(g.minIndex)} of 80 (module ${String(g.minModule)}), max record ${String(g.maxIndex)} of 80 (module ${String(g.maxModule)}), spread ${num(g.spreadMv)} mV`),
    `Group min/max equal to 2AF5 min/max (exact; a statistic, not a gate): ${String(imbalance.agreement.matching)} of ${String(imbalance.agreement.of)} cycles`,
    ...imbalance.agreement.byState.map((s) => `  ${s.state}: ${String(s.matching)} of ${String(s.of)}`),
    "Temperature: not measured (no sourced scaling)",
  ];
  return out.join("\n") + "\n";
}

async function main(paths: readonly string[]): Promise<string> {
  const sections: string[] = [];
  for (const path of paths) {
    // Decision 11: `./fixtures/synthetic/...` and absolute paths under it count as synthetic too.
    const underSynthetic = relative(resolve(root, "fixtures/synthetic"), resolve(path));
    if (!path.endsWith(".redacted.jsonl") && (underSynthetic.startsWith("..") || isAbsolute(underSynthetic))) {
      throw new Error(`expected a redacted or explicitly synthetic JSONL path: ${path}`);
    }
    sections.push(await chargeLogSummary(parseRecording(readFileSync(resolve(path), "latin1")), path));
  }
  return sections.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) {
    process.stderr.write("usage: charge-log <*.redacted.jsonl|fixtures/synthetic/*.jsonl>...\n");
    process.exitCode = 1;
  } else {
    main(process.argv.slice(2)).then((output) => process.stdout.write(output)).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
