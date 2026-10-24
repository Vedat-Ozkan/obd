import { bridgedRecoveries, isRecoveryGap, largestGap, MAX_GAP_S, span, type ChargeLog, type ChargePhases, type Point } from "./session.js";

export type CapacityEstimate =
  | {
      status: "estimated";
      method: "integrated-current-bms-soc" | "bms-energy-over-soc";
      label: string;
      value: number; band: number; unit: "Ah" | "kWh";
      terms: readonly { name: string; value: number; unit: string }[];
      inputs: readonly { name: string; value: number; unit: string }[];
      unbounded: readonly string[];
      t: number;
    }
  | { status: "not-estimated"; method: "integrated-current-bms-soc" | "bms-energy-over-soc"; reason: string };

export const INTEGRATED_LABEL = "BMS-SOC-referenced: divides by the BMS's own SOC, so it is not independent of the BMS (ADR-016). Not truth.";
export const BMS_LABEL = "BMS figure: 27AF energy remaining ÷ SOC. A comparison, not the reference (ADR-016). Not truth.";

const CURRENT_HALF_COUNT_A = 0.025;
const ENERGY_HALF_COUNT_KWH = 0.005;
const SOC_HALF_COUNT_PCT = 100 / 255 / 2;

function currentAt(current: readonly Point[], t: number): number {
  const after = current.findIndex((p) => p.t >= t);
  if (after === 0) return current[0].value;
  const a = current[after - 1];
  const b = current[after];
  return a.value + ((b.value - a.value) * (t - a.t)) / (b.t - a.t);
}

export function integratedCurrentCapacity(log: ChargeLog, phases: ChargePhases): CapacityEstimate {
  const method = "integrated-current-bms-soc" as const;
  const missing = [
    phases.preRest ? undefined : "no pre-charge rest window",
    phases.charge ? undefined : "no charge window",
    phases.postRest ? undefined : "no post-charge rest window",
  ].filter((m) => m !== undefined);
  if (missing.length > 0) return { status: "not-estimated", method, reason: missing.join("; ") };
  const { preRest, postRest } = phases as Required<Pick<ChargePhases, "preRest" | "postRest">>;
  const start = log.soc.filter((p) => p.t >= preRest.start && p.t <= preRest.end).at(-1);
  const end = log.soc.filter((p) => p.t >= postRest.start && p.t <= postRest.end).at(-1);
  if (start === undefined || end === undefined) return { status: "not-estimated", method, reason: "no SOC sample in a rest window" };
  const inside = log.current.filter((p) => p.t > start.t && p.t < end.t);
  const samples = [{ t: start.t, value: currentAt(log.current, start.t) }, ...inside, { t: end.t, value: currentAt(log.current, end.t) }];
  const bridged = bridgedRecoveries(log.current, log.recoveries);
  const gap = largestGap(samples, undefined, bridged);
  if (gap.seconds > MAX_GAP_S) return { status: "not-estimated", method, reason: `current gap of ${String(gap.seconds)} s at t=${String(gap.at)}` };
  const deltaSoc = end.value - start.value;
  if (deltaSoc <= 0) return { status: "not-estimated", method, reason: `SOC did not rise (${String(start.value)} % to ${String(end.value)} %)` };
  let ampSeconds = 0;
  let spread = 0;
  const recoveries: { name: string; value: number; unit: string }[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    ampSeconds += ((samples[i].value + samples[i - 1].value) / 2) * dt;
    spread += Math.abs(samples[i].value - samples[i - 1].value) * dt;
    if (isRecoveryGap(samples[i - 1].t, samples[i].t, bridged)) {
      const value = (Math.max(Math.abs(samples[i - 1].value), Math.abs(samples[i].value)) * span(samples[i - 1].t, samples[i].t)) / 3600;
      recoveries.push({ name: `recovery gap at t=${String(samples[i - 1].t)}`, value, unit: "Ah" });
    }
  }
  const q = -ampSeconds / 3600;
  const resolution = (CURRENT_HALF_COUNT_A * (end.t - start.t)) / 3600;
  const integration = spread / 2 / 3600;
  const socTerm = 2 * SOC_HALF_COUNT_PCT;
  const value = q / (deltaSoc / 100);
  const relative = (resolution + integration + recoveries.reduce((sum, r) => sum + r.value, 0)) / Math.abs(q) + socTerm / deltaSoc;
  return {
    status: "estimated", method, label: INTEGRATED_LABEL, value, band: Math.abs(value) * relative, unit: "Ah",
    terms: [
      { name: "current resolution", value: resolution, unit: "Ah" },
      { name: "integration", value: integration, unit: "Ah" },
      { name: "SOC resolution on ΔSOC", value: socTerm, unit: "%" },
      ...recoveries,
    ],
    inputs: [
      { name: "SOC0", value: start.value, unit: "%" }, { name: "t0", value: start.t, unit: "s" },
      { name: "SOC1", value: end.value, unit: "%" }, { name: "t1", value: end.t, unit: "s" },
      { name: "ΔSOC", value: deltaSoc, unit: "%" }, { name: "Q", value: q, unit: "Ah" },
    ],
    unbounded: ["current sensor gain and offset", "BMS SOC model error and lag", "temperature (not measured)"],
    t: end.t,
  };
}

