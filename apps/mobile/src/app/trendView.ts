import type { BatteryDiagnosisReport } from "obd-battery/report";
import type { ChargeSessionSummary } from "obd-battery/chargeSummary";
import { pointsFromReports, pointsFromSummaries, spreadSeries, spreadTrend, trendsByMethod, type TrendResult } from "obd-battery/trend";

const LABEL = "BMS-referenced capacity index";
const signed = (value: number, digits: number) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(digits)}`;

function capacityCaption(result: TrendResult): string | undefined {
  const unit = result.method === "bms-kwh" ? "kWh" : "Ah";
  const head = `${LABEL} (${unit}), not state of health:`;
  if (result.status === "not-enough-data") {
    return result.n === 0 ? undefined : `${head} Not enough data yet: ${String(result.n)} sessions over ${String(result.spanDays)} days.`;
  }
  const latest = result.points.at(-1);
  const { fit } = result;
  return `${head} ${latest?.index.toFixed(2) ?? "n/a"}, change ${signed(fit.slopePerYear * 100, 1)} %/yr ± ${(2 * fit.sePerYear * 100).toFixed(1)} (2 standard errors) over ${String(fit.n)} sessions; significant.`;
}

export function trendCaptions(reports: readonly BatteryDiagnosisReport[], summaries: readonly ChargeSessionSummary[]): string[] {
  const fromReports = pointsFromReports(reports);
  const fromSummaries = pointsFromSummaries(summaries);
  const capacity = trendsByMethod([...fromReports.points, ...fromSummaries.points]).map(capacityCaption);
  const spread = spreadTrend(spreadSeries(reports));
  const spreadCaption = spread.n === 0 ? undefined : spread.fit === undefined
    ? `Cell-group spread: Not enough data yet: ${String(spread.n)} sessions over ${String(spread.spanDays)} days.`
    : `Cell-group spread: change ${signed(spread.fit.slopeMvPerYear, 1)} mV/yr ± ${(2 * spread.fit.seMvPerYear).toFixed(1)} (2 standard errors) over ${String(spread.n)} sessions; significant.`;
  return [...capacity, spreadCaption].filter((c): c is string => c !== undefined);
}
