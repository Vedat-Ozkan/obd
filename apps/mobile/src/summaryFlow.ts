import { summarize } from "obd-assist";
import { renderBatteryDiagnosis, type BatteryDiagnosisReport } from "obd-battery/report";
import { SUMMARY_CONSENT_VERSION, SUMMARY_MODEL, SummaryAccessError, type DevelopmentBudget, type DevelopmentUsage, type ServerFailedCheck, type SummaryAccess } from "./summaryAccess.js";

export interface DevelopmentSummaryEvidence {
  version: 1; consentVersion: typeof SUMMARY_CONSENT_VERSION; requestId: string;
  requestedModel: typeof SUMMARY_MODEL; returnedModel: DevelopmentUsage["model"] | null;
  configuredProvider: "DeepSeek"; observedProvider: null; routingEvidence: "configured-pin-only";
  usage: DevelopmentUsage | null; phoneLatencyMs: number | null; budget: DevelopmentBudget | null; displayCategory: "llm" | "template";
  // Which server check rejected the reply, when the Worker said so; never reply text. The phone's own local check is not recorded here.
  failedCheck: ServerFailedCheck | null;
}
export interface SummaryView { kind: "llm" | "template"; text: string; template: string; reason: string; evidence: DevelopmentSummaryEvidence | null }

export function createDevelopmentSummaryFlow(options: { access: SummaryAccess; nextRequestId: () => string; now?: () => number }) {
  let accepted = false;
  let epoch = 0;
  let active = false;
  let currentReport: BatteryDiagnosisReport | undefined;
  const now = options.now ?? Date.now;
  const current = (attemptEpoch: number, report: BatteryDiagnosisReport) => epoch === attemptEpoch && accepted && currentReport === report;
  const withdraw = () => { accepted = false; epoch++; options.access.clear(); };
  return {
    consent(value: boolean): void { if (value) accepted = true; else withdraw(); },
    withdraw,
    async summaryFor(report: BatteryDiagnosisReport): Promise<SummaryView> {
      const template = renderBatteryDiagnosis(report);
      const fallback = (reason: string): SummaryView => ({ kind: "template", text: template, template, reason, evidence: null });
      if (currentReport && currentReport !== report) withdraw();
      currentReport = report;
      if (!accepted) return fallback("Consent is required.");
      if (active) return fallback("A summary request is already active.");
      active = true;
      const attemptEpoch = epoch;
      let reason = "Summary response could not be verified.";
      const measurements: { usage: DevelopmentUsage | null; failedCheck: ServerFailedCheck | null; phoneLatencyMs: number | null; unavailable: boolean } = { usage: null, failedCheck: null, phoneLatencyMs: null, unavailable: false };
      try {
        const requestId = options.nextRequestId();
        // C1 requestSchema UUID spelling, independent of any server identifier.
        if (requestId.length !== 36 || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(requestId)) return fallback(reason);
        const result = await summarize(report, {
          async generate(request) {
            const started = now();
            try {
              const response = await options.access.generate(request, requestId);
              measurements.usage = response.usage;
              measurements.failedCheck = response.failedCheck;
              if (response.kind !== "llm") throw new Error("Summary response could not be verified.");
              return response.summary;
            } catch (error) {
              if (error instanceof SummaryAccessError) { measurements.unavailable = true; reason = "Summary service is unavailable."; }
              throw error;
            } finally {
              const elapsed = now() - started;
              measurements.phoneLatencyMs = Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : null;
            }
          },
        }, { model: SUMMARY_MODEL, effort: "none" });
        if (!current(attemptEpoch, report)) return fallback("Summary request was discarded.");
        if (measurements.unavailable) return fallback(reason);
        const budget = await options.access.status();
        if (!current(attemptEpoch, report)) return fallback("Summary request was discarded.");
        const view: SummaryView = result.kind === "llm" ? { kind: "llm", text: result.text, template, reason: "", evidence: null } : fallback(reason);
        const evidence: DevelopmentSummaryEvidence = { version: 1, consentVersion: SUMMARY_CONSENT_VERSION, requestId, requestedModel: SUMMARY_MODEL, returnedModel: measurements.usage?.model ?? null, configuredProvider: "DeepSeek", observedProvider: null, routingEvidence: "configured-pin-only", usage: measurements.usage, phoneLatencyMs: measurements.phoneLatencyMs, budget, displayCategory: view.kind, failedCheck: measurements.failedCheck };
        // Fixed unknown measurements on overflow; never truncate a server object.
        if (new TextEncoder().encode(JSON.stringify(evidence)).byteLength > 4096) { evidence.usage = null; evidence.returnedModel = null; evidence.phoneLatencyMs = null; evidence.budget = null; }
        view.evidence = evidence;
        return view;
      } catch { return fallback("Summary response could not be verified."); }
      finally { active = false; }
    },
  };
}
