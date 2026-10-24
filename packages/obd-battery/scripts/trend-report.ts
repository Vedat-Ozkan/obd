import { readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecording } from "../../obd-core/src/recording/format.js";
import { importObdbMode22 } from "../../obd-core/src/vehicles/obdb/import.js";
import { summariseChargeLog, type ChargeSessionSummary } from "../src/chargeSummary.js";
import { parseBatteryDiagnosis, batteryDiagnosisFromRecording, type BatteryDiagnosisReport } from "../src/report.js";
import { chargeLogFromRecording } from "../src/session.js";
import { UNDATED_AT, type Rejected } from "../src/trend.js";
import { renderTrendReport } from "../src/trendReport.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function sessionDate(path: string, synthetic: boolean): string {
  const date = /\d{4}-\d{2}-\d{2}/.exec(basename(path))?.[0];
  if (date !== undefined) return `${date}T00:00:00.000Z`;
  if (synthetic) return UNDATED_AT;
  throw new Error(`no YYYY-MM-DD date in the file name: ${path}`);
}

export async function trendReportFromPaths(paths: readonly string[]): Promise<string> {
  const signals = importObdbMode22(JSON.parse(readFileSync(resolve(root, "packages/obd-core/vehicles/chevrolet-equinox-ev/default.json"), "utf8")));
  const reports: BatteryDiagnosisReport[] = [];
  const summaries: ChargeSessionSummary[] = [];
  const rejected: Rejected[] = [];
  for (const path of paths) {
    if (path.endsWith(".json")) {
      reports.push(parseBatteryDiagnosis(JSON.parse(readFileSync(resolve(root, path), "utf8"))));
      continue;
    }
    const underSynthetic = relative(resolve(root, "fixtures/synthetic"), resolve(root, path));
    if (!path.endsWith(".redacted.jsonl") && (underSynthetic.startsWith("..") || isAbsolute(underSynthetic))) {
      throw new Error(`expected a redacted or explicitly synthetic JSONL path: ${path}`);
    }
    const text = readFileSync(resolve(root, path), "latin1");
    const lines = parseRecording(text);
    const log = await chargeLogFromRecording(lines, path, signals);
    const at = sessionDate(path, log.synthetic);
    summaries.push(summariseChargeLog(log, path, at));
    if (lines.some((line) => line.dir === "meta" && "car" in line && line.car === "chevrolet-equinox-ev-2024")) {
      reports.push(await batteryDiagnosisFromRecording(text, { garageVehicleId: "trend-report", catalogId: "chevrolet-equinox-ev-2024", scannedAt: at, recording: path, scanStatus: "complete" }, signals));
    } else {
      rejected.push({ id: path, reason: "not an Equinox recording, so no battery report" });
    }
  }
  return renderTrendReport({ reports, summaries, rejected });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) {
    process.stderr.write("usage: trend-report <*.redacted.jsonl|fixtures/synthetic/*.jsonl|battery-report.json>...\n");
    process.exitCode = 1;
  } else {
    trendReportFromPaths(process.argv.slice(2)).then((output) => process.stdout.write(output)).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
