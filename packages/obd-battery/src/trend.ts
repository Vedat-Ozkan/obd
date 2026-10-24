import type { CodesReport } from "obd-core/report";
import { bmsFigure } from "./capacity.js";
import type { ChargeSessionSummary } from "./chargeSummary.js";
import type { BatteryDiagnosisReport } from "./report.js";

export type Method = "bms-kwh" | "integrated-ah";
export interface SessionPoint { id: string; at: string; method: Method; value: number; band: number; unit: "kWh" | "Ah"; socBin?: string }
export interface Rejected { id: string; reason: string }
export interface Fit { n: number; spanDays: number; slopePerYear: number; sePerYear: number; fadePctPerYear: number; chi2Inflation: number; significant: boolean }
export interface TrendFlag { kind: "capacity-outlier" | "spread-step" | "weak-group" | "twelve-volt-low" | "new-code" | "drive-group"; at: string; detail: string }
export type TrendResult =
  | { status: "trend"; method: Method; cRef: number; points: readonly (SessionPoint & { index: number })[]; fit: Fit; flags: readonly TrendFlag[] }
  | { status: "not-enough-data"; method: Method; n: number; spanDays: number; reason: string };

export const TREND_POLICY = {
  minSessions: 5, minSpanDays: 90, sigmaMultiple: 2, socBin: { minPct: 40, maxPct: 80 }, cRefSessions: 3,
  weakGroupZ: -3, weakGroupWindow: 5, weakGroupHits: 3, spreadStepMv: 3, outlierSigma: 3, twelveVoltDropV: 0.3,
  driveGroupMinDrives: 2, powerBinPct: 5,
} as const;

export const SPREAD_SIGMA_MV = 0.1;

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;
const methods: readonly Method[] = ["bms-kwh", "integrated-ah"];

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] ?? NaN : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
};
const time = (at: string) => Date.parse(at);
const byTime = <T extends { at: string }>(items: readonly T[]): T[] => [...items].sort((a, b) => time(a.at) - time(b.at));
const reportsByTime = (reports: readonly BatteryDiagnosisReport[]) => [...reports].sort((a, b) => time(a.scannedAt) - time(b.scannedAt));
const inBin = (socPercent: number) => socPercent >= TREND_POLICY.socBin.minPct && socPercent <= TREND_POLICY.socBin.maxPct;

export function pointsFromReports(reports: readonly BatteryDiagnosisReport[]): { points: SessionPoint[]; rejected: Rejected[] } {
  const points: SessionPoint[] = [];
  const rejected: Rejected[] = [];
  for (const report of reports) {
    const id = report.recording;
    const figure = report.parked?.bmsFigure;
    if (report.scanStatus !== "complete") { rejected.push({ id, reason: "scan was partial" }); continue; }
    if (figure === undefined) { rejected.push({ id, reason: "no BMS figure in this report" }); continue; }
    if (!inBin(figure.socPercent)) { rejected.push({ id, reason: `SOC ${figure.socPercent.toFixed(1)} % is outside the ${String(TREND_POLICY.socBin.minPct)}-${String(TREND_POLICY.socBin.maxPct)} % bin` }); continue; }
    if (Number.isNaN(time(report.scannedAt))) { rejected.push({ id, reason: "scan date is not valid" }); continue; }
    const estimate = bmsFigure({ t: 0, value: figure.energyKwh }, { t: 0, value: figure.socPercent });
    if (estimate.status !== "estimated" || !(estimate.band > 0)) { rejected.push({ id, reason: "no usable band" }); continue; }
    points.push({ id, at: report.scannedAt, method: "bms-kwh", value: figure.valueKwh, band: estimate.band, unit: "kWh", socBin: `${String(TREND_POLICY.socBin.minPct)}-${String(TREND_POLICY.socBin.maxPct)}` });
  }
  return { points, rejected };
}

