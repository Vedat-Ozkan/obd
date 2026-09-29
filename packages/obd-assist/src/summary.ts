import { renderBatteryDiagnosis, type BatteryDiagnosisReport } from "obd-battery/report";
import { checkSummaryFacts, renderClaims } from "./check.js";

export interface SummaryFact {
  id: string;
  label: string;
  value: string;
  unit?: string;
  tier?: "verified" | "community";
  status?: string;
}
export interface SummaryRequest { version: 1; promptVersion: "t2.10-v1"; facts: readonly SummaryFact[] }
export interface SummaryClaim { text: string; factIds: readonly string[] }
export interface StructuredSummary { version: 1; claims: readonly SummaryClaim[] }
export interface LlmClient {
  generate(request: SummaryRequest, options: { model: string; effort: "none" | "low" }): Promise<unknown>;
}

export const summaryInstructions = "Explain only supplied facts. Keep community and missing-data labels, avoid health verdicts, and return the requested schema.";

const formatNumber = (value: number): string => String(Math.round(value * 10000) / 10000);
const fact = (id: string, label: string, value: string, extra: Omit<SummaryFact, "id" | "label" | "value"> = {}): SummaryFact => ({ id, label, value, ...extra });

function codeFacts(moduleId: string, kind: string, value: unknown): SummaryFact[] {
  if (typeof value !== "object" || value === null || !("status" in value)) return [fact(`codes-${moduleId}-${kind}`, `${kind} diagnostic codes`, "unavailable", { status: "unavailable" })];
  const state = value as { status: string; dtcs?: readonly string[] };
  if (state.status !== "read") return [fact(`codes-${moduleId}-${kind}`, `${kind} diagnostic codes`, state.status, { status: state.status })];
  if (!state.dtcs?.length) return [fact(`codes-${moduleId}-${kind}`, `${kind} diagnostic codes`, "none", { status: "available" })];
  return state.dtcs.map((dtc) => fact(`codes-${moduleId}-${kind}-${dtc}`, `${kind} diagnostic code`, dtc, { status: "available" }));
}

/** Produce the only report projection that may be sent to a summary provider. */
export function prepareSummaryRequest(report: BatteryDiagnosisReport): SummaryRequest {
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
  return { version: 1, promptVersion: "t2.10-v1", facts };
}

/** Rebuild the local allowlist so server-supplied facts cannot be trusted. */
export function checkSummary(report: BatteryDiagnosisReport, response: unknown): StructuredSummary {
  return checkSummaryFacts(prepareSummaryRequest(report), response);
}

export async function summarize(report: BatteryDiagnosisReport, client: LlmClient, options: { model: string; effort: "none" | "low" }): Promise<{ kind: "llm"; text: string; summary: StructuredSummary } | { kind: "template"; text: string; reason: string }> {
  try {
    const response = await client.generate(prepareSummaryRequest(report), options);
    // Rebuilt after the call, never the object handed to the client: the rendered numbers come only from this projection.
    const local = prepareSummaryRequest(report);
    const summary = checkSummaryFacts(local, response);
    return { kind: "llm", text: renderClaims(local.facts, summary), summary };
  } catch {
    return { kind: "template", text: renderBatteryDiagnosis(report), reason: "Summary response could not be verified." };
  }
}
