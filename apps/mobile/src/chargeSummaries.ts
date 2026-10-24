import { parseRecording } from "obd-core/recording";
import type { ObdbMode22Signal } from "obd-core/vehicles";
import { summariseChargeLog, type ChargeSessionSummary } from "obd-battery/chargeSummary";
import { chargeLogFromRecording } from "obd-battery/session";
import type { GarageState } from "./garage/flow.js";

export interface SummaryTextStore { read(): Promise<string | undefined>; write(text: string): Promise<void> }
interface Entry { garageVehicleId: string; summary: ChargeSessionSummary }
type History = { version: 1; sessions: Entry[] };
const malformed = () => new Error("Charge summary history is malformed; saved file unchanged.");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseEntry(value: unknown): Entry {
  if (!record(value) || typeof value.garageVehicleId !== "string" || !record(value.summary)) throw malformed();
  const s = value.summary;
  if (s.version !== 1 || typeof s.id !== "string" || typeof s.at !== "string" || Number.isNaN(Date.parse(s.at)) || typeof s.recording !== "string" || typeof s.synthetic !== "boolean"
    || !Array.isArray(s.gateFailures) || !Array.isArray(s.spread) || !Array.isArray(s.powerBySoc)) throw malformed();
  return { garageVehicleId: value.garageVehicleId, summary: s as unknown as ChargeSessionSummary };
}

function parseHistory(raw: string): History {
  let data: unknown;
  try { data = JSON.parse(raw) as unknown; } catch { throw malformed(); }
  if (!record(data) || data.version !== 1 || !Array.isArray(data.sessions)) throw malformed();
  return { version: 1, sessions: data.sessions.map(parseEntry) };
}

export function createChargeSummaryHistory(store: SummaryTextStore, garage: { load(): Promise<GarageState> }) {
  let state: History | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<History> => {
    if (state !== undefined) return state;
    const raw = await store.read();
    state = raw === undefined ? { version: 1, sessions: [] } : parseHistory(raw);
    return state;
  };
  const list = async (garageVehicleId: string): Promise<readonly ChargeSessionSummary[]> => {
    const current = await load();
    return structuredClone(current.sessions.filter((e) => e.garageVehicleId === garageVehicleId).map((e) => e.summary));
  };
  const save = (garageVehicleId: string, summary: ChargeSessionSummary): Promise<void> => {
    const task = queue.then(async () => {
      const current = await load();
      if (!(await garage.load()).vehicles.some((v) => v.id === garageVehicleId)) throw new Error("Charge summary garage vehicle is missing.");
      const kept = current.sessions.filter((e) => !(e.garageVehicleId === garageVehicleId && e.summary.id === summary.id));
      const next: History = { version: 1, sessions: [{ garageVehicleId, summary: parseEntry({ garageVehicleId, summary }).summary }, ...kept].map(parseEntry) };
      await store.write(JSON.stringify(next));
      state = next;
    });
    queue = task.catch(() => undefined);
    return task;
  };
  return { list, save };
}

export async function saveChargeLogSummary(
  history: { save(garageVehicleId: string, summary: ChargeSessionSummary): Promise<void> },
  input: { garageVehicleId: string; file: string; text: string; at: string; signals: readonly ObdbMode22Signal[] },
): Promise<ChargeSessionSummary> {
  const log = await chargeLogFromRecording(parseRecording(input.text), input.file, input.signals);
  const summary = summariseChargeLog(log, input.file, input.at);
  await history.save(input.garageVehicleId, summary);
  return summary;
}
