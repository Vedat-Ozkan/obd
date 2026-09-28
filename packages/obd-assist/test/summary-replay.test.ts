import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { importObdbMode22 } from "../../obd-core/src/vehicles/index.js";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis } from "obd-battery/report";
import { summarize, type LlmClient, type StructuredSummary, type SummaryRequest } from "obd-assist";
import { createSummaryReplayArtifact, reportForSavedCase, type SavedSummaryCase } from "../scripts/replay-summary.js";

const root = new URL("../../../", import.meta.url);
const fixturePath = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl";
const responses = JSON.parse(readFileSync(new URL("fixtures/synthetic/t2.10-summary-responses.json", root), "utf8")) as { readonly cases: readonly SavedSummaryCase[] };
const signalset = importObdbMode22(JSON.parse(readFileSync(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")));

async function replayReport() {
  return batteryDiagnosisFromRecording(readFileSync(new URL(fixturePath, root), "latin1"), {
    garageVehicleId: "summary-replay", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z", recording: fixturePath, scanStatus: "complete",
  }, signalset);
}

const expectedKinds: Readonly<Record<string, "llm" | "template">> = {
  "accepted": "llm",
  "wrong-number": "template",
  "wrong-unit": "template",
  "wrong-sign": "template",
  "wrong-unicode-minus": "template",
  "wrong-en-dash-minus": "template",
  "wrong-spaced-minus": "template",
  "missing-citation": "template",
  "malformed": "template",
  "synthetic-multi-dtc-no-recording": "llm",
  "synthetic-multi-dtc-with-number-no-recording": "llm",
  "provider-failure": "template",
  "canonical-cell-spread": "llm",
  "ascii-outer-spaces": "llm",
  "ordinary-prose-punctuation": "llm",
  "synthetic-negative-exact-no-recording": "llm",
  "synthetic-negative-absolute-no-recording": "template",
  "synthetic-negative-wrong-sign-no-recording": "template",
  "synthetic-negative-unicode-sign-no-recording": "template",
  "synthetic-negative-detached-sign-no-recording": "template",
  "synthetic-zero-exact-no-recording": "llm",
  "synthetic-zero-negative-no-recording": "template",
  "synthetic-zero-plus-no-recording": "template",
  "synthetic-zero-leading-no-recording": "template",
  "synthetic-zero-decimal-no-recording": "template",
  "prefix-plus-minus": "template",
  "prefix-spaced-plus-minus": "template",
  "prefix-less-equal": "template",
  "prefix-spaced-less-equal": "template",
  "prefix-less": "template",
  "prefix-spaced-less": "template",
  "prefix-greater": "template",
  "prefix-spaced-greater": "template",
  "prefix-ascii-less-equal": "template",
  "prefix-spaced-ascii-less-equal": "template",
  "prefix-ascii-greater-equal": "template",
  "prefix-spaced-ascii-greater-equal": "template",
  "prefix-greater-equal": "template",
  "prefix-spaced-greater-equal": "template",
  "prefix-not-equal": "template",
  "prefix-spaced-not-equal": "template",
  "prefix-equal": "template",
  "prefix-spaced-equal": "template",
  "prefix-at-least": "template",
  "prefix-at-most": "template",
  "prefix-less-than": "template",
  "prefix-more-than": "template",
  "prefix-no-more-than": "template",
  "prefix-tilde": "template",
  "prefix-spaced-tilde": "template",
  "prefix-approximately-symbol": "template",
  "prefix-spaced-approximately-symbol": "template",
  "prefix-similar-symbol": "template",
  "prefix-spaced-similar-symbol": "template",
  "prefix-ascii-plus-minus": "template",
  "prefix-spaced-ascii-plus-minus": "template",
  "prefix-about": "template",
  "prefix-approximately": "template",
  "prefix-roughly": "template",
  "prefix-around": "template",
  "prefix-up-to": "template",
  "suffix-or-less": "template",
  "suffix-or-more": "template",
  "suffix-approximately": "template",
  "suffix-plus-minus-zero": "template",
  "quantity-hyphen-range": "template",
  "quantity-en-dash-range": "template",
  "quantity-em-dash-range": "template",
  "quantity-to-range": "template",
  "quantity-between-range": "template",
  "quantity-closed-interval": "template",
  "quantity-open-interval": "template",
  "quantity-scientific-lower": "template",
  "quantity-scientific-upper": "template",
  "quantity-scientific-zero": "template",
  "quantity-scientific-superscript": "template",
  "quantity-fraction": "template",
  "quantity-unicode-fraction": "template",
  "quantity-multiply": "template",
  "quantity-group-comma": "template",
  "quantity-group-space": "template",
  "quantity-decimal-comma": "template",
  "quantity-leading-zero": "template",
  "quantity-extra-decimal": "template",
  "quantity-leading-point": "template",
  "quantity-trailing-point": "template",
  "quantity-double-point": "template",
  "quantity-missing-space": "template",
  "quantity-lower-unit": "template",
  "quantity-plus": "template",
  "quantity-em-dash-sign": "template",
  "quantity-fullwidth-plus": "template",
  "quantity-fullwidth-minus": "template",
  "quantity-zero-width": "template",
  "quantity-arabic-digits": "template",
  "quantity-fullwidth-digits": "template",
  "quantity-superscript": "template",
  "quantity-parenthesized": "template",
  "quantity-appended-percent": "template",
  "quantity-embedded-word": "template",
  "spacing-before-value-nbsp": "template",
  "spacing-before-unit-nbsp": "template",
  "spacing-outer-nbsp": "template",
  "spacing-before-value-thin": "template",
  "spacing-before-unit-thin": "template",
  "spacing-outer-thin": "template",
  "spacing-before-value-narrow": "template",
  "spacing-before-unit-narrow": "template",
  "spacing-outer-narrow": "template",
  "spacing-before-value-tab": "template",
  "spacing-before-unit-tab": "template",
  "spacing-outer-tab": "template",
  "spacing-before-value-newline": "template",
  "spacing-before-unit-newline": "template",
  "spacing-outer-newline": "template",
  "spacing-before-value-repeated-space": "template",
  "spacing-before-unit-repeated-space": "template",
  "spacing-outer-repeated-space": "llm",
  "whole-prefix": "template",
  "second-sentence": "template",
  "missing-terminal": "template",
  "double-terminal": "template",
  "unrelated-known-citation": "template",
  "unknown-citation": "template",
  "duplicate-citation": "template",
  "source-id-in-text": "template",
  "uncited-quantity": "template",
  "nominal-label-quantity": "template",
  "empty-claim": "template",
  "unexpected-schema-field": "template",
  "synthetic-dtc-canonical-no-recording": "llm",
  "synthetic-dtc-grouped-no-recording": "llm",
  "synthetic-dtc-after-quantity-no-recording": "llm",
  "synthetic-dtc-uncited-second-no-recording": "template",
  "synthetic-dtc-group-fact-no-recording": "template",
  "synthetic-dtc-lowercase-no-recording": "template",
  "synthetic-dtc-embedded-no-recording": "template",
  "synthetic-dtc-wrong-no-recording": "template",
  "synthetic-dtc-malformed-no-recording": "template",
  "synthetic-dtc-arbitrary-no-recording": "template",
  "synthetic-dtc-modified-quantity-no-recording": "template"
};


describe("summary recording replay", () => {
  let report: Awaited<ReturnType<typeof replayReport>>;
  beforeAll(async () => { report = await replayReport(); });

  it.each(responses.cases)("saved response $name", async (saved) => {
    const caseReport = reportForSavedCase(report, saved);
    let request: SummaryRequest | undefined;
    const client: LlmClient = {
      generate(input) {
        request = input;
        if (saved.providerFailure) return Promise.reject(new Error("provider detail must never be displayed"));
        return Promise.resolve(saved.response);
      },
    };
    const result = await summarize(caseReport, client, { model: "saved-response", effort: "none" });
    expect(request).toBeDefined();
    expect(JSON.stringify(request)).not.toMatch(/summary-replay|2026-09-22T00:00:00.000Z|2026-09-22-spike\.redacted|18DAF1|VIN/i);
    expect(expectedKinds[saved.name]).toBeDefined();
    expect(result.kind).toBe(expectedKinds[saved.name]);
    if (expectedKinds[saved.name] === "llm") {
      const summary = saved.response as StructuredSummary;
      const exactText = summary.claims.map((claim) => claim.text.replace(/^ +| +$/g, "")).join("\n");
      expect(result.text).toBe(exactText);
      if (saved.name === "accepted") {
        expect(result.text).toContain("12.7 V");
        expect(result.text).toContain("not measured");
        expect(result.text).toContain("community");
      }
      if (saved.report === "synthetic-multi-dtc-no-recording") expect(result.text).toContain("P0133");
      if (saved.name === "synthetic-multi-dtc-with-number-no-recording") expect(result.text).toContain("12.7 V");
    } else {
      expect(result).toEqual({ kind: "template", text: renderBatteryDiagnosis(caseReport), reason: "Summary response could not be verified." });
      expect(result.text).not.toContain("provider detail");
    }
  });

  it("produces the same canonical artifact as the public replay CLI helper", async () => {
    const results = [];
    for (const saved of responses.cases) {
      const result = await summarize(reportForSavedCase(report, saved), {
        generate: () => saved.providerFailure ? Promise.reject(new Error("saved failure")) : Promise.resolve(saved.response),
      }, { model: "saved-response", effort: "none" });
      results.push({ name: saved.name, kind: result.kind, text: result.text });
    }
    const artifact = {
      fixture: fixturePath,
      reportDigest: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
      promptVersion: "t2.10-v1",
      cases: results,
    };
    writeFileSync("/tmp/t2.10a-summary-replay.json", `${JSON.stringify(artifact, null, 2)}\n`);
    expect(await createSummaryReplayArtifact(report, responses)).toEqual(artifact);
    expect(responses.cases.map((saved) => saved.name)).toEqual(Object.keys(expectedKinds));
    expect(new Set(responses.cases.map((saved) => saved.name)).size).toBe(responses.cases.length);
  });
});
