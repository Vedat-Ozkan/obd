import type { CellMinMax, ChargeLog, ChargePhases, GroupSet, Window } from "./session.js";

// Spec §Estimates and error budgets, "Imbalance"; Decision 8. Community tier, no fault verdict.

export interface SpreadPoint { at: "pre-rest-end" | "post-rest-end" | "charge-max"; t: number; spreadMv: number; socPct?: number }
/** minIndex/maxIndex: 1-based position in the 80 valid records, record order. */
export interface GroupExtremes { t: number; minIndex: number; minModule: number; maxIndex: number; maxModule: number; spreadMv: number }
export interface Agreement { matching: number; of: number }

const spreadMv = (c: CellMinMax) => Math.round((c.max - c.min) * 1e7) / 1e4;

function extremes(set: GroupSet): GroupExtremes {
  let min = 0;
  let max = 0;
  for (const [i, v] of set.volts.entries()) {
    if (v < set.volts[min]) min = i;
    if (v > set.volts[max]) max = i;
  }
  return {
    t: set.t, minIndex: min + 1, minModule: set.modules[min], maxIndex: max + 1, maxModule: set.modules[max],
    spreadMv: Math.round((set.volts[max] - set.volts[min]) * 1e7) / 1e4,
  };
}

/** A cycle: a complete group set and the 2AF5 sample read before it since the previous group set. */
function cycles(log: ChargeLog): { cell: CellMinMax; set: GroupSet }[] {
  const out: { cell: CellMinMax; set: GroupSet }[] = [];
  let previous = -Infinity;
  for (const set of log.groups) {
    const cell = log.cellMinMax.filter((c) => c.t > previous && c.t <= set.t).at(-1);
    if (cell !== undefined) out.push({ cell, set });
    previous = set.t;
  }
  return out;
}

export function groupImbalance(log: ChargeLog, phases: ChargePhases): {
  cellMinMax: readonly SpreadPoint[];
  groups: readonly GroupExtremes[];
  agreement: Agreement & { byState: readonly ({ state: string } & Agreement)[] };
} {
  const paired = cycles(log);
  const inWindow = (w: Window) => log.cellMinMax.filter((c) => c.t >= w.start && c.t <= w.end);
  const points: { at: SpreadPoint["at"]; cell: CellMinMax }[] = [];
  const preEnd = phases.preRest ? inWindow(phases.preRest).at(-1) : undefined;
  if (preEnd) points.push({ at: "pre-rest-end", cell: preEnd });
  const during = phases.charge ? inWindow(phases.charge) : [];
  const peak = during.reduce<CellMinMax | undefined>((best, c) => best === undefined || spreadMv(c) > spreadMv(best) ? c : best, undefined);
  if (peak) points.push({ at: "charge-max", cell: peak });
  const postEnd = phases.postRest ? inWindow(phases.postRest).at(-1) : undefined;
  if (postEnd) points.push({ at: "post-rest-end", cell: postEnd });

  const cellMinMax = points.map(({ at, cell }): SpreadPoint => {
    const soc = at === "charge-max" ? log.soc.filter((s) => s.t <= cell.t).at(-1) : undefined;
    return { at, t: cell.t, spreadMv: spreadMv(cell), ...(soc ? { socPct: soc.value } : {}) };
  });
  const groups = points.flatMap(({ cell }) => {
    const pair = paired.find((p) => p.cell === cell);
    return pair ? [extremes(pair.set)] : [];
  });

  const byState = new Map<string, Agreement>();
  let matching = 0;
  for (const { cell, set } of paired) {
    const match = Math.min(...set.volts) === cell.min && Math.max(...set.volts) === cell.max;
    if (match) matching++;
    const state = (log.states ?? []).filter((s) => s.t <= set.t).at(-1)?.state ?? "no state mark";
    const entry = byState.get(state) ?? { matching: 0, of: 0 };
    byState.set(state, { matching: entry.matching + (match ? 1 : 0), of: entry.of + 1 });
  }
  return { cellMinMax, groups, agreement: { matching, of: paired.length, byState: [...byState].map(([state, a]) => ({ state, ...a })) } };
}