export function pointsFromSummaries(summaries: readonly ChargeSessionSummary[]): { points: SessionPoint[]; rejected: Rejected[] } {
  const points: SessionPoint[] = [];
  const rejected: Rejected[] = [];
  for (const s of summaries) {
    if (s.gateFailures.length > 0) rejected.push({ id: s.id, reason: `charge log gate failed: ${s.gateFailures.join("; ")}` });
    else if (s.capacity === undefined || !(s.capacity.bandAh > 0) || !(s.capacity.ah > 0)) rejected.push({ id: s.id, reason: "no capacity estimate" });
    else if (Number.isNaN(time(s.at))) rejected.push({ id: s.id, reason: "session date is not valid" });
    else points.push({ id: s.id, at: s.at, method: "integrated-ah", value: s.capacity.ah, band: s.capacity.bandAh, unit: "Ah" });
  }
  return { points, rejected };
}

export interface Wls { n: number; slope: number; se: number; inflation: number; mean: number; tMean: number; weightSum: number; sxx: number }
export function wls(samples: readonly { t: number; y: number; sigma: number }[]): Wls {
  const w = samples.map((s) => 1 / s.sigma ** 2);
  const weightSum = w.reduce((a, b) => a + b, 0);
  const tMean = samples.reduce((a, s, i) => a + (w[i] ?? 0) * s.t, 0) / weightSum;
  const mean = samples.reduce((a, s, i) => a + (w[i] ?? 0) * s.y, 0) / weightSum;
  const sxx = samples.reduce((a, s, i) => a + (w[i] ?? 0) * (s.t - tMean) ** 2, 0);
  const slope = samples.reduce((a, s, i) => a + (w[i] ?? 0) * (s.t - tMean) * (s.y - mean), 0) / sxx;
  const chi2 = samples.reduce((a, s, i) => a + (w[i] ?? 0) * (s.y - mean - slope * (s.t - tMean)) ** 2, 0);
  const n = samples.length;
  const inflation = Math.max(1, Math.sqrt(chi2 / (n - 2)));
  return { n, slope, se: Math.sqrt(1 / sxx) * inflation, inflation, mean, tMean, weightSum, sxx };
}

const years = (from: string, to: string) => (time(to) - time(from)) / (DAY_MS * YEAR_DAYS);
const spanDaysOf = (ordered: readonly { at: string }[]) => ordered.length === 0 ? 0 : Math.round((time(ordered[ordered.length - 1]?.at ?? "") - time(ordered[0]?.at ?? "")) / DAY_MS);

function notEnough(method: Method, ordered: readonly { at: string }[], reason: string): TrendResult {
  return { status: "not-enough-data", method, n: ordered.length, spanDays: spanDaysOf(ordered), reason };
}

function scaled(ordered: readonly SessionPoint[], cRef: number) {
  const first = ordered[0]?.at ?? "";
  return ordered.map((p) => ({ t: years(first, p.at), y: p.value / cRef, sigma: p.band / 2 / cRef }));
}

export function weightedTrend(points: readonly SessionPoint[]): TrendResult {
  const method = points[0]?.method ?? "bms-kwh";
  if (points.some((p) => p.method !== method)) throw new Error("weightedTrend: one method per fit; use trendsByMethod");
  const ordered = byTime(points);
  if (ordered.length < TREND_POLICY.cRefSessions) return notEnough(method, ordered, `fewer than ${String(TREND_POLICY.cRefSessions)} sessions for the reference value`);
  if (ordered.length < TREND_POLICY.minSessions) return notEnough(method, ordered, `fewer than ${String(TREND_POLICY.minSessions)} sessions`);
  const spanDays = spanDaysOf(ordered);
  if (spanDays < TREND_POLICY.minSpanDays) return notEnough(method, ordered, `span under ${String(TREND_POLICY.minSpanDays)} days`);
  const cRef = median(ordered.slice(0, TREND_POLICY.cRefSessions).map((p) => p.value));
  const fit = wls(scaled(ordered, cRef));
  const significant = Math.abs(fit.slope) > TREND_POLICY.sigmaMultiple * fit.se;
  if (!significant) return notEnough(method, ordered, `slope not above ${String(TREND_POLICY.sigmaMultiple)} standard errors`);
  return {
    status: "trend", method, cRef,
    points: ordered.map((p) => ({ ...p, index: p.value / cRef })),
    fit: { n: fit.n, spanDays, slopePerYear: fit.slope, sePerYear: fit.se, fadePctPerYear: -100 * fit.slope, chi2Inflation: fit.inflation, significant },
    flags: [],
  };
}

