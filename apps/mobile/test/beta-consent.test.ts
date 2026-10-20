import { expect, it } from "vitest";
import { CONSENT_VERSIONS } from "obd-core/recording/provenance";
import { CONSENT_VERSION } from "../src/beta/consent.js";

it("C-1: CONSENT_VERSION is a known consent version", () => {
  expect(CONSENT_VERSIONS).toContain(CONSENT_VERSION);
});
