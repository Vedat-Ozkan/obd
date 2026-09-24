// Supported-PID bitmap decode (the walk is T0.9): docs/specs/T0.5-standard-decoding.md "src/obd/supported.ts".
// Bit order (MSB of byte A = base+1 ... LSB of byte D = base+0x20): docs/ELM327.md §J1979 conventions.
import type { Frame } from "../elm/isotp.js";
import { checkEcho, type DecodeFailure } from "./response.js";

// PLAN T0.5 row; each bitmap's last bit flags the next one (docs/ELM327.md §J1979 conventions).
export const BITMAP_PIDS: readonly number[] = [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0];

export interface Supported {
  ok: true;
  ecu: string;
  base: number;
  /** Ascending; base+0x20 included when flagged. */
  pids: number[];
}

/** base not in BITMAP_PIDS -> "unknown-pid"; checkEcho [0x41, base]; data.length !== 6 -> "length". */
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
