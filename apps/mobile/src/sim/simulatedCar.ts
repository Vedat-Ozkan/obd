import { SimulatedTransport, type SimTable } from "obd-core/transport/simulated";
import type { DongleConnection } from "../ble/dongleLink.js";

export const SIM_EQUINOX_ID = "sim:equinox-2024";
export const SIM_WRONG_MODEL_ID = "sim:wrong-model";
export const SIM_PICKER_ROWS: readonly { id: string; name: string; title: string }[] = [
  { id: SIM_EQUINOX_ID, name: "Simulated car", title: "Simulated car (Equinox EV)" },
  { id: SIM_WRONG_MODEL_ID, name: "Simulated car", title: "Simulated car (wrong model VIN)" },
];

export const isSimulated = (id: string | undefined): boolean => id === SIM_EQUINOX_ID || id === SIM_WRONG_MODEL_ID;

export const captureStem = (base: string, link: { deviceId: string } | undefined): string => isSimulated(link?.deviceId) ? `simulated-${base}` : base;

export function connectSimulated(id: string): Promise<DongleConnection> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const table = require("./equinox.table.json") as SimTable;
  const sim = new SimulatedTransport(table, id === SIM_WRONG_MODEL_ID ? "wrong-model" : "equinox");
  const transport = {
    startsIdle: sim.startsIdle,
    write: (bytes: Uint8Array) => sim.write(bytes).catch((error: unknown) => { console.log(`[sim] ${error instanceof Error ? error.message : String(error)}`); throw error; }),
    onData: (cb: (bytes: Uint8Array) => void) => sim.onData(cb),
    close: () => sim.close(),
    onError: () => () => undefined,
  };
  return Promise.resolve({ transport, deviceId: id, deviceName: "Simulated car", mtu: 0, writeCharacteristicUuid: "simulated", notifyCharacteristicUuid: "simulated" });
}
