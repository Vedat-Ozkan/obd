import type { Frame } from "../../elm/isotp.js";
import type { ObdbMode22Signal, SignalTier } from "./import.js";

export type SignalReading =
  | { ok: true; id: string; name: string; value: number; unit: string; tier: SignalTier; ecu: string }
  | { ok: false; id: string; reason: "header" | "echo" | "negative" | "length" | "format"; ecu: string };

/** Extracts big-endian bits from the data after the 62 DID echo. */
function unsignedBits(data: Uint8Array, bix: number, len: number): number {
  let raw = 0n;
  for (let bit = bix; bit < bix + len; bit++) {
    raw = (raw << 1n) | BigInt((data[bit >> 3] >> (7 - (bit & 7))) & 1);
  }
  return Number(raw);
}

export function decodeObdbMode22(did: string, frame: Frame, signals: readonly ObdbMode22Signal[]): readonly SignalReading[] {
  return signals.filter((s) => s.did === did).map((s): SignalReading => {
    const fail = (reason: "header" | "echo" | "negative" | "length" | "format"): SignalReading => ({ ok: false, id: s.id, reason, ecu: frame.ecu });
    if (frame.header.toUpperCase() !== `18DAF1${s.module}`) return fail("header");
    if (frame.negative !== undefined || frame.data[0] === 0x7f) return fail("negative");
    if (frame.data.length < 3) return fail("length");
    if (frame.data[0] !== 0x62 || frame.data[1] !== parseInt(did.slice(0, 2), 16) || frame.data[2] !== parseInt(did.slice(2), 16)) return fail("echo");
    const data = frame.data.subarray(3);
    if (s.bix + s.len > data.length * 8) return fail("length");
    const value = (unsignedBits(data, s.bix, s.len) * s.mul) / s.div + s.add;
    if (!Number.isFinite(value) || (s.min !== undefined && value < s.min) || (s.max !== undefined && value > s.max)) return fail("format");
    return { ok: true, id: s.id, name: s.name, value, unit: s.unit, tier: s.tier, ecu: frame.ecu };
  });
}
