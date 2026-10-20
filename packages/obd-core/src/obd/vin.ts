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

const VIN_CHARS = /^[0-9A-HJ-NPR-Z]{17}$/;

const LETTER_VALUES: Readonly<Record<string, number>> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const WEIGHTS: readonly number[] = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

const MASK = "000000";

export function vinCheckDigit(vin: string): string | undefined {
  if (!VIN_CHARS.test(vin)) return undefined;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    sum += (c >= "0" && c <= "9" ? Number(c) : LETTER_VALUES[c]) * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

function text(bytes: Uint8Array): string | undefined {
  const kept = bytes.filter((b) => b !== 0);
  return kept.every((b) => b >= 0x20 && b <= 0x7e) ? ascii(kept) : undefined;
}

export function decodeVin(frame: Frame): VinResult | DecodeFailure {
  const failure = checkEcho(frame, [0x49, 0x02]);
  if (failure !== undefined) return failure;
  if (frame.data.length !== 20) return { ok: false, ecu: frame.ecu, reason: "length" };
  const vin = ascii(frame.data.subarray(3));
  if (frame.data[2] !== 1 || !VIN_CHARS.test(vin)) return { ok: false, ecu: frame.ecu, reason: "format" };
  let status: VinStatus = "masked";
  if (vin.slice(11) !== MASK) status = vin[8] === vinCheckDigit(vin) ? "valid" : "check-digit-mismatch";
  return { ok: true, ecu: frame.ecu, vin, status };
}

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

export function decodeEcuName(frame: Frame): EcuName | DecodeFailure {
  const failure = checkEcho(frame, [0x49, 0x0a]);
  if (failure !== undefined) return failure;
  if (frame.data.length !== 23) return { ok: false, ecu: frame.ecu, reason: "length" };
  const name = frame.data[2] === 1 ? text(frame.data.subarray(3)) : undefined;
  if (name === undefined) return { ok: false, ecu: frame.ecu, reason: "format" };
  return { ok: true, ecu: frame.ecu, name };
}
