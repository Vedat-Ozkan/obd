// Mode 09 text infotypes (VIN, CAL IDs, ECU name): docs/specs/T0.5-standard-decoding.md "src/obd/vin.ts".
// Layouts: docs/ELM327.md §J1979 conventions ("VIN (0902)", "CAL IDs (0904)", "ECU name (090A)").
// VIN privacy (ADR-014, ADR-017): the VIN lives only in the returned object; nothing here logs it.
import type { Frame } from "../elm/isotp.js";
import { checkEcho, type DecodeFailure } from "./response.js";

export type VinStatus = "valid" | "check-digit-mismatch" | "masked";

export interface VinResult {
  ok: true;
  ecu: string;
  vin: string;
  status: VinStatus;
}

export interface CalIds {
  ok: true;
  ecu: string;
  calIds: string[];
}

export interface EcuName {
  ok: true;
  ecu: string;
  name: string;
}

// Digits and the letters 49 CFR 565.15(c) Table III assigns a value to (no I, O, Q): docs/ELM327.md §J1979
// conventions "VIN check digit".
const VIN_CHARS = /^[0-9A-HJ-NPR-Z]{17}$/;

// 49 CFR 565.15(c) Table III assigned values, copied in docs/ELM327.md §J1979 conventions "VIN check digit".
const LETTER_VALUES: Readonly<Record<string, number>> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

// 49 CFR 565.15(c) Table IV weight factors, positions 1-17 (position 9 = 0 as in Table VI); same row as above.
const WEIGHTS: readonly number[] = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

// ADR-017 serial mask at positions 12-17 (tools/spike/redact_vin.py MASK).
const MASK = "000000";

/** 49 CFR 565.15(c): expected position-9 character ("0"-"9" or "X"); undefined if vin is not 17 VIN characters. */
export function vinCheckDigit(vin: string): string | undefined {
  if (!VIN_CHARS.test(vin)) return undefined;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (c >= "0" && c <= "9" ? Number(c) : LETTER_VALUES[c]) * WEIGHTS[i];
  }
  // Remainder 10 is "X" (Table V).
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** NULs removed; undefined if any remaining byte is outside printable ASCII 0x20-0x7E. */
function text(bytes: Uint8Array): string | undefined {
  const kept = bytes.filter((b) => b !== 0);
  return kept.every((b) => b >= 0x20 && b <= 0x7e) ? ascii(kept) : undefined;
}

/** checkEcho [0x49, 0x02]; data.length !== 20 -> "length"; data[2] !== 1 or any of the 17 chars outside
 *  [0-9A-HJ-NPR-Z] -> "format". chars 12..17 === "000000" -> "masked" (ADR-017 mask; check digit not computed).
 *  Otherwise vin[8] === vinCheckDigit(vin) ? "valid" : "check-digit-mismatch". */
export function decodeVin(frame: Frame): VinResult | DecodeFailure {
  const failure = checkEcho(frame, [0x49, 0x02]);
  if (failure !== undefined) return failure;
  if (frame.data.length !== 20) return { ok: false, ecu: frame.ecu, reason: "length" };
  const vin = ascii(frame.data.subarray(3));
  if (frame.data[2] !== 1 || !VIN_CHARS.test(vin)) return { ok: false, ecu: frame.ecu, reason: "format" };
  // Masked is decided first: a committed recording's check digit cannot be verified (spec, VinStatus note).
  let status: VinStatus = "masked";
  if (vin.slice(11) !== MASK) status = vin[8] === vinCheckDigit(vin) ? "valid" : "check-digit-mismatch";
  return { ok: true, ecu: frame.ecu, vin, status };
}

/** checkEcho [0x49, 0x04]; n = data[2]; data.length !== 3 + 16n -> "length"; each 16-byte block: NULs removed,
 *  any remaining byte outside 0x20-0x7E -> "format". */
export function decodeCalIds(frame: Frame): CalIds | DecodeFailure {
  const failure = checkEcho(frame, [0x49, 0x04]);
  if (failure !== undefined) return failure;
  const { data } = frame;
  if (data.length < 3 || data.length !== 3 + 16 * data[2]) return { ok: false, ecu: frame.ecu, reason: "length" };
  const calIds: string[] = [];
  for (let i = 3; i < data.length; i += 16) {
    const id = text(data.subarray(i, i + 16));
    if (id === undefined) return { ok: false, ecu: frame.ecu, reason: "format" };
    calIds.push(id);
  }
  return { ok: true, ecu: frame.ecu, calIds };
}

/** checkEcho [0x49, 0x0A]; data.length !== 23 -> "length"; data[2] !== 1 -> "format"; 20 bytes, NULs removed,
 *  remaining bytes 0x20-0x7E else "format". Spike: module 45 -> "GWM-Gateway". */
export function decodeEcuName(frame: Frame): EcuName | DecodeFailure {
  const failure = checkEcho(frame, [0x49, 0x0a]);
  if (failure !== undefined) return failure;
  if (frame.data.length !== 23) return { ok: false, ecu: frame.ecu, reason: "length" };
  const name = frame.data[2] === 1 ? text(frame.data.subarray(3)) : undefined;
  if (name === undefined) return { ok: false, ecu: frame.ecu, reason: "format" };
  return { ok: true, ecu: frame.ecu, name };
}
