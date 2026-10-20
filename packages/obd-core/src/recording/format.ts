import { z } from "zod";

const latin1String = z
  .string()
  .refine((s) => !/[^\u0000-ÿ]/.test(s), { message: "data must be ISO-8859-1 (char codes <= 0xFF)" });

const t = z.number().nonnegative();

export const recordingLineSchema = z.discriminatedUnion("dir", [
  z.object({ t, dir: z.literal("tx"), data: latin1String }),
  z.object({ t, dir: z.literal("rx"), data: latin1String }),
  z.looseObject({ t, dir: z.literal("meta") }),
]);

export type RecordingLine = z.infer<typeof recordingLineSchema>;

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
