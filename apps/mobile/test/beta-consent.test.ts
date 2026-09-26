// T2.9 Stage B failure C-1: docs/specs/T2.9-beta-data-upload.md Verification "Stage B", "Isolated consent test".
// The pin was computed from the spec's §Consent screen and §Privacy note drafts (quote markers removed, the title and
// switch lines as their own constants), not from consent.ts.
// Vitest runs in Node; Expo's mobile typecheck intentionally omits Node typings.
// @ts-expect-error Node built-in types are not part of the mobile compilation target.
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { CONSENT_VERSIONS } from "obd-core/recording/provenance";
import { CONSENT_SWITCH_LABEL, CONSENT_TEXT, CONSENT_TITLE, CONSENT_VERSION, PRIVACY_NOTE } from "../src/beta/consent.js";

const sha256 = createHash as (algorithm: "sha256") => { update(text: string): { digest(encoding: "hex"): string } };
const PINNED: Partial<Record<string, string>> = {
  "beta-1": "824356c8fa0b98284949762089db6060ce52438ecf4babe28ac4ccfa6a4b7c8b",
};

it("C-1: the consent and privacy text match the digest pinned for CONSENT_VERSION", () => {
  const digest = sha256("sha256").update(CONSENT_TITLE + CONSENT_SWITCH_LABEL + CONSENT_TEXT + PRIVACY_NOTE).digest("hex");
  expect(CONSENT_VERSIONS).toContain(CONSENT_VERSION);
  expect(digest, "bump CONSENT_VERSION and add it to CONSENT_VERSIONS").toBe(PINNED[CONSENT_VERSION]);
});
