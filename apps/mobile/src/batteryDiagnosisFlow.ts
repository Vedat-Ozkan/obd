import type { Transport } from "obd-core/transport";
import type { ObdbMode22Signal } from "obd-core/vehicles";
import { batteryDiagnosisFromRecording, type BatteryDiagnosisReport } from "obd-battery/report";
import { createBatteryReportHistory } from "./batteryReports.js";
import { hasEquinoxSocFingerprint, runBatteryDiagnosisScan } from "./batteryScan.js";
import { SUPPORTED_VEHICLES, canUseEquinoxConsole } from "./garage/catalog.js";
import type { GarageVehicle } from "./garage/flow.js";
import type { RecordingBuffer } from "./recording.js";

/** A frozen private scan is the only source used to build the persisted diagnosis. */
export async function runAndSaveBatteryDiagnosis(input: {
  entry: GarageVehicle;
  transport: Transport;
  recording: RecordingBuffer;
  scannedAt: string;
  keepScan: (garageId: string, at: string, jsonl: string) => string | Promise<string>;
  history: ReturnType<typeof createBatteryReportHistory>;
  importedSignals: readonly ObdbMode22Signal[];
  getInterruption: () => "cancelled" | "disconnected" | undefined;
  onProgress: (message: string) => void;
}): Promise<
  | { status: "saved"; report: BatteryDiagnosisReport; recording: string }
  | { status: "no-fingerprint"; recording: string; scanStatus: "complete" | "partial"; reason: string }
  | { status: "stopped"; cause: "cancelled" | "disconnected"; recording: string; reason: string }
> {
  const catalog = SUPPORTED_VEHICLES.find((vehicle) => vehicle.id === input.entry.catalogId);
  if (!catalog || !canUseEquinoxConsole(catalog)) throw new Error("Battery diagnosis requires a verified 2024 Equinox EV garage entry.");
  let scan: Awaited<ReturnType<typeof runBatteryDiagnosisScan>>;
  try {
    scan = await runBatteryDiagnosisScan(input.transport, input.recording, input.onProgress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const interruption = input.getInterruption();
    input.recording.meta(`battery scan close failed: ${message}`);
    if (interruption) input.recording.meta(`battery diagnosis interrupted: ${interruption}`);
    input.onProgress("Keeping private scan");
    const recording = await input.keepScan(input.entry.id, input.scannedAt, input.recording.toJsonl());
    if (interruption) {
      return { status: "stopped", cause: interruption, recording, reason: interruption === "cancelled" ? "Battery diagnosis cancelled; no report saved." : "Battery diagnosis stopped after disconnect; no report saved." };
    }
    throw new Error(`Battery diagnosis failed: ${message}. Private scan: ${recording}`, { cause: error });
  }
  const interruption = input.getInterruption();
  if (interruption) {
    input.recording.meta(`battery diagnosis interrupted: ${interruption}`);
    input.onProgress("Keeping private scan");
    const recording = await input.keepScan(input.entry.id, input.scannedAt, input.recording.toJsonl());
    return { status: "stopped", cause: interruption, recording, reason: interruption === "cancelled" ? "Battery diagnosis cancelled; no report saved." : "Battery diagnosis stopped after disconnect; no report saved." };
  }
  input.onProgress("Keeping private scan");
  const recording = await input.keepScan(input.entry.id, input.scannedAt, scan.jsonl);
  input.onProgress("Building battery diagnosis");
  const report = await batteryDiagnosisFromRecording(scan.jsonl, {
    garageVehicleId: input.entry.id,
    catalogId: "chevrolet-equinox-ev-2024",
    scannedAt: input.scannedAt,
    recording,
    scanStatus: scan.scanStatus,
  }, input.importedSignals);
  if (!hasEquinoxSocFingerprint(report)) {
    return { status: "no-fingerprint", recording, scanStatus: scan.scanStatus, reason: `No verified CB state-of-charge reading; no report saved.${scan.stopReason ? ` Scan stopped: ${scan.stopReason}` : ""}` };
  }
  input.onProgress("Saving report to this car");
  await input.history.save(report);
  return { status: "saved", report, recording };
}
