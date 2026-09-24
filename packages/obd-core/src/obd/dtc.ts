// Mode 03/07/0A DTC lists: docs/specs/T0.5-standard-decoding.md "src/obd/dtc.ts".
// Layout (4x <count> then count x 2 bytes) and the 2-byte encoding: docs/ELM327.md §J1979 conventions
// ("DTC lists", "DTC 2-byte encoding") and §Mode 01 footer ("DTC decoding (CAN)").
import type { Frame } from "../elm/isotp.js";
import { checkEcho, type DecodeFailure } from "./response.js";

export type DtcMode = 0x03 | 0x07 | 0x0a;

export interface DtcList {
  ok: true;
  ecu: string;
  mode: DtcMode;
  /** e.g. ["P0133", "U0158"] */
  dtcs: string[];
}

// A7..A6 = 0..3: docs/ELM327.md §J1979 conventions "DTC 2-byte encoding".
const SYSTEMS = ["P", "C", "B", "U"] as const;

/** Two bytes -> "P0133": A7..A6 -> P/C/B/U, A5..A4 -> first digit 0-3, then A3..A0, B7..B4, B3..B0 as hex (uppercase). */
export function decodeDtc(a: number, b: number): string {
  const tail = (((a & 0x0f) << 8) | b).toString(16).toUpperCase().padStart(3, "0");
  return `${SYSTEMS[a >> 6]}${String((a >> 4) & 0x03)}${tail}`;
}

/** checkEcho [mode + 0x40]; data.length < 2 or data.length !== 2 + 2 * data[1] -> "length"; 00 00 pairs skipped. */
export function decodeDtcList(mode: DtcMode, frame: Frame): DtcList | DecodeFailure {
  const failure = checkEcho(frame, [mode + 0x40]);
  if (failure !== undefined) return failure;
  const { data } = frame;
  if (data.length < 2 || data.length !== 2 + 2 * data[1]) return { ok: false, ecu: frame.ecu, reason: "length" };
  const dtcs: string[] = [];
  for (let i = 2; i < data.length; i += 2) {
    // 00 00 is padding, not a DTC (docs/ELM327.md §J1979 conventions).
    if (data[i] !== 0 || data[i + 1] !== 0) dtcs.push(decodeDtc(data[i], data[i + 1]));
  }
  return { ok: true, ecu: frame.ecu, mode, dtcs };
}