export function trendsByMethod(points: readonly SessionPoint[]): TrendResult[] {
  return methods.map((method) => {
    const own = points.filter((p) => p.method === method);
    return own.length === 0 ? notEnough(method, [], "no sessions") : weightedTrend(own);
  });
}

export function groupZ(volts: readonly number[]): readonly (number | undefined)[] {
  const centre = median(volts);
  const mad = median(volts.map((v) => Math.abs(v - centre)));
  if (!(mad > 0) || !Number.isFinite(mad)) return volts.map(() => undefined);
  return volts.map((v) => (v - centre) / (1.4826 * mad));
}

interface Check { at: string; volts: readonly number[]; modules: readonly number[] }
const comparableChecks = (reports: readonly BatteryDiagnosisReport[]): Check[] =>
  reportsByTime(reports).flatMap((r) => {
    const groups = r.parked?.groupVoltages;
    const soc = r.parked?.bmsFigure?.socPercent;
    return r.scanStatus === "complete" && groups !== undefined && soc !== undefined && inBin(soc) ? [{ at: r.scannedAt, volts: groups.volts, modules: groups.modules }] : [];
  });

const spreadMv = (volts: readonly number[]) => Math.round((Math.max(...volts) - Math.min(...volts)) * 10000) / 10;

function outlierFlag(result: TrendResult): TrendFlag[] {
  if (result.status !== "trend") return [];
  const prior = result.points.slice(0, -1);
  const newest = result.points.at(-1);
  const first = prior.at(0);
  if (newest === undefined || first === undefined || prior.length < TREND_POLICY.cRefSessions) return [];
  const fit = wls(prior.map((p) => ({ t: years(first.at, p.at), y: p.index, sigma: p.band / 2 / result.cRef })));
  const t = years(first.at, newest.at);
  const predicted = fit.mean + fit.slope * (t - fit.tMean);
  const predictionVar = fit.inflation ** 2 * (1 / fit.weightSum + (t - fit.tMean) ** 2 / fit.sxx);
  const sigma = newest.band / 2 / result.cRef;
  const limit = TREND_POLICY.outlierSigma * Math.sqrt(sigma ** 2 + predictionVar);
  return Math.abs(newest.index - predicted) > limit
    ? [{ kind: "capacity-outlier", at: newest.at, detail: `${newest.id}: index ${newest.index.toFixed(4)} is outside ${predicted.toFixed(4)} +- ${limit.toFixed(4)} (${result.method})` }]
    : [];
}

function groupFlags(checks: readonly Check[]): TrendFlag[] {
  const flags: TrendFlag[] = [];
  checks.forEach((check, i) => {
    const previous = i === 0 ? undefined : checks.at(i - 1);
    if (previous === undefined) return;
    const step = spreadMv(check.volts) - spreadMv(previous.volts);
    if (Math.abs(step) > TREND_POLICY.spreadStepMv) flags.push({ kind: "spread-step", at: check.at, detail: `80-group spread moved ${step.toFixed(1)} mV between consecutive checks (${spreadMv(previous.volts).toFixed(1)} to ${spreadMv(check.volts).toFixed(1)} mV)` });
  });
  const recent = checks.slice(-TREND_POLICY.weakGroupWindow);
  const last = recent.at(-1);
  if (recent.length < TREND_POLICY.weakGroupWindow || last === undefined) return flags;
  const zs = recent.map((c) => groupZ(c.volts));
  last.volts.forEach((_, g) => {
    const hits = zs.filter((z) => (z[g] ?? 0) < TREND_POLICY.weakGroupZ).length;
    if (hits >= TREND_POLICY.weakGroupHits) flags.push({ kind: "weak-group", at: last.at, detail: `group ${String(g + 1)} (module ${String(last.modules[g])}): z below ${String(TREND_POLICY.weakGroupZ)} in ${String(hits)} of the last ${String(TREND_POLICY.weakGroupWindow)} checks` });
  });
  return flags;
}

