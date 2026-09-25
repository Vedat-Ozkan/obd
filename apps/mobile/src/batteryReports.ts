import { parseBatteryDiagnosis, type BatteryDiagnosisReport } from "../../../packages/obd-battery/src/report.js";
import type { GarageState } from "./garage/flow.js";

export interface ReportTextStore { read(): Promise<string | undefined>; write(text: string): Promise<void> }
type History = { version: 1; reports: BatteryDiagnosisReport[] };
const empty = (): History => ({ version: 1, reports: [] });
function parseHistory(raw: string): History {
  let data: unknown;
  try { data = JSON.parse(raw) as unknown; } catch { throw new Error("Battery report history is malformed; saved file unchanged."); }
  if (typeof data !== "object" || data === null || Array.isArray(data) || !('version' in data) || data.version !== 1 || !('reports' in data) || !Array.isArray(data.reports)) throw new Error("Battery report history has an unsupported format; saved file unchanged.");
  return { version: 1, reports: data.reports.map(parseBatteryDiagnosis) };
}

export function createBatteryReportHistory(store: ReportTextStore, garage: { load(): Promise<GarageState> }) {
  let state: History | undefined;
  let loading: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<void> => {
    if (state !== undefined) return;
    const task = loading ??= store.read().then((raw) => { state = raw === undefined ? empty() : parseHistory(raw); });
    try { await task; } finally { if (loading === task) loading = undefined; }
  };
  const list = async (garageVehicleId: string): Promise<readonly BatteryDiagnosisReport[]> => {
    await load();
    if (state === undefined) throw new Error("Battery report history failed to load.");
    return structuredClone(state.reports.filter((r) => r.garageVehicleId === garageVehicleId));
  };
  const save = (report: BatteryDiagnosisReport): Promise<void> => {
    const task = queue.then(async () => {
      await load();
      if (state === undefined) throw new Error("Battery report history failed to load.");
      const parsed = parseBatteryDiagnosis(report);
      const currentGarage = await garage.load();
      if (!currentGarage.vehicles.some((v) => v.id === parsed.garageVehicleId && v.catalogId === parsed.catalogId)) throw new Error("Battery report garage vehicle is missing or mismatched.");
      const next = { version: 1 as const, reports: [parsed, ...state.reports] };
      next.reports.sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));
      await store.write(JSON.stringify(next));
      state = next;
    });
    queue = task.catch(() => undefined);
    return task;
  };
  return { load, list, save, hasReports: async (garageVehicleId: string) => (await list(garageVehicleId)).length > 0 };
}
