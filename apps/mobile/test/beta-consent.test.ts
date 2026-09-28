// T2.9 Stage B failure C-1: docs/specs/T2.9-beta-data-upload.md Verification "Stage B", "Isolated consent test".
import { expect, it } from "vitest";
import { CONSENT_VERSIONS } from "obd-core/recording/provenance";
import { CONSENT_VERSION } from "../src/beta/consent.js";

it("C-1: CONSENT_VERSION is a known consent version", () => {
  expect(CONSENT_VERSIONS).toContain(CONSENT_VERSION);
});
