import { describe, expect, it } from "vitest";
import { TOKENS } from "../src/ui/tokens.js";

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const schemes = ["light", "dark"] as const;

describe("theme token contrast", () => {
  it("computes 21 for black on white", () => {
    expect(ratio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });

  it("covers exactly the light and dark schemes", () => {
    expect(Object.keys(TOKENS)).toEqual(["light", "dark"]);
  });

  it("meets the audit thresholds in both schemes", () => {
    const rows: { scheme: string; pair: string; ratio: number; min: number }[] = [];
    for (const scheme of schemes) {
      const t = TOKENS[scheme];
      const worst = (pairs: [string, string][]) => Math.min(...pairs.map(([fg, bg]) => ratio(fg, bg)));
      const chartPairs: [string, string][] = [[t.chart.data, t.bg]];
      if (t.chart.highlight) chartPairs.push([t.chart.highlight, t.bg]);
      const checks: [string, number, number][] = [
        ["text / bg", ratio(t.text, t.bg), 4.5],
        ["muted / bg", ratio(t.muted, t.bg), 4.5],
        ["onAccent / accent", ratio(t.onAccent, t.accent), 4.5],
        ["onContainer / container", ratio(t.onContainer, t.container), 4.5],
        ["containerMuted / container", ratio(t.containerMuted, t.container), 4.5],
        ["error / bg", ratio(t.error, t.bg), 4.5],
        ["chip icon / chip bg (worst)", worst(Object.values(t.rating).map((r): [string, string] => [r.fg, r.bg])), 3],
        ["chart data / bg (worst)", worst(chartPairs), 3],
        ["outline / surface", ratio(t.outline, t.surface), 3],
        ["outline / bg", ratio(t.outline, t.bg), 3],
      ];
      for (const [pair, value, min] of checks) rows.push({ scheme, pair, ratio: Math.round(value * 100) / 100, min });
    }
    console.table(rows);
    expect(rows.filter((row) => row.ratio < row.min)).toEqual([]);
  });
});
