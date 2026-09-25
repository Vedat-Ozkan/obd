// T2.9 Stage A: docs/specs/T2.9-beta-data-upload.md Verification "Isolated provenance tests" P1-P5.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRecording } from "../src/recording/format.js";
import { betaManifestSchema, betaProvenanceSchema, provenanceLine, type BetaProvenance } from "../src/recording/provenance.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const valid: BetaProvenance = {
  schema: 1,
  fileId: "3b241101-e2bb-4255-8caf-4136c566a962",
  kind: "codes-scan",
  consentVersion: "beta-1",
  appVersion: "1.0.0",
  scrubVersion: 1,
  month: "2026-10",
  catalogId: "chevrolet-equinox-ev-2024",
  ownership: "mine",
  testerKey: "9b2f6c1e-7a4d-4f3b-9c8e-1d2a3b4c5d6e",
  vehicleKey: "c0ffee00-1234-4abc-8def-0123456789ab",
  synthetic: false,
  scrub: {
    "vin-0902": 0, "vin-4193": 0, "vin-check-digit": 0, "did-f180-f1ff": 0, "mode09-infotype": 0,
    "odometer-01a6": 0, "user-note": 1, "date-in-note": 0, "meta-key": 0,
  },
};
const ok = (p: unknown) => betaProvenanceSchema.safeParse(p).success;

describe("beta provenance schema", () => {
  it("accepts the valid fixture", () => {
    expect(ok(valid)).toBe(true);
    expect(betaManifestSchema.safeParse({ provenance: valid, parts: [{ bytes: 10, lines: 2 }] }).success).toBe(true);
  });

  it("P1: a missing or unknown consentVersion is rejected", () => {
    const missing: Partial<BetaProvenance> = { ...valid };
    delete missing.consentVersion;
    expect(ok(missing)).toBe(false);
    expect(ok({ ...valid, consentVersion: "beta-0" })).toBe(false);
  });

  it("P2: a date finer than a month is rejected", () => {
    for (const month of ["2026-10-03", "2026-10-03T12:00:00Z", "2026-13", "2026-1"]) expect(ok({ ...valid, month }), month).toBe(false);
  });

  it("P3: a non-UUID-v4 testerKey, vehicleKey or fileId is rejected", () => {
    for (const key of ["testerKey", "vehicleKey", "fileId"] as const) {
      for (const v of ["1C4SYNTHETICVIN00", "3b241101-e2bb-1255-8caf-4136c566a962", ""]) expect(ok({ ...valid, [key]: v }), `${key} ${v}`).toBe(false);
    }
  });

  it("P4: an extra key is rejected at either level", () => {
    for (const key of ["vin", "note", "installId"]) {
      expect(ok({ ...valid, [key]: "x" }), key).toBe(false);
      expect(betaManifestSchema.safeParse({ provenance: valid, parts: [{ bytes: 10, lines: 2 }], [key]: "x" }).success, key).toBe(false);
      expect(betaManifestSchema.safeParse({ provenance: { ...valid, [key]: "x" }, parts: [{ bytes: 10, lines: 2 }] }).success, key).toBe(false);
      expect(betaManifestSchema.safeParse({ provenance: valid, parts: [{ bytes: 10, lines: 2, [key]: "x" }] }).success, key).toBe(false);
    }
    expect(ok({ ...valid, scrub: { ...valid.scrub, vin: 0 } })).toBe(false);
  });

  it("P5: provenanceLine is Python json.dumps form and parses back through parseRecording and the schema", () => {
    const line = provenanceLine(12.5, valid);
    const python = execFileSync(
      "uv",
      ["run", "--no-project", "python", "-c", "import json,sys; l=sys.stdin.read(); print(json.dumps(json.loads(l)) == l)"],
      { cwd: repoRoot, input: line, encoding: "utf8" },
    );
    expect(python.trim()).toBe("True");
    const [parsed] = parseRecording(line);
    expect(parsed).toMatchObject({ t: 12.5, dir: "meta" });
    expect(parsed.dir === "meta" && betaProvenanceSchema.parse(parsed.beta)).toEqual(valid);
  }, 60_000);
});
