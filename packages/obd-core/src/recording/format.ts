import { z } from "zod";

// Recording format: docs/ARCHITECTURE.md "Recording format"; codec: docs/specs/T0.2-hardware-spike.md
// Recording format contract (ISO-8859-1, every byte 0-255 round-trips).

const latin1String = z
  .string()
  .refine((s) => !/[^\u0000-ÿ]/.test(s), { message: "data must be ISO-8859-1 (char codes <= 0xFF)" });

const t = z.number().nonnegative();

/** One line of a fixtures/recordings/*.jsonl file. `meta` keeps unknown keys (loose object). */
export const recordingLineSchema = z.discriminatedUnion("dir", [
  z.object({ t, dir: z.literal("tx"), data: latin1String }),
  z.object({ t, dir: z.literal("rx"), data: latin1String }),
  z.looseObject({ t, dir: z.literal("meta") }),
]);

export type RecordingLine = z.infer<typeof recordingLineSchema>;

/** Parses a whole .jsonl file. Throws Error("recording line <n>: <reason>") on the first bad line (n is 1-based). */
export function parseRecording(text: string): RecordingLine[] {
  const segments = text.split("\n");
  if (segments.at(-1) === "") segments.pop();
  return segments.map((segment, i) => {
    let json: unknown;
    try {
      json = JSON.parse(segment);
    } catch (e) {
      throw new Error(`recording line ${String(i + 1)}: ${e instanceof Error ? e.message : "invalid JSON"}`);
    }
    const result = recordingLineSchema.safeParse(json);
    if (!result.success) {
      throw new Error(`recording line ${String(i + 1)}: ${z.prettifyError(result.error)}`);
    }
    return result.data;
  });
}

/** ISO-8859-1: char code i <-> byte i. Hand-rolled: WHATWG TextDecoder("latin1") is windows-1252, which remaps 0x80-0x9F. */
export function latin1Encode(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error(`latin1Encode: char code ${String(code)} at index ${String(i)} exceeds 0xFF`);
    bytes[i] = code;
  }
  return bytes;
}

export function latin1Decode(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return text;
}
