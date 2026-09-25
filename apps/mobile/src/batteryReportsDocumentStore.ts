import { Directory, File, Paths } from "expo-file-system";
import type { ReportTextStore } from "./batteryReports.js";

export const batteryReportsDocumentStore: ReportTextStore = {
  async read() {
    const file = new File(Paths.document, "battery-reports.json");
    return file.exists ? file.text() : undefined;
  },
  async write(text) {
    const pending = new File(Paths.document, "battery-reports.pending.json");
    const destination = new File(Paths.document, "battery-reports.json");
    if (pending.exists) pending.delete();
    pending.create();
    pending.write(text);
    await pending.move(destination, { overwrite: true });
  },
};

/** Keeps the scan in app-private Documents before its report is added to history. */
export function keepPrivateBatteryScan(garageVehicleId: string, scannedAt: string, jsonl: string): string {
  if (!/^[1-9]\d*$/.test(garageVehicleId)) throw new Error("Invalid garage vehicle ID.");
  const stamp = new Date(scannedAt);
  if (Number.isNaN(stamp.valueOf())) throw new Error("Invalid scan timestamp.");
  const parent = new Directory(Paths.document, "battery-scans");
  parent.create({ idempotent: true });
  const folder = new Directory(parent, garageVehicleId);
  folder.create({ idempotent: true });
  const base = stamp.toISOString().replace(/[:.]/g, "-");
  for (let number = 0; number < 1000; number++) {
    const name = `${base}${number === 0 ? "" : `-${String(number)}`}.jsonl`;
    const destination = new File(folder, name);
    if (destination.exists) continue;
    destination.create();
    destination.write(jsonl);
    return `battery-scans/${garageVehicleId}/${name}`;
  }
  throw new Error("No available private scan filename.");
}
