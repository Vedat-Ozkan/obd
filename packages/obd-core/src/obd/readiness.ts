// Readiness from Mode 01 PID 01 and 41: docs/specs/T0.5-standard-decoding.md "src/obd/readiness.ts".
// Layout, polarity, and the spark/compression C/D maps: docs/ELM327.md §J1979 conventions (bit positions match OBDb
// 01/01 and 01/41 bix, checked in test/readiness.test.ts). Completeness bit 0 = complete in bytes B and D, for both
// PIDs; this overrides OBDb 01/01's D-byte `noyes` (recorded conflict).
import type { Frame } from "../elm/isotp.js";
import { checkEcho, type DecodeFailure } from "./response.js";

export type MonitorId =
  | "misfire" | "fuel" | "components" // byte B, both layouts
  | "catalyst" | "heatedCatalyst" | "evap" | "secondaryAir" | "gpf" // spark C0..C4
  | "o2Sensor" | "o2Heater" | "egrVvt" // spark C5..C7 (C7 both layouts)
  | "nmhcCatalyst" | "noxScr" | "boostPressure" | "exhaustGasSensor" | "pmFilter"; // compression C0,C1,C3,C5,C6

/** Index = bit number 0..7 of byte C/D. C4 is `gpf`, not OBDb's `ACRF` (recorded conflict). */
export const SPARK_MONITORS: readonly MonitorId[] = [
  "catalyst", "heatedCatalyst", "evap", "secondaryAir", "gpf", "o2Sensor", "o2Heater", "egrVvt",
];

/** Index = bit number 0..7 of byte C/D. undefined = reserved (C2, C4). */
export const COMPRESSION_MONITORS: readonly (MonitorId | undefined)[] = [
  "nmhcCatalyst", "noxScr", undefined, "boostPressure", undefined, "exhaustGasSensor", "pmFilter", "egrVvt",
];

// Byte B bits 0..2 availability, 4..6 completeness, same order in both layouts.
const B_MONITORS: readonly MonitorId[] = ["misfire", "fuel", "components"];

export interface Monitor {
  id: MonitorId;
  complete: boolean;
}

export interface Readiness {
  ok: true;
  ecu: string;
  pid: 0x01 | 0x41;
  /** PID 01 only: A7. */
  mil?: boolean;
  /** PID 01 only: A6..A0. */
  dtcCount?: number;
  /** B3. */
  ignition: "spark" | "compression";
  /** Only monitors whose availability bit (01) / enabled bit (41) is set, in order B0, B1, B2, C0..C7.
   *  complete = the matching completeness bit (B4..B6, D0..D7) is 0. Reserved bits are ignored. */
  monitors: Monitor[];
}

const bit = (byte: number, n: number): boolean => ((byte >> n) & 1) === 1;

/** checkEcho [0x41, pid]; data.length !== 6 -> "length". Byte A of PID 41 is not read. */
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
