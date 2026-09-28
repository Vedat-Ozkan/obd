import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importObdbMode22 } from "../../obd-core/src/vehicles/index.js";
import { batteryDiagnosisFromRecording, type BatteryDiagnosisReport } from "obd-battery/report";
import { summarize, type LlmClient } from "../src/index.js";

export type SavedSummaryCase = { name: string; response?: unknown; providerFailure?: boolean; report?: "synthetic-multi-dtc-no-recording" | "synthetic-negative-signal-no-recording" | "synthetic-zero-signal-no-recording" };

export function reportForSavedCase(report: BatteryDiagnosisReport, item: SavedSummaryCase): BatteryDiagnosisReport {
  if (item.report === "synthetic-negative-signal-no-recording" || item.report === "synthetic-zero-signal-no-recording") {
    // Lexical controls copied from a replayed signal, not hardware observations.
    return { ...report, signals: report.signals.map((signal) => signal.id === "EQUINOXEV_HVBAT_C_V_AVG"
      ? { ...signal, value: item.report === "synthetic-zero-signal-no-recording" ? 0 : -signal.value } : signal) };
  }
  if (item.report !== "synthetic-multi-dtc-no-recording") return report;
  return {
    ...report,
    codes: {
      ...report.codes,
      modules: report.codes.modules.map((module, index) => index === 0 ? { ...module, stored: { status: "read", dtcs: ["P0133", "P0420"] } } : module),
    },
  };
}

export async function createSummaryReplayArtifact(report: BatteryDiagnosisReport, saved: { cases: readonly SavedSummaryCase[] }): Promise<{ fixture: string; promptVersion: "t2.10-v1"; cases: { name: string; kind: string; text: string }[] }> {
  const cases = [];
  for (const item of saved.cases) {
    const caseReport = reportForSavedCase(report, item);
    const client: LlmClient = { generate: () => {
      if (item.providerFailure) return Promise.reject(new Error("saved provider failure"));
      return Promise.resolve(item.response);
    } };
    const result = await summarize(caseReport, client, { model: "saved-response", effort: "none" });
    cases.push({ name: item.name, kind: result.kind, text: result.text });
  }
  return { fixture: report.recording, promptVersion: "t2.10-v1", cases };
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 2) throw new Error("usage: replay-summary <recording.jsonl> <saved-responses.json>");
  const [recordingPath, responsePath] = args;
  const imported = importObdbMode22(JSON.parse(readFileSync("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", "utf8")));
  const report = await batteryDiagnosisFromRecording(readFileSync(recordingPath, "latin1"), {
    garageVehicleId: "summary-replay", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z", recording: recordingPath, scanStatus: "complete",
  }, imported);
  const saved = JSON.parse(readFileSync(responsePath, "utf8")) as { cases: readonly SavedSummaryCase[] };
  process.stdout.write(`${JSON.stringify(await createSummaryReplayArtifact(report, saved), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
