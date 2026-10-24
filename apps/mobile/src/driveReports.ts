import type { ObdbMode22Signal } from "obd-core/vehicles";
import { driveReportFromRecording, parseDriveReport, renderDriveReport, type DriveReport } from "../../../packages/obd-battery/src/driveReport.js";
import type { BatteryDiagnosisReport } from "../../../packages/obd-battery/src/report.js";
import type { ReportTextStore } from "./batteryReports.js";
import type { DriveCaptureResult } from "./driveCapture.js";

function parseHistory(raw: string): DriveReport[] {
  let data: unknown;
  try { data = JSON.parse(raw) as unknown; } catch { throw new Error("Drive report history is malformed; saved file unchanged."); }
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("version" in data) || data.version !== 1 || !("reports" in data) || !Array.isArray(data.reports)) throw new Error("Drive report history has an unsupported format; saved file unchanged.");
  return data.reports.map(parseDriveReport);
}

export function createDriveReportHistory(store: ReportTextStore) {
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<DriveReport[]> => {
    const raw = await store.read();
    return raw === undefined ? [] : parseHistory(raw);
  };
  const list = async (garageVehicleId: string): Promise<readonly DriveReport[]> => (await read()).filter((r) => r.garageVehicleId === garageVehicleId);
  const save = (report: DriveReport): Promise<void> => {
    const task = queue.then(async () => {
      const reports = [parseDriveReport(report), ...(await read())];
      reports.sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));
      await store.write(JSON.stringify({ version: 1, reports }));
    });
    queue = task.catch(() => undefined);
    return task;
  };
  return { list, save };
}

export function preDriveReport(reports: readonly BatteryDiagnosisReport[], driveStart: Date): BatteryDiagnosisReport | undefined {
  const sameDay = (at: Date) => at.toDateString() === driveStart.toDateString();
  return reports
    .filter((r) => Date.parse(r.scannedAt) < driveStart.valueOf() && sameDay(new Date(r.scannedAt)))
    .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt))[0];
}

export async function saveDriveReport(input: {
  entryId: string; drive: DriveCaptureResult; minutes: 10 | 20; driveStart: Date;
  readRecording: (file: string) => Promise<string>;
  parkedHistory: { list(entryId: string): Promise<readonly BatteryDiagnosisReport[]> };
  driveHistory: { save(report: DriveReport): Promise<void> };
  signals: readonly ObdbMode22Signal[]; now: () => Date;
}): Promise<{ status: "saved"; report: DriveReport; text: string } | { status: "not-made"; reason: string }> {
  if (input.drive.file === "") return { status: "not-made", reason: input.drive.stopReason };
  try {
    const jsonl = await input.readRecording(input.drive.file);
    const parked = preDriveReport(await input.parkedHistory.list(input.entryId), input.driveStart);
    const report = await driveReportFromRecording(jsonl, { garageVehicleId: input.entryId, scannedAt: input.now().toISOString(), recording: input.drive.file, minutes: input.minutes, stopReason: input.drive.stopReason, signals: input.signals }, parked);
    await input.driveHistory.save(report);
    return { status: "saved", report, text: renderDriveReport(report) };
  } catch (error) { return { status: "not-made", reason: error instanceof Error ? error.message : String(error) }; }
}
