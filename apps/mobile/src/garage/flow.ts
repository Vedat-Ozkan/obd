import { SUPPORTED_VEHICLES } from "./catalog.js";

export type Ownership = "mine" | "checked";
export type GarageVehicle = { id: string; catalogId: string; ownership: Ownership; nickname?: string };
export type Interest = { make: string; model: string; year: number; joinBeta: boolean };
export type GarageState = { version: 1; nextId: number; vehicles: GarageVehicle[]; interests: Interest[] };
export interface TextStore { read(): Promise<string | undefined>; write(text: string): Promise<void> }

export const LOCAL_INTEREST_NOTICE = "Saved on this phone; no request sent";

const catalogIds = new Set(SUPPORTED_VEHICLES.map((vehicle) => vehicle.id));
const empty = (): GarageState => ({ version: 1, nextId: 1, vehicles: [], interests: [] });
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const ownership = (value: unknown): value is Ownership => value === "mine" || value === "checked";
const yearValid = (value: unknown): value is number => Number.isInteger(value) && typeof value === "number" && value >= 1900 && value <= 2100;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function validInterest(value: unknown): value is Interest {
  return record(value) && nonempty(value.make) && nonempty(value.model) && yearValid(value.year) && typeof value.joinBeta === "boolean";
}

function parseState(raw: string): GarageState {
  let data: unknown;
  try { data = JSON.parse(raw) as unknown; } catch { throw new Error("Garage data is malformed. Retry without replacing the saved file."); }
  if (!record(data) || data.version !== 1 || !Number.isSafeInteger(data.nextId) || typeof data.nextId !== "number" || data.nextId < 1 || !Array.isArray(data.vehicles) || !Array.isArray(data.interests)) {
    throw new Error("Garage data has an unsupported or invalid format. The saved file was not changed.");
  }
  const ids = new Set<string>();
  for (const vehicle of data.vehicles) {
    if (!record(vehicle) || typeof vehicle.id !== "string" || !/^[1-9]\d*$/.test(vehicle.id) || ids.has(vehicle.id) || !catalogIds.has(vehicle.catalogId as string) || !ownership(vehicle.ownership) || (vehicle.nickname !== undefined && typeof vehicle.nickname !== "string") || Number(vehicle.id) >= data.nextId) {
      throw new Error("Garage data contains an invalid vehicle. The saved file was not changed.");
    }
    ids.add(vehicle.id);
  }
  if (!data.interests.every(validInterest)) throw new Error("Garage data contains invalid interest details. The saved file was not changed.");
  return data as GarageState;
}

export function createGarageFlow(store: TextStore) {
  let state: GarageState | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<GarageState> => {
    if (!state) {
      const raw = await store.read();
      state = raw === undefined ? empty() : parseState(raw);
    }
    return structuredClone(state);
  };
  const mutate = (change: (current: GarageState) => GarageState): Promise<GarageState> => {
    const task = queue.then(async () => {
      const current = await load();
      const next = change(current);
      await store.write(JSON.stringify(next));
      state = next;
      return structuredClone(next);
    });
    queue = task.catch(() => undefined);
    return task;
  };
  return {
    load,
    add(catalogId: string, tag: Ownership, nickname?: string) {
      return mutate((current) => {
        if (!catalogIds.has(catalogId)) throw new Error("This model year is not in the supported garage catalog.");
        if (!ownership(tag)) throw new Error("Choose mine or checked.");
        if (nickname !== undefined && typeof nickname !== "string") throw new Error("Invalid nickname.");
        const vehicle: GarageVehicle = { id: String(current.nextId), catalogId, ownership: tag };
        if (nickname?.trim()) vehicle.nickname = nickname.trim();
        return { ...current, nextId: current.nextId + 1, vehicles: [...current.vehicles, vehicle] };
      });
    },
    changeOwnership(id: string, tag: Ownership) {
      return mutate((current) => {
        if (!ownership(tag)) throw new Error("Choose mine or checked.");
        if (!current.vehicles.some((vehicle) => vehicle.id === id)) throw new Error("Garage vehicle not found.");
        return { ...current, vehicles: current.vehicles.map((vehicle) => vehicle.id === id ? { ...vehicle, ownership: tag } : vehicle) };
      });
    },
    remove(id: string) {
      return mutate((current) => {
        if (!current.vehicles.some((vehicle) => vehicle.id === id)) throw new Error("Garage vehicle not found.");
        return { ...current, vehicles: current.vehicles.filter((vehicle) => vehicle.id !== id) };
      });
    },
    saveInterest(interest: Interest) {
      return mutate((current) => {
        if (!validInterest(interest)) throw new Error("Enter a make, model, valid year, and beta choice.");
        const entry = { make: interest.make.trim(), model: interest.model.trim(), year: interest.year, joinBeta: interest.joinBeta };
        const interests = current.interests.filter((saved) => saved.make.toLowerCase() !== entry.make.toLowerCase() || saved.model.toLowerCase() !== entry.model.toLowerCase() || saved.year !== entry.year);
        return { ...current, interests: [...interests, entry] };
      });
    },
  };
}
