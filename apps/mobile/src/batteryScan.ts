import { Elm327Session, type ElmResponse } from "obd-core/elm/session";
import { latin1Decode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { equinoxEv2024Profile, genericProfile, scanMode22Profile } from "obd-core/vehicles";
import { renderBatteryDiagnosis, type BatteryDiagnosisReport } from "obd-battery/report";
import { CODES_SCAN_COMMANDS } from "./codesScan.js";
import type { RecordingBuffer } from "./recording.js";
import type { GarageVehicle } from "./garage/flow.js";

export interface DiagnosisRun {
  jsonl: string;
  scanStatus: "complete" | "partial";
  stopReason?: string;
}

export function batteryReportRows(reports: readonly BatteryDiagnosisReport[]): readonly { label: string; detail: string; report: BatteryDiagnosisReport }[] {
  return reports.map((report) => ({ label: `${report.scannedAt} · ${report.scanStatus}`, detail: renderBatteryDiagnosis(report), report }));
}

export async function removeGarageVehicleWithReports(
  garage: { remove(id: string): Promise<unknown> },
  history: { hasReports(id: string): Promise<boolean> },
  id: GarageVehicle["id"],
): Promise<void> {
  if (await history.hasReports(id)) throw new Error("This car has retained battery reports. Removal is unavailable until a reviewed delete or export policy exists.");
  await garage.remove(id);
}

/** The CB response header and decoded SOC are required before attaching a report to a selected Equinox. */
export function hasEquinoxSocFingerprint(report: BatteryDiagnosisReport): boolean {
  return report.signals.some((signal) =>
    (signal.source.command === "22 27C6" || signal.source.command === "22 2B43") &&
    // The public decoder normalizes the 18DAF1CB frame source to its CB module ID.
    signal.source.ecu === "CB" && signal.id.includes("SOC"),
  );
}

class StopOnElmErrorSession extends Elm327Session {
  override async send(command: string): Promise<ElmResponse> {
    const response = await super.send(command);
    // NO DATA is a valid unsupported read; every classified ELM error needs a stopped scan.
    if (response.kind === "error") throw new Error(`${response.error.line} at ${command}`);
    return response;
  }
}

/** Runs on a fresh, already-started RecordingBuffer. The wrapper records bytes before the session sees them. */
export async function runBatteryDiagnosisScan(
  transport: Transport,
  recording: RecordingBuffer,
  onProgress: (message: string) => void,
): Promise<DiagnosisRun> {
  const callbacks = new Set<(bytes: Uint8Array) => void>();
  let open = true;
  const unsubscribe = transport.onData((bytes) => {
    if (!open) return;
    recording.rx(bytes);
    callbacks.forEach((callback) => { callback(bytes); });
  });
  const recorded: Transport = {
    startsIdle: transport.startsIdle,
    async write(bytes) {
      const command = latin1Decode(bytes);
      recording.tx(command);
      await transport.write(bytes);
    },
    onData(callback) { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
    async close() {
      open = false;
      unsubscribe();
      callbacks.clear();
      await transport.close();
    },
  };
  const session = new StopOnElmErrorSession(recorded);
  let stopReason: string | undefined;
  try {
    onProgress("Initializing ELM327");
    await session.init(genericProfile, {
      onInformationalReply(command, response) {
        if (response.kind === "error") throw new Error(`${response.error.line} at ${command}`);
      },
    });
    // init already sent 0100. The remaining post-init list is the sourced T0.9 codes sequence.
    for (const command of CODES_SCAN_COMMANDS.slice(CODES_SCAN_COMMANDS.indexOf("0100") + 1)) {
      onProgress(`Reading ${command}`);
      await session.send(command);
    }
    if (stopReason === undefined) {
      onProgress("Reading Equinox battery modules");
      await scanMode22Profile(session, equinoxEv2024Profile);
    }
  } catch (error) {
    stopReason = error instanceof Error ? error.message : String(error);
  } finally {
    await session.close();
  }
  recording.meta(stopReason === undefined ? "battery scan complete" : `battery scan partial: ${stopReason}`);
  return stopReason === undefined
    ? { jsonl: recording.toJsonl(), scanStatus: "complete" }
    : { jsonl: recording.toJsonl(), scanStatus: "partial", stopReason };
}
