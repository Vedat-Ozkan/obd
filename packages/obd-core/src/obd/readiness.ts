import type { Frame } from "../elm/isotp.js";
import { checkEcho, type DecodeFailure } from "./response.js";

export type MonitorId =
  | "misfire" | "fuel" | "components"
  | "catalyst" | "heatedCatalyst" | "evap" | "secondaryAir" | "gpf"
  | "o2Sensor" | "o2Heater" | "egrVvt"
  | "nmhcCatalyst" | "noxScr" | "boostPressure" | "exhaustGasSensor" | "pmFilter";

export const SPARK_MONITORS: readonly MonitorId[] = [
  "catalyst", "heatedCatalyst", "evap", "secondaryAir", "gpf", "o2Sensor", "o2Heater", "egrVvt",
];

export const COMPRESSION_MONITORS: readonly (MonitorId | undefined)[] = [
  "nmhcCatalyst", "noxScr", undefined, "boostPressure", undefined, "exhaustGasSensor", "pmFilter", "egrVvt",
];

const B_MONITORS: readonly MonitorId[] = ["misfire", "fuel", "components"];

export interface Monitor {
  id: MonitorId;
  complete: boolean;
}

export interface Readiness {
  ok: true;
  ecu: string;
  pid: 0x01 | 0x41;
  mil?: boolean;
  dtcCount?: number;
  ignition: "spark" | "compression";
  monitors: Monitor[];
}

const bit = (byte: number, n: number): boolean => ((byte >> n) & 1) === 1;

export function decodeReadiness(pid: 0x01 | 0x41, frame: Frame): Readiness | DecodeFailure {
  const failure = checkEcho(frame, [0x41, pid]);
  if (failure !== undefined) return failure;
  if (frame.data.length !== 6) return { ok: false, ecu: frame.ecu, reason: "length" };
  const [a, b, c, d] = frame.data.subarray(2);
  const ignition = bit(b, 3) ? "compression" : "spark";
  const monitors: Monitor[] = [];
  B_MONITORS.forEach((id, n) => {
    if (bit(b, n)) monitors.push({ id, complete: !bit(b, n + 4) });
  });
  const layout = ignition === "spark" ? SPARK_MONITORS : COMPRESSION_MONITORS;
  layout.forEach((id, n) => {
    if (id !== undefined && bit(c, n)) monitors.push({ id, complete: !bit(d, n) });
  });
  const readiness: Readiness = { ok: true, ecu: frame.ecu, pid, ignition, monitors };
  if (pid === 0x01) {
    readiness.mil = bit(a, 7);
    readiness.dtcCount = a & 0x7f;
  }
  return readiness;
}
