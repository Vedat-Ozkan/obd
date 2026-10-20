import type { Frame } from "../elm/isotp.js";
import { checkEcho, type DecodeFailure } from "./response.js";

export type DtcMode = 0x03 | 0x07 | 0x0a;

export interface DtcList {
  ok: true;
  ecu: string;
  mode: DtcMode;
  dtcs: string[];
}

const SYSTEMS = ["P", "C", "B", "U"] as const;

export function decodeDtc(a: number, b: number): string {
  const tail = (((a & 0x0f) << 8) | b).toString(16).toUpperCase().padStart(3, "0");
  return `${SYSTEMS[a >> 6]}${String((a >> 4) & 0x03)}${tail}`;
}

export function decodeDtcList(mode: DtcMode, frame: Frame): DtcList | DecodeFailure {
  const failure = checkEcho(frame, [mode + 0x40]);
  if (failure !== undefined) return failure;
  const { data } = frame;
  if (data.length < 2 || data.length !== 2 + 2 * data[1]) return { ok: false, ecu: frame.ecu, reason: "length" };
  const dtcs: string[] = [];
  for (let i = 2; i < data.length; i += 2) {
    if (data[i] !== 0 || data[i + 1] !== 0) dtcs.push(decodeDtc(data[i], data[i + 1]));
  }
  return { ok: true, ecu: frame.ecu, mode, dtcs };
}
