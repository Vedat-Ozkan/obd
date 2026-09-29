import { renderBatteryDiagnosis, type BatteryDiagnosisReport } from "obd-battery/report";
import { reportRatings, ratingWord, type ReportArea } from "obd-battery/rating";
import { SUMMARY_AREAS, checkSummaryFacts, renderSummary, verdictWords } from "./check.js";

export interface SummaryFact {
  id: string;
  label: string;
  value: string;
  unit?: string;
  tier?: "verified" | "community";
  status?: string;
}
export interface SummaryRequest { version: 1; promptVersion: "t2.10-v3"; facts: readonly SummaryFact[] }
export interface SummaryClaim { text: string; factIds: readonly string[] }
export interface StructuredSummary { version: 1; claims: readonly SummaryClaim[] }
export type SummaryArea = ReportArea;
export interface AreaSummary { version: 2; takeaway: SummaryClaim; areas: readonly { area: SummaryArea; claims: readonly SummaryClaim[] }[] }
export interface LlmClient {
  generate(request: SummaryRequest, options: { model: string; effort: "none" | "low" }): Promise<unknown>;
}

export const summaryInstructions = `Summary prompt version: t2.10-v3. Explain this battery check to a used-EV buyer who has not used the app.
Write one takeaway sentence about the whole check. Then, for each area in order (soc: state of charge; cells: cell balance; capacity: battery capacity; twelveVolt: the twelve-volt battery; codes: diagnostic trouble codes), write two or three claims, each one sentence: what it is, why a used-EV buyer cares, and what this check shows or what would be needed to know more. Never put two sentences in one claim.
General knowledge may explain what an item is, why it matters and what to check next. Anything about this car must come from the supplied facts. Keep community and missing-data labels.
{label:ID} names an item and {fact:ID} is its value; write each {fact:ID} at most once in a claim.
The app prints each area's own rating and its basis above your sentences. Never judge this car yourself: claim text never contains these words, in any capitalization: ${verdictWords.join(", ")}. Never cite a fact whose ID ends in -rating or -rating-basis; the reason facts say what is missing.`;

const formatNumber = (value: number): string => String(Math.round(value * 10000) / 10000);
const fact = (id: string, label: string, value: string, extra: Omit<SummaryFact, "id" | "label" | "value"> = {}): SummaryFact => ({ id, label, value, ...extra });

function codeFacts(moduleId: string, kind: string, value: unknown): SummaryFact[] {
  if (typeof value !== "object" || value === null || !("status" in value)) return [fact(`codes-${moduleId}-${kind}`, `${kind} diagnostic codes`, "unavailable", { status: "unavailable" })];
  const state = value as { status: string; dtcs?: readonly string[] };
  if (state.status !== "read") return [fact(`codes-${moduleId}-${kind}`, `${kind} diagnostic codes`, state.status, { status: state.status })];
  if (!state.dtcs?.length) return [fact(`codes-${moduleId}-${kind}`, `${kind} diagnostic codes`, "none", { status: "available" })];
  return state.dtcs.map((dtc) => fact(`codes-${moduleId}-${kind}-${dtc}`, `${kind} diagnostic code`, dtc, { status: "available" }));
}

/** The report's own facts, without rating facts: what the assistant's tools may return. */
export function reportFacts(report: BatteryDiagnosisReport): SummaryFact[] {
  const facts: SummaryFact[] = report.signals.map((signal) => fact(`signal-${signal.id}`, signal.name, formatNumber(signal.value), { unit: signal.unit, tier: signal.tier, status: "available" }));
  if (report.cellSpread) facts.push(fact("cell-spread", "Cell spread", formatNumber(report.cellSpread.volts), { unit: "volts", tier: report.cellSpread.tier, status: "available" }));
  else facts.push(fact("cell-spread", "Cell spread", "unavailable", { status: "missing" }));
  report.twelveVolt.observations.forEach((observation, index) => {
    facts.push(fact(`twelve-volt-${String(index)}`, `${observation.source} 12 V supply`, formatNumber(observation.volts), { unit: "V", status: "available" }));
  });
  if (report.twelveVolt.observations.length === 0) facts.push(fact("twelve-volt", "12 V observations", "not read", { status: "missing" }));
  facts.push(
    fact("twelve-volt-status", "12 V battery status", report.twelveVolt.batteryHealth, { status: report.twelveVolt.batteryHealth }),
    fact("twelve-volt-reason", "12 V reason", report.twelveVolt.reason, { status: "available" }),
    fact("capacity-status", "Capacity status", report.capacity.status, { status: report.capacity.status }),
    fact("capacity-reason", "Capacity reason", report.capacity.reason, { status: "missing" }),
    fact("health-status", "Battery health status", report.health.status, { status: report.health.status }),
    fact("health-reason", "Battery health reason", report.health.reason, { status: "missing" }),
    fact("codes-recently-cleared", "Recently cleared codes status", report.codes.recentlyCleared.verdict, { status: report.codes.recentlyCleared.verdict }),
  );
  report.codes.modules.forEach((module, index) => {
    const moduleId = String(index);
    facts.push(
      ...codeFacts(moduleId, "stored", module.stored),
      ...codeFacts(moduleId, "pending", module.pending),
      ...codeFacts(moduleId, "permanent", module.permanent),
      fact(`readiness-${moduleId}`, "Readiness status", module.readiness.status, { status: module.readiness.status }),
    );
  });
  return facts;
}

