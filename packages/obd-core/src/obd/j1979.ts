// Mode 01 PID table and scalar decode: docs/specs/T0.5-standard-decoding.md "src/obd/j1979.ts".
//
// Attribution: every row of MODE01_PIDS (byte count, mul/div/add, unit) and every entry of OBD_STANDARDS is taken
// from the OBDb SAEJ1979 signalset, https://github.com/OBDb/SAEJ1979 commit d3259214a9e0340c4a6cff9ec5f8ff5953eee6f2,
// vendored unmodified at packages/obd-core/vehicles/saej1979/default.json (CC-BY-SA-4.0, see the LICENSE there and
// ADR-010). Source per row: that file's entry cmd {"01": "<pid>"}; test/j1979.test.ts checks every row against it.
// Response echo "41 <pid>": docs/ELM327.md §J1979 conventions.
import type { Frame } from "../elm/isotp.js";
import { checkEcho, type DecodeFailure } from "./response.js";

export type Unit = "percent" | "degC" | "km" | "min" | "V" | "count" | "enum";

export interface PidDef {
  /** 0x31 */
  pid: number;
  /** OBDb signal id, the cross-check key: "CLR_DIST". */
  id: string;
  /** raw = big-endian unsigned over `bytes` bytes after the 41 <pid> echo. */
  bytes: 1 | 2 | 4;
  /** value = raw * mul / div + add (OBDb fmt semantics; absent = 1, 1, 0). */
  mul: number;
  div: number;
  add: number;
  unit: Unit;
}

export const MODE01_PIDS: readonly PidDef[] = [
  { pid: 0x1c, id: "OBDSUP", bytes: 1, mul: 1, div: 1, add: 0, unit: "enum" }, // OBDb 01/1C
  { pid: 0x21, id: "MIL_DIST", bytes: 2, mul: 1, div: 1, add: 0, unit: "km" }, // OBDb 01/21
  { pid: 0x30, id: "WARM_UPS", bytes: 1, mul: 1, div: 1, add: 0, unit: "count" }, // OBDb 01/30
  { pid: 0x31, id: "CLR_DIST", bytes: 2, mul: 1, div: 1, add: 0, unit: "km" }, // OBDb 01/31
  { pid: 0x42, id: "VPWR", bytes: 2, mul: 1, div: 1000, add: 0, unit: "V" }, // OBDb 01/42
  { pid: 0x46, id: "AAT", bytes: 1, mul: 1, div: 1, add: -40, unit: "degC" }, // OBDb 01/46
  { pid: 0x4d, id: "MIL_TIME", bytes: 2, mul: 1, div: 1, add: 0, unit: "min" }, // OBDb 01/4D
  { pid: 0x4e, id: "CLR_TIME", bytes: 2, mul: 1, div: 1, add: 0, unit: "min" }, // OBDb 01/4E
  { pid: 0x5b, id: "BAT_SOC", bytes: 1, mul: 100, div: 255, add: 0, unit: "percent" }, // OBDb 01/5B
  { pid: 0xa6, id: "ODO", bytes: 4, mul: 1, div: 10, add: 0, unit: "km" }, // OBDb 01/A6
  { pid: 0xb2, id: "BAT_SOH", bytes: 1, mul: 100, div: 255, add: 0, unit: "percent" }, // OBDb 01/B2
];

/** PID 1C code -> OBDb 01/1C fmt.map[code].value, every code in the vendored map (22 is absent upstream). */
export const OBD_STANDARDS: Readonly<Record<number, string>> = {
  1: "OBD II",
  2: "OBD",
  3: "OBD & OBD II",
  4: "OBD I",
  5: "NO OBD",
  6: "EOBD",
  7: "EOBD & OBD II",
  8: "EOBD & OBD",
  9: "EOBD, OBD, OBD II",
  10: "JOBD",
  11: "JOBD & OBD II",
  12: "JOBD & EOBD",
  13: "JOBD, EOBD, OBD II",
  14: "EURO IV B1",
  15: "EURO V B2",
  16: "EURO C",
  17: "EMD",
  18: "EMD+",
  19: "HD OBD-C",
  20: "HD OBD",
  21: "WWH OBD",
  23: "HD EOBD-I",
  24: "HD EOBD-I N",
  25: "HD EOBD-II",
  26: "HD EOBD-II N",
  27: "HD-ZEV",
  28: "OBDBr-1",
  29: "OBDBr-2",
  30: "KOBD",
  31: "IOBD-I-BS4",
  32: "IOBD-II-BS4",
  33: "HD EOBD-VI",
  34: "OBD, OBD II and HD OBD",
  35: "OBDBr-3",
  36: "MC EOBD-I",
  37: "MC EOBD-II",
  38: "MC COBD-I",
  39: "MC TOBD-I",
  40: "MC JOBD-I",
  41: "CN-OBD-6",
  42: "OBDBr-P7",
  43: "CN-HDOBD-VI",
  44: "IOBD-I-BS6",
  45: "IOBD-II-BS6",
  46: "IHDOBD-BSVI",
  47: "OBDBr-P8",
  48: "HD-JOBD-II",
  49: "HD-KOBD-II",
  50: "CN-OROBD-IV",
  51: "CARB ACC-II",
  52: "MC JOBD-II",
  53: "MC CARB OBD",
  54: "MC EPA OBD",
  55: "MC CARB & EPA OBD",
  56: "HD ZEV CARB ZEP",
  57: "CARB ACC-II & EPA TIER4",
  58: "EPA TIER4",
  59: "EPA HD",
};

export interface PidReading {
  ok: true;
  ecu: string;
  pid: number;
  id: string;
  /** Unrounded; rounding is the renderer's job. */
  value: number;
  unit: Unit;
  /** Unit "enum" only, when OBD_STANDARDS has the code. */
  label?: string;
}

/** checkEcho [0x41, pid]; pid not in MODE01_PIDS -> "unknown-pid"; data.length !== 2 + bytes -> "length". */
export function decodePid(pid: number, frame: Frame): PidReading | DecodeFailure {
  const failure = checkEcho(frame, [0x41, pid]);
  if (failure !== undefined) return failure;
  const def = MODE01_PIDS.find((d) => d.pid === pid);
  if (def === undefined) return { ok: false, ecu: frame.ecu, reason: "unknown-pid" };
  // Exact length: a multi-PID reply (010C0D...) is out of scope and must not be read as this PID.
  if (frame.data.length !== 2 + def.bytes) return { ok: false, ecu: frame.ecu, reason: "length" };
  let raw = 0;
  for (const b of frame.data.subarray(2)) raw = raw * 256 + b;
  const reading: PidReading = {
    ok: true,
    ecu: frame.ecu,
    pid,
    id: def.id,
    value: (raw * def.mul) / def.div + def.add,
    unit: def.unit,
  };
  if (def.unit === "enum" && raw in OBD_STANDARDS) reading.label = OBD_STANDARDS[raw];
  return reading;
}
