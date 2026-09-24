import { parseRecording } from "obd-core/recording";
import { codesReportFromRecording, renderCodesReport } from "obd-core/report";
import type { CaptureResult } from "./capture.js";

/** Fixed list; each entry is already normalized for normalizeReadOnlyCommand and passes obd-core allowedCommand. Sources: docs/specs/T0.9-codes-report-flow.md §Sources. */
export const CODES_SCAN_COMMANDS: readonly string[] = [
  "ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0",
  "0100", "0120", "0140", "0101",
  "0121", "0130", "0131", "014D", "014E",
  "03", "07", "0A", "020200",
];

/** CaptureOptions.stopAfter for the codes scan. */
export function codesScanStop(command: string, outcome: string): string | undefined {
  // The guard clears its unknown header state only on an ATZ answered as data; ATSP0 is refused until then (docs/ELM327.md §Write safety).
  if (command === "ATZ" && outcome !== "data") return `ATZ reset not confirmed (${outcome})`;
  // docs/ELM327.md §Responses: surface to user; with ATSP0 every later request would search again.
  if (outcome === "error: unable-to-connect") return "UNABLE TO CONNECT: no OBD protocol found; check the car is on (Ready) and the dongle is seated";
  return undefined;
}

export interface ReportHeading {
  /** "<year> <make> <model>" from the CatalogVehicle; never a VIN. */
  vehicle: string;
  /** "YYYY-MM-DD", phone local date. */
  date: string;
  result: CaptureResult;
}

/** Parses the frozen JSONL, replays it through obd-core codesReportFromRecording, and returns heading + renderCodesReport(report).
 *  undefined when no module sent a frame (nothing to report). */
export async function codesReportMarkdown(jsonl: string, heading: ReportHeading): Promise<string | undefined> {
  const report = await codesReportFromRecording(parseRecording(jsonl));
  if (report.modules.length === 0) return undefined;
  const { sent, total, stoppedEarly } = heading.result;
  const status = stoppedEarly === undefined
    ? `Scan complete: ${String(sent)} of ${String(total)} commands sent.`
    : `Scan stopped early after ${String(sent)} of ${String(total)} commands: ${stoppedEarly}. Anything not requested shows as "not read".`;
  return `# Codes report: ${heading.vehicle}\n\nScanned ${heading.date} with the phone app. ${status}\n\n${renderCodesReport(report)}`;
}
