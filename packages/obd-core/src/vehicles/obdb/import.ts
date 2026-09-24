import { z } from "zod";

export type SignalTier = "community" | "verified";

export interface ObdbMode22Signal {
  id: string;
  name: string;
  module: string;
  did: string;
  bix: number;
  len: number;
  mul: number;
  div: number;
  add: number;
  min?: number;
  max?: number;
  unit: string;
  tier: SignalTier;
}

const finite = z.number();
const format = z.strictObject({
  bix: z.number().int().nonnegative().optional(),
  len: z.number().int().positive().max(53),
  mul: finite.optional(),
  div: finite.refine((n) => n !== 0, "div must not be zero").optional(),
  add: finite.optional(),
  min: finite.optional(),
  max: finite.optional(),
  unit: z.string(),
});
const signal = z.object({ id: z.string().min(1), name: z.string(), fmt: format });
const command = z.object({
  hdr: z.string().regex(/^DA[0-9A-F]{2}$/, "expected DAxx header"),
  cmd: z.strictObject({ "22": z.string().regex(/^[0-9A-F]{4}$/, "expected four-hex-digit Mode 22 DID") }),
  signals: z.array(signal).min(1),
});
const signalset = z.object({ commands: z.array(command) });

/** Bounded OBDb v3 Mode 22 subset used by the vendored Equinox file. */
export function importObdbMode22(input: unknown): readonly ObdbMode22Signal[] {
  const parsed = signalset.safeParse(input);
  if (!parsed.success) throw new Error(`OBDb Mode 22 import: ${z.prettifyError(parsed.error)}`);
  const ids = new Set<string>();
  const keys = new Set<string>();
  const out: ObdbMode22Signal[] = [];
  for (const c of parsed.data.commands) {
    for (const s of c.signals) {
      const key = `${c.hdr.slice(2)}:${c.cmd["22"]}:${s.id}`;
      if (ids.has(s.id) || keys.has(key)) throw new Error(`OBDb Mode 22 import: duplicate signal ID ${s.id}`);
      ids.add(s.id);
      keys.add(key);
      const { bix = 0, len, mul = 1, div = 1, add = 0, min, max, unit } = s.fmt;
      if (min !== undefined && max !== undefined && min > max) throw new Error(`OBDb Mode 22 import: invalid range for ${s.id}`);
      out.push({ id: s.id, name: s.name, module: c.hdr.slice(2), did: c.cmd["22"], bix, len, mul, div, add, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), unit, tier: "community" });
    }
  }
  return out;
}
