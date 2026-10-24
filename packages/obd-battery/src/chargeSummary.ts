import { TREND_POLICY } from "./trend.js";
import { integratedCurrentCapacity } from "./capacity.js";
import { groupsUnderLoad } from "./driveGroups.js";
import { groupImbalance, type SpreadPoint } from "./imbalance.js";
import { chargePhases, gateFailures, MAX_GAP_S, span, type ChargeLog, type Window } from "./session.js";

export interface ChargeSessionSummary {
  version: 1;
  id: string;
  at: string;
  recording: string;
  synthetic: boolean;
  capacity?: { ah: number; bandAh: number; deltaSoc: number };
  gateFailures: readonly string[];
  preRestS?: number;
  postRestS?: number;
  spread: readonly SpreadPoint[];
  powerBySoc: readonly { socBin: number; medianKw: number; n: number }[];
  groupsUnderLoad?: { flagged: readonly number[]; excessMohm: readonly { index: number; mohm: number }[] };
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] ?? NaN : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
};

function powerBySoc(log: ChargeLog, charge: Window | undefined): ChargeSessionSummary["powerBySoc"] {
  if (charge === undefined) return [];
  const bins = new Map<number, number[]>();
  for (const i of log.current) {
    if (i.t < charge.start || i.t > charge.end) continue;
    const v = log.packVolts.find((p) => p.t >= i.t && p.t - i.t <= MAX_GAP_S);
    const soc = log.soc.filter((p) => p.t <= i.t).at(-1);
    if (v === undefined || soc === undefined) continue;
    const bin = Math.floor(soc.value / TREND_POLICY.powerBinPct) * TREND_POLICY.powerBinPct;
    bins.set(bin, [...(bins.get(bin) ?? []), (-i.value * v.value) / 1000]);
  }
  return [...bins].sort(([a], [b]) => a - b).map(([socBin, kw]) => ({ socBin, medianKw: median(kw), n: kw.length }));
}

export function summariseChargeLog(log: ChargeLog, id: string, at: string): ChargeSessionSummary {
  const phases = chargePhases(log);
  const estimate = integratedCurrentCapacity(log, phases);
  const deltaSoc = estimate.status === "estimated" ? estimate.inputs.find((i) => i.name === "ΔSOC")?.value : undefined;
  const load = groupsUnderLoad(log);
  return {
    version: 1, id, at, recording: log.recording, synthetic: log.synthetic,
    ...(estimate.status === "estimated" && deltaSoc !== undefined ? { capacity: { ah: estimate.value, bandAh: estimate.band, deltaSoc } } : {}),
    gateFailures: gateFailures(phases),
    ...(phases.preRest ? { preRestS: span(phases.preRest.start, phases.preRest.end) } : {}),
    ...(phases.postRest ? { postRestS: span(phases.postRest.start, phases.postRest.end) } : {}),
    spread: groupImbalance(log, phases).cellMinMax,
    powerBySoc: powerBySoc(log, phases.charge),
    ...(load.status === "checked" ? { groupsUnderLoad: { flagged: load.flagged, excessMohm: load.groups.map((g) => ({ index: g.index, mohm: g.excessMohm })) } } : {}),
  };
}
