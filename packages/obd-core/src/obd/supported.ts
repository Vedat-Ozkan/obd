import type { Frame } from "../elm/isotp.js";
import { checkEcho, type DecodeFailure } from "./response.js";

export const BITMAP_PIDS: readonly number[] = [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0];

export interface Supported {
  ok: true;
  ecu: string;
  base: number;
  pids: number[];
}

export function decodeSupported(base: number, frame: Frame): Supported | DecodeFailure {
  if (!BITMAP_PIDS.includes(base)) return { ok: false, ecu: frame.ecu, reason: "unknown-pid" };
  const failure = checkEcho(frame, [0x41, base]);
  if (failure !== undefined) return failure;
  if (frame.data.length !== 6) return { ok: false, ecu: frame.ecu, reason: "length" };
  const pids: number[] = [];
  for (let i = 0; i < 32; i++) {
    if ((frame.data[2 + (i >> 3)] >> (7 - (i & 7))) & 1) pids.push(base + 1 + i);
  }
  return { ok: true, ecu: frame.ecu, base, pids };
}