/** Four roll-ups over the modules, so the codes area cites a few facts instead of one per module. Each value states how many modules were read, so "none" never hides a module that was not. */
function codeRollups(report: BatteryDiagnosisReport): SummaryFact[] {
  const modules = report.codes.modules;
  const rolled = (kind: "stored" | "pending" | "permanent", label: string) => {
    // A missing entry counts as not read, as in codeFacts.
    const reads = modules.flatMap((module) => { const read = module[kind] as BatteryDiagnosisReport["codes"]["modules"][number][typeof kind] | undefined; return read?.status === "read" ? [read.dtcs] : []; });
    const codes = [...new Set(reads.flat())];
    return fact(`codes-${kind}`, label, `${reads.length === 0 ? "not read" : codes.length ? codes.join(", ") : "none"} (${String(reads.length)} of ${String(modules.length)} modules read)`, { status: reads.length === 0 ? "not-read" : "available" });
  };
  const readiness = modules.filter((module) => (module.readiness as typeof module.readiness | undefined)?.status === "read").length;
  return [
    rolled("stored", "Stored diagnostic codes"), rolled("pending", "Pending diagnostic codes"), rolled("permanent", "Permanent diagnostic codes"),
    fact("readiness", "Readiness status", `${String(readiness)} of ${String(modules.length)} modules read`, { status: readiness === 0 ? "not-read" : "available" }),
  ];
}

/** Produce the only report projection that may be sent to a summary provider: the report's facts, then the app's rating for each area as context the model may not cite. */
export function prepareSummaryRequest(report: BatteryDiagnosisReport): SummaryRequest {
  const ratings = reportRatings(report);
  const ratingFacts = SUMMARY_AREAS.flatMap(({ area, title, prefix }) => [
    fact(`${prefix}-rating`, `${title} rating`, ratingWord[ratings[area].rating], { status: ratings[area].rating }),
    fact(`${prefix}-rating-basis`, `${title} rating basis`, ratings[area].basis, { status: "available" }),
  ]);
  return { version: 1, promptVersion: "t2.10-v3", facts: [...reportFacts(report).filter((item) => !/^(codes|readiness)-\d/.test(item.id)), ...codeRollups(report), ...ratingFacts] };
}

/** Rebuild the local allowlist so server-supplied facts cannot be trusted. */
export function checkSummary(report: BatteryDiagnosisReport, response: unknown): AreaSummary {
  return checkSummaryFacts(prepareSummaryRequest(report), response);
}

export async function summarize(report: BatteryDiagnosisReport, client: LlmClient, options: { model: string; effort: "none" | "low" }): Promise<{ kind: "llm"; text: string; summary: AreaSummary } | { kind: "template"; text: string; reason: string }> {
  try {
    const response = await client.generate(prepareSummaryRequest(report), options);
    // Rebuilt after the call, never the object handed to the client: the rendered numbers come only from this projection.
    const local = prepareSummaryRequest(report);
    const summary = checkSummaryFacts(local, response);
    return { kind: "llm", text: renderSummary(local.facts, summary), summary };
  } catch {
    return { kind: "template", text: renderBatteryDiagnosis(report), reason: "Summary response could not be verified." };
  }
}
