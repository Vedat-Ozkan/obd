import type { ChargeLog } from "./session.js";

// Spec: docs/specs/T2.13-drive-check.md §Design, The measure and §Rule. Pure over the ChargeLog; decoding stays T2.4's.
// The values below are policy, locked by the owner on 2026-10-01 before any group statistic was computed.

/** A set is steady when the currents on both sides of it differ by at most this (T2.12's BRACKET_SAME_A). */
export const STEADY_A = 10;
/** The two bracketing currents must be at most this far apart; excludes sets that sit across a stall. */
export const BRACKET_MAX_S = 3;
/** A steady set is "under load" at or above this |current|. */
export const LOAD_A = 50;
/** Fewest loaded steady sets for a slope; below this the result is not-checked, not a pass. */
export const MIN_LOADED_SETS = 10;
/** Lower-bound multiplier on the slope standard error. */
export const Z = 2;
/** Multiplier in the formula for the limit below. */
export const MARGIN = 2;
/**
 * Computed once, from drive 1 only (fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive.redacted.jsonl), spec §Rule:
 * L = ceil(100 x MARGIN x max_g e_g) / 100 mΩ. The printed max excess on drive 1 was 0.0174 mΩ (0.017395647 unrounded; group 16, module 2),
 * so ceil(100 x 2 x 0.017395647) = ceil(3.479) = 4 and L = 0.04. Never changed in response to drive 2, a synthetic case or the Stage B drive.
 */
export const GROUP_EXCESS_LIMIT_MOHM = 0.04;

export interface GroupUnderLoad { index: number; module: number; excessMohm: number; seMohm: number; lowerMohm: number; flagged: boolean }
export interface GroupsUnderLoad {
  status: "checked" | "not-checked";
  reason?: string;
  completeSets: number; steadySets: number; loadedSets: number;
  currentRange?: { min: number; max: number };
  groups: readonly GroupUnderLoad[];
  flagged: readonly number[];
  /** Recorded in the artifact and the report data, never shown in the app (ADR-023 item 4). */
  medianGroupMohm?: number;
}

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] ?? NaN : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
};

/** Least-squares slope of y on x and its standard error (n - 2 degrees of freedom). */
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
  // Steady sets: the last current before the set and the first after it, close in time, close in value, no recovery between.
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
