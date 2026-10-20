import type { ChargeLog } from "./session.js";

export const STEADY_A = 10;
export const BRACKET_MAX_S = 3;
export const LOAD_A = 50;
export const MIN_LOADED_SETS = 10;
export const Z = 2;
export const MARGIN = 2;
export const GROUP_EXCESS_LIMIT_MOHM = 0.04;

export interface GroupUnderLoad { index: number; module: number; excessMohm: number; seMohm: number; lowerMohm: number; flagged: boolean }
export interface GroupsUnderLoad {
  status: "checked" | "not-checked";
  reason?: string;
  completeSets: number; steadySets: number; loadedSets: number;
  currentRange?: { min: number; max: number };
  groups: readonly GroupUnderLoad[];
  flagged: readonly number[];
  medianGroupMohm?: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] ?? NaN : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
};

function slope(x: readonly number[], y: readonly number[]): { b: number; se: number } {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0; let sxy = 0;
  x.forEach((xi, i) => { sxx += (xi - mx) ** 2; sxy += (xi - mx) * ((y[i] ?? 0) - my); });
  const b = sxy / sxx;
  let rss = 0;
  x.forEach((xi, i) => { rss += ((y[i] ?? 0) - my - b * (xi - mx)) ** 2; });
  return { b, se: Math.sqrt(rss / (n - 2) / sxx) };
}

export function groupsUnderLoad(log: ChargeLog, limitMohm: number = GROUP_EXCESS_LIMIT_MOHM): GroupsUnderLoad {
  const steady: { set: ChargeLog["groups"][number]; amps: number }[] = [];
  let next = 0;
  for (const set of log.groups) {
    while (next < log.current.length && (log.current[next]?.t ?? Infinity) < set.t) next++;
    const before = next > 0 ? log.current.at(next - 1) : undefined;
    const after = log.current.at(next);
    if (before === undefined || after === undefined) continue;
    if (after.t - before.t > BRACKET_MAX_S || Math.abs(after.value - before.value) > STEADY_A) continue;
    if (log.recoveries.some((r) => r >= before.t && r <= after.t)) continue;
    steady.push({ set, amps: (before.value + after.value) / 2 });
  }
  const loadedSets = steady.filter((s) => Math.abs(s.amps) >= LOAD_A).length;
  const counts = { completeSets: log.groups.length, steadySets: steady.length, loadedSets };
  const notChecked = (reason: string): GroupsUnderLoad => ({ status: "not-checked", reason, ...counts, groups: [], flagged: [] });

  if (loadedSets < MIN_LOADED_SETS) return notChecked(`fewer than ${String(MIN_LOADED_SETS)} steady sets at or above ${String(LOAD_A)} A (${String(loadedSets)})`);
  const modules = steady[0]?.set.modules ?? [];
  if (steady.some((s) => s.set.modules.length !== modules.length || s.set.modules.some((m, i) => m !== modules[i]))) return notChecked("group order changed");

  const amps = steady.map((s) => s.amps);
  const deviations = steady.map((s) => { const m = median(s.set.volts); return s.set.volts.map((v) => v - m); });
  const groups = modules.map((module, index): GroupUnderLoad => {
    const { b, se } = slope(amps, deviations.map((d) => d[index] ?? NaN));
    const excessMohm = -1000 * b;
    const seMohm = 1000 * se;
    const lowerMohm = excessMohm - Z * seMohm;
    return { index, module, excessMohm, seMohm, lowerMohm, flagged: lowerMohm > limitMohm };
  });
  const absolute = modules.map((_, index) => -1000 * slope(amps, steady.map((s) => s.set.volts[index] ?? NaN)).b);
  return {
    status: "checked", ...counts, groups,
    flagged: groups.filter((g) => g.flagged).map((g) => g.index),
    currentRange: { min: Math.min(...amps), max: Math.max(...amps) },
    medianGroupMohm: median(absolute),
  };
}