export function bmsFigure(energy: Point, soc: Point): CapacityEstimate {
  const value = energy.value / (soc.value / 100);
  return {
    status: "estimated", method: "bms-energy-over-soc", label: BMS_LABEL, value,
    band: value * (ENERGY_HALF_COUNT_KWH / energy.value + SOC_HALF_COUNT_PCT / soc.value), unit: "kWh",
    terms: [{ name: "27AF resolution", value: ENERGY_HALF_COUNT_KWH, unit: "kWh" }, { name: "SOC resolution", value: SOC_HALF_COUNT_PCT, unit: "%" }],
    inputs: [{ name: "27AF", value: energy.value, unit: "kWh" }, { name: "SOC", value: soc.value, unit: "%" }],
    unbounded: ["the BMS energy model", "whether the SOC basis is displayed or raw"],
    t: soc.t,
  };
}

export function bmsEnergyCapacity(log: ChargeLog): { first: CapacityEstimate; last: CapacityEstimate; range?: { min: number; max: number; n: number } } {
  const figures: CapacityEstimate[] = [];
  let e = 0;
  let previous = -Infinity;
  for (const soc of log.soc) {
    while (e < log.energyKwh.length && log.energyKwh[e].t <= soc.t) e++;
    const energy = log.energyKwh[e - 1] as Point | undefined;
    if (energy !== undefined && energy.t > previous && soc.value > 0) figures.push(bmsFigure(energy, soc));
    previous = soc.t;
  }
  if (figures.length === 0) {
    const none: CapacityEstimate = { status: "not-estimated", method: "bms-energy-over-soc", reason: "no cycle has both 27AF and 2B43" };
    return { first: none, last: none };
  }
  const values = figures.flatMap((f) => f.status === "estimated" ? [f.value] : []);
  return { first: figures[0], last: figures[figures.length - 1], range: { min: Math.min(...values), max: Math.max(...values), n: values.length } };
}

export function powerCheck(log: ChargeLog, phases: ChargePhases): { ivKw: number; energySlopeKw: number; ratio: number } | undefined {
  const charge = phases.charge;
  if (charge === undefined) return undefined;
  const within = (p: Point) => p.t >= charge.start && p.t <= charge.end;
  const products = log.current.filter(within).flatMap((i) => {
    const v = log.packVolts.find((p) => p.t >= i.t && p.t - i.t <= MAX_GAP_S);
    return v === undefined ? [] : [i.value * v.value];
  });
  const energy = log.energyKwh.filter(within);
  if (products.length === 0 || energy.length < 2) return undefined;
  const ivKw = -products.reduce((sum, p) => sum + p, 0) / products.length / 1000;
  const first = energy[0];
  const last = energy[energy.length - 1];
  const energySlopeKw = ((last.value - first.value) * 3600) / (last.t - first.t);
  return { ivKw, energySlopeKw, ratio: ivKw / energySlopeKw };
}
