// Beta upload provenance and manifest (ADR-019): docs/specs/T2.9-beta-data-upload.md §Provenance and keys,
// §Interfaces "provenance.ts", §Decisions 3 (the mine/checked tag is kept).
import { z } from "zod";
import { pyString, SCRUB_RULES, SCRUB_VERSION, type ScrubRule } from "./scrub.js";

export const CONSENT_VERSIONS = ["beta-1"] as const;
export const UPLOAD_KINDS = ["capture", "codes-scan", "battery-scan", "charge-log"] as const;
export const PART_MAX_BYTES = 17 * 1024 * 1024; // the phone targets 16 MiB, line-aligned, so one long line may overshoot

const scrubCount = z.int().nonnegative();

export const betaProvenanceSchema = z.strictObject({
  schema: z.literal(1),
  fileId: z.uuidv4(),
  kind: z.enum(UPLOAD_KINDS),
  consentVersion: z.enum(CONSENT_VERSIONS),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  scrubVersion: z.literal(SCRUB_VERSION),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  catalogId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*-\d{4}$/),
  // apps/mobile/src/garage/flow.ts Ownership.
  ownership: z.enum(["mine", "checked"]),
  testerKey: z.uuidv4(),
  vehicleKey: z.uuidv4(),
  synthetic: z.literal(false),
  scrub: z.strictObject(Object.fromEntries(SCRUB_RULES.map((r) => [r, scrubCount])) as Record<ScrubRule, typeof scrubCount>),
});
export type BetaProvenance = z.infer<typeof betaProvenanceSchema>;

export const betaManifestSchema = z.strictObject({
  provenance: betaProvenanceSchema,
  parts: z.array(z.strictObject({ bytes: z.int().positive().max(PART_MAX_BYTES), lines: z.int().positive() })).min(1).max(64),
});
export type BetaManifest = z.infer<typeof betaManifestSchema>;

// Python json.dumps form (", " and ": ", \u escapes above 0x7E): tools/spike/redact_vin.py _check.
function pythonJson(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).map(([k, v]) => `${pyString(k)}: ${pythonJson(v)}`).join(", ")}}`;
  }
  return typeof value === "string" ? pyString(value) : JSON.stringify(value);
}

/** The file's last line: {"t": <t>, "dir": "meta", "beta": <provenance>} in Python json.dumps form. */
export function provenanceLine(t: number, provenance: BetaProvenance): string {
  return pythonJson({ t, dir: "meta", beta: betaProvenanceSchema.parse(provenance) });
}