function twelveVoltFlags(reports: readonly BatteryDiagnosisReport[]): TrendFlag[] {
  const series = reportsByTime(reports).flatMap((r) => {
    const rest = r.twelveVolt.observations.filter((o) => o.powerState !== "ready").map((o) => o.volts);
    return rest.length === 0 ? [] : [{ at: r.scannedAt, volts: median(rest) }];
  });
  if (series.length < TREND_POLICY.minSessions) return [];
  const centre = median(series.map((s) => s.volts));
  const low = (s: { volts: number } | undefined) => s !== undefined && s.volts < centre - TREND_POLICY.twelveVoltDropV;
  return series.flatMap((s, i) => low(s) && i > 0 && low(series.at(i - 1)) ? [{ kind: "twelve-volt-low" as const, at: s.at, detail: `resting 12 V ${s.volts.toFixed(2)} V is more than ${String(TREND_POLICY.twelveVoltDropV)} V below its median ${centre.toFixed(2)} V in two consecutive checks` }] : []);
}

function codeKeys(modules: CodesReport["modules"]): { read: Set<string>; codes: Set<string> } {
  const read = new Set<string>();
  const codes = new Set<string>();
  for (const m of modules) for (const mode of ["stored", "pending", "permanent"] as const) {
    const result = m[mode];
    if (result.status !== "read") continue;
    read.add(`${m.ecu}/${mode}`);
    for (const dtc of result.dtcs) codes.add(`${m.ecu}/${mode}/${dtc}`);
  }
  return { read, codes };
}

function newCodeFlags(reports: readonly BatteryDiagnosisReport[]): TrendFlag[] {
  const ordered = reportsByTime(reports);
  return ordered.flatMap((report, i) => {
    const previous = i === 0 ? undefined : ordered.at(i - 1);
    if (previous === undefined) return [];
    const before = codeKeys(previous.codes.modules);
    const now = codeKeys(report.codes.modules);
    return [...now.codes].filter((key) => !before.codes.has(key) && before.read.has(key.split("/").slice(0, 2).join("/")))
      .map((key) => ({ kind: "new-code" as const, at: report.scannedAt, detail: `${key.split("/")[2] ?? key} appeared in ${key.split("/")[0] ?? ""} ${key.split("/")[1] ?? ""} codes; it was not in the previous check` }));
  });
}

function driveGroupFlags(summaries: readonly ChargeSessionSummary[]): TrendFlag[] {
  const drives = byTime(summaries.filter((s) => s.groupsUnderLoad !== undefined));
  const counts = new Map<number, number>();
  for (const d of drives) for (const g of d.groupsUnderLoad?.flagged ?? []) counts.set(g, (counts.get(g) ?? 0) + 1);
  const latest = drives.at(-1);
  return latest === undefined ? [] : [...counts].filter(([, n]) => n >= TREND_POLICY.driveGroupMinDrives)
    .map(([g, n]) => ({ kind: "drive-group" as const, at: latest.at, detail: `group ${String(g + 1)} was flagged under load in ${String(n)} drives` }));
}

export function spreadSeries(reports: readonly BatteryDiagnosisReport[]): { at: string; mv: number }[] {
  return comparableChecks(reports).map((c) => ({ at: c.at, mv: spreadMv(c.volts) }));
}

export function spreadTrend(series: readonly { at: string; mv: number }[]): { n: number; spanDays: number; fit?: { slopeMvPerYear: number; seMvPerYear: number } } {
  const n = series.length;
  const spanDays = spanDaysOf(series);
  if (n < TREND_POLICY.minSessions || spanDays < TREND_POLICY.minSpanDays) return { n, spanDays };
  const first = series[0]?.at ?? "";
  const fit = wls(series.map((s) => ({ t: years(first, s.at), y: s.mv, sigma: SPREAD_SIGMA_MV })));
  return Math.abs(fit.slope) > TREND_POLICY.sigmaMultiple * fit.se ? { n, spanDays, fit: { slopeMvPerYear: fit.slope, seMvPerYear: fit.se } } : { n, spanDays };
}

export function trendFlags(reports: readonly BatteryDiagnosisReport[], summaries: readonly ChargeSessionSummary[], capacity: TrendResult[]): TrendFlag[] {
  return [
    ...capacity.flatMap(outlierFlag),
    ...groupFlags(comparableChecks(reports)),
    ...twelveVoltFlags(reports),
    ...newCodeFlags(reports),
    ...driveGroupFlags(summaries),
  ];
}
