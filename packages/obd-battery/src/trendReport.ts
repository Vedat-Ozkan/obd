import type { BatteryDiagnosisReport } from "./report.js";
import type { ChargeSessionSummary } from "./chargeSummary.js";
import { SPREAD_SIGMA_MV, TREND_POLICY, UNDATED_AT, pointsFromReports, pointsFromSummaries, spreadSeries, spreadTrend, trendFlags, trendsByMethod, type Rejected, type SessionPoint, type TrendResult } from "./trend.js";

const LABEL = "BMS-referenced capacity index, not state of health";
const LIMITATION = "Limits come from one car; self-comparison can miss even pack-wide degradation or reflect a sensor offset.";
const ASSUMPTION = "Assumption: each point's uncertainty is sigma = band / 2, where band is the worst-case bound of the half-count terms. This is not a calibrated error; BM2 replaces it.";
const day = (at: string) => (at === UNDATED_AT ? "undated" : at.slice(0, 10));
const fixed = (value: number, digits = 2) => value.toFixed(digits);

function pointLine(p: SessionPoint, summaries: readonly ChargeSessionSummary[]): string {
  const synthetic = summaries.find((s) => s.id === p.id)?.synthetic === true ? ", synthetic" : "";
  return `- ${p.id} (${day(p.at)}${synthetic}): ${p.method} ${fixed(p.value)} ${p.unit} +- ${fixed(p.band)} ${p.unit}`;
}

function methodSection(result: TrendResult): string[] {
  const heading = `### ${result.method} (${result.method === "bms-kwh" ? "kWh" : "Ah"})`;
  if (result.status === "not-enough-data") return [heading, "", `Not enough data yet: ${String(result.n)} sessions over ${String(result.spanDays)} days (${result.reason}).`, ""];
  const { fit } = result;
  return [
    heading, "",
    `Trend: ${fixed(fit.fadePctPerYear)} % per year fade +- ${fixed(2 * fit.sePerYear * 100)} % (2 SE), ${String(fit.n)} sessions over ${String(fit.spanDays)} days, SE inflation ${fixed(fit.chi2Inflation)}. Reference value ${fixed(result.cRef)}.`,
    "", "| Date | Value | Index |", "|---|---|---|",
    ...result.points.map((p) => `| ${day(p.at)} | ${fixed(p.value)} ${p.unit} | ${fixed(p.index, 4)} |`), "",
  ];
}

function powerSection(summary: ChargeSessionSummary): string[] {
  return [
    `#### ${summary.id}${summary.synthetic ? " (synthetic)" : ""}`, "",
    ...(summary.powerBySoc.length === 0 ? ["No charge window with paired current and voltage."] : ["| SOC bin | Median power | Samples |", "|---|---|---|", ...summary.powerBySoc.map((b) => `| ${String(b.socBin)}-${String(b.socBin + TREND_POLICY.powerBinPct)} % | ${fixed(b.medianKw)} kW | ${String(b.n)} |`)]), "",
  ];
}

export function renderTrendReport(input: { reports: readonly BatteryDiagnosisReport[]; summaries: readonly ChargeSessionSummary[]; rejected: readonly Rejected[] }): string {
  const fromReports = pointsFromReports(input.reports);
  const fromSummaries = pointsFromSummaries(input.summaries);
  const points = [...fromReports.points, ...fromSummaries.points];
  const rejected = [...input.rejected, ...fromReports.rejected, ...fromSummaries.rejected];
  const trends = trendsByMethod(points);
  const flags = trendFlags(input.reports, input.summaries, trends);
  const spread = spreadSeries(input.reports);
  const spreadFit = spreadTrend(spread);
  const drives = input.summaries;
  return [
    "# Battery trend report", "",
    `All figures: ${LABEL}. ${LIMITATION}`, ASSUMPTION, "",
    "## Sessions used", "",
    ...(points.length === 0 ? ["None."] : points.map((p) => pointLine(p, input.summaries))), "",
    "## Rejected", "",
    ...(rejected.length === 0 ? ["None."] : rejected.map((r) => `- ${r.id}: ${r.reason}`)), "",
    "## Capacity index", "", ...trends.flatMap(methodSection),
    "## Cell-group spread", "",
    spread.length === 0 ? `No complete parked check with 80 group voltages in the ${String(TREND_POLICY.socBin.minPct)}-${String(TREND_POLICY.socBin.maxPct)} % SOC bin.` : spread.map((s) => `${day(s.at)}: ${fixed(s.mv, 1)} mV`).join("; "),
    "",
    spreadFit.fit === undefined
      ? `Not enough data yet: ${String(spreadFit.n)} sessions over ${String(spreadFit.spanDays)} days (spread sigma ${String(SPREAD_SIGMA_MV)} mV from the group voltage tick).`
      : `Spread trend: ${fixed(spreadFit.fit.slopeMvPerYear)} mV per year +- ${fixed(2 * spreadFit.fit.seMvPerYear)} mV (2 SE).`,
    "", "## Flags", "",
    ...(flags.length === 0 ? ["None."] : flags.map((f) => `- ${f.kind} (${day(f.at)}): ${f.detail}`)), "",
    "## Drive groups", "",
    ...(drives.length === 0 ? ["No drive sessions."] : drives.map((d) => `- ${d.id}: ${d.groupsUnderLoad === undefined ? "not checked" : d.groupsUnderLoad.flagged.length === 0 ? "none flagged" : `flagged ${d.groupsUnderLoad.flagged.map((g) => `group ${String(g + 1)}`).join(", ")}`}`)), "",
    "## Charge power by SOC", "",
    ...(input.summaries.length === 0 ? ["No charge sessions."] : input.summaries.flatMap(powerSection)),
  ].join("\n") + "\n";
}
