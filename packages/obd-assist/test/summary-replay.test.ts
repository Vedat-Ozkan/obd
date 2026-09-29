import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { importObdbMode22 } from "../../obd-core/src/vehicles/index.js";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis } from "obd-battery/report";
import { summarize, type LlmClient, type SummaryRequest } from "obd-assist";
import { createClaimReplayArtifact, createSummaryReplayArtifact, reportForSavedCase, type SavedSummaryCase } from "../scripts/replay-summary.js";

const root = new URL("../../../", import.meta.url);
const fixturePath = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl";
const responses = JSON.parse(readFileSync(new URL("fixtures/synthetic/t2.10-summary-responses.json", root), "utf8")) as { readonly cases: readonly SavedSummaryCase[] };
const nameResponses = JSON.parse(readFileSync(new URL("fixtures/synthetic/x-2026-09-29-twelve-volt-name-responses.json", root), "utf8")) as { readonly label: string; readonly cases: readonly SavedSummaryCase[] };
const explanatory = JSON.parse(readFileSync(new URL("fixtures/synthetic/x-2026-09-29-explanatory-summary-responses.json", root), "utf8")) as { readonly label: string; readonly cases: readonly SavedSummaryCase[] };
const claimSplit = JSON.parse(readFileSync(new URL("fixtures/synthetic/x-2026-09-29-summary-claim-split-responses.json", root), "utf8")) as { readonly label: string; readonly cases: readonly SavedSummaryCase[] };
const phoneConsolePath = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl";
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
  "synthetic-dtc-modified-quantity-no-recording": "template",
  "twelve-volt-name-status-prose": "template",
  "twelve-volt-name-mid-sentence": "template",
  "twelve-volt-name-parenthesis": "template",
  "twelve-volt-name-sentence-end": "template",
  "twelve-volt-name-bare-reading": "template",
  "twelve-volt-name-transformed-reading": "template",
  "twelve-volt-name-exact-value-wrong-body": "template",
  "twelve-volt-name-with-quantity-body": "template",
  "twelve-volt-name-system": "template",
  "twelve-volt-name-supply": "template",
  "twelve-volt-name-plural": "template",
  "twelve-volt-name-possessive": "template",
  "twelve-volt-name-hyphenated": "template",
  "twelve-volt-name-no-space": "template",
  "twelve-volt-name-lowercase-v": "template",
  "twelve-volt-name-capital-noun": "template",
  "twelve-volt-name-nbsp": "template",
  "twelve-volt-name-double-space": "template",
  "twelve-volt-name-fullwidth-digits": "template",
  "twelve-volt-name-glued-digit": "template",
  "twelve-volt-name-glued-decimal": "template",
  "twelve-volt-name-glued-minus": "template",
  "twelve-volt-name-glued-plus": "template",
  "twelve-volt-name-other-digit": "template",
  "twelve-volt-name-uncited": "template",
  "placeholder-digit-outside": "template",
  "placeholder-numeral-fullwidth": "template",
  "placeholder-numeral-arabic-indic": "template",
  "placeholder-numeral-superscript": "template",
  "placeholder-numeral-fraction": "template",
  "placeholder-numeral-roman": "template",
  "synthetic-placeholder-dtc-outside-no-recording": "template",
  "placeholder-unknown": "template",
  "placeholder-uncited": "template",
  "placeholder-malformed-empty-id": "template",
  "placeholder-malformed-unclosed": "template",
  "placeholder-malformed-no-open-brace": "template",
  "placeholder-malformed-wrong-kind": "template",
  "placeholder-malformed-capital-kind": "template",
  "placeholder-malformed-space-after-colon": "template",
  "placeholder-malformed-space-before-kind": "template",
  "placeholder-malformed-double-braces": "template",
  "placeholder-malformed-extra-close": "template",
  "placeholder-malformed-nested": "template",
  "placeholder-malformed-fullwidth-braces": "template",
  "placeholder-malformed-id-97-characters": "template",
  // Boundary, documented (Stage 3b): a report fact ID written as a word in prose displays; IDs with a digit, "_" or "/" still fail the charset.
  "placeholder-id-in-prose": "llm",
  "placeholder-real-values": "llm",
  "placeholder-two-facts": "llm",
  "placeholder-relational-prose": "llm",
  "id-underscore-in-prose": "template"
};

// The displayed text of every accepted case, written out here rather than derived from the saved replies.
// Migrated cases keep the text they displayed before placeholders (X-2026-09-29-summary-placeholders, Stage 2, item 13).
const capacityProse = "Capacity is not measured because no completed charge log and reviewed capacity estimator are available.";
const expectedText: Readonly<Record<string, string>> = {
  "accepted": `The adapter supply measured 12.7 V.\n${capacityProse}\nThe community cell spread measured 0.003 volts.`,
  "synthetic-multi-dtc-no-recording": "Stored diagnostic code P0133 was reported.",
  "synthetic-multi-dtc-with-number-no-recording": "P0133 was stored, and adapter supply was 12.7 V.",
  "canonical-cell-spread": "Cell spread: 0.003 volts.",
  "ascii-outer-spaces": "The adapter supply measured 12.7 V.",
  "ordinary-prose-punctuation": "Capacity is not measured; health is not assessed (missing data), and that's honest!",
  "synthetic-negative-exact-no-recording": "Cell voltage (avg): -3.9297 volts.",
  "synthetic-zero-exact-no-recording": "Cell voltage (avg): 0 volts.",
  "spacing-outer-repeated-space": "The adapter supply measured 12.7 V.",
  "synthetic-dtc-canonical-no-recording": "stored diagnostic code: P0133.",
  "synthetic-dtc-grouped-no-recording": "Stored diagnostic codes P0133 and P0420 were reported.",
  "synthetic-dtc-after-quantity-no-recording": "The adapter supply measured 12.7 V; P0133 was stored.",
  "placeholder-real-values": "SoC: 69.8039 percent.\nCell spread: 0.003 volts, a community reading.\nThe adapter supply measured 12.7 V.\n12 V battery status is not-assessed.",
  "placeholder-two-facts": "Cell voltage (min): 3.9287 volts; Cell voltage (max): 3.9317 volts.\n0.003 volts, that is 0.003 volts.",
  // Boundary, documented and not a defect (Decision 6): relational prose around a rendered exact value is accepted.
  "placeholder-relational-prose": "Cell spread is less than 0.003 volts.",
  "placeholder-id-in-prose": "cell-spread is 0.003 volts.",
};


describe("summary recording replay", () => {
  let report: Awaited<ReturnType<typeof replayReport>>;
  beforeAll(async () => { report = await replayReport(); });

  // The v1 claim corpus (150+ grammar cases) runs through the shared claim checker and renderer, not the v2 summary path.
  it.each(responses.cases)("saved claim set $name", async (saved) => {
    const caseReport = reportForSavedCase(report, saved);
    const result = (await createClaimReplayArtifact(report, { cases: [saved] })).cases[0];
    expect(expectedKinds[saved.name]).toBeDefined();
    expect(result.kind).toBe(expectedKinds[saved.name]);
    if (expectedKinds[saved.name] === "llm") {
      expect(result.text).toBe(expectedText[saved.name]);
      if (saved.name === "accepted") {
        expect(result.text).toContain("12.7 V");
        expect(result.text).toContain("not measured");
        expect(result.text).toContain("community");
      }
      if (saved.report === "synthetic-multi-dtc-no-recording") expect(result.text).toContain("P0133");
      if (saved.name === "synthetic-multi-dtc-with-number-no-recording") expect(result.text).toContain("12.7 V");
      // Real numbers, computed from the report object without the projection: the rounding is the only step between them.
      if (saved.name === "placeholder-real-values") {
        const soc = report.signals.find((signal) => signal.id === "EQUINOXEV_SOC");
        if (!soc || !report.cellSpread) throw new Error("spike report lacks the SoC signal or the cell spread");
        const round = (value: number) => String(Math.round(value * 10000) / 10000);
        const lines = result.text.split("\n");
        expect(lines[0]).toBe(`SoC: ${round(soc.value)} ${soc.unit}.`);
        expect(lines[1]).toBe(`Cell spread: ${round(report.cellSpread.volts)} volts, a community reading.`);
        expect(lines[2]).toBe(`The adapter supply measured ${round(report.twelveVolt.observations[0].volts)} V.`);
      }
    } else {
      expect(result).toEqual({ name: saved.name, kind: "template", text: renderBatteryDiagnosis(caseReport) });
    }
  });

  it("writes the claim replay artifact the public CLI helper produces", async () => {
    const artifact = await createClaimReplayArtifact(report, responses);
    writeFileSync("/tmp/t2.10a-summary-replay.json", `${JSON.stringify(artifact, null, 2)}\n`);
    expect(artifact.fixture).toBe(fixturePath);
    expect(responses.cases.map((saved) => saved.name)).toEqual(Object.keys(expectedKinds));
    expect(new Set(responses.cases.map((saved) => saved.name)).size).toBe(responses.cases.length);
    expect(Object.keys(expectedText).sort()).toEqual(Object.entries(expectedKinds).filter(([, kind]) => kind === "llm").map(([name]) => name).sort());
  });
});

// SYNTHETIC reconstruction of claims quoted in docs/task-runs/T2.10.md; the raw provider reply was never saved.
// The 12 V name allowance is gone (X-2026-09-29-summary-placeholders): "12 V" outside a placeholder is a digit.
const nameExpected: Readonly<Record<string, { kind: "llm" | "template"; text?: string }>> = {
  "synthetic-reconstructed-deepseek-twelve-volt-names": { kind: "template" },
  "synthetic-reconstructed-false-reading": { kind: "template" },
  "placeholder-rewrite-of-reconstruction": { kind: "llm", text: [
    "12 V observations: not read.",
    "12 V battery status was not-assessed.",
    "Capacity was not measured because no completed charge log and reviewed capacity estimator are available.",
    "Battery health was not assessed.",
    "Cell spread is unavailable.",
  ].join("\n") },
  "placeholder-fact-absent-from-report": { kind: "template" },
  // Stage 3b: with no prose fact-ID guard, ordinary twelve-volt wording displays, cited or not.
  "prose-twelve-volt-battery": { kind: "llm", text: "12 V observations: not read; the twelve-volt battery was not checked." },
  "prose-twelve-volt-battery-status": { kind: "llm", text: "The twelve-volt battery status is not-assessed." },
};

describe("12 V name phrases on the phone-console recording (synthetic responses)", () => {
  let report: Awaited<ReturnType<typeof batteryDiagnosisFromRecording>>;
  beforeAll(async () => {
    report = await batteryDiagnosisFromRecording(readFileSync(new URL(phoneConsolePath, root), "latin1"), {
      garageVehicleId: "summary-replay", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z", recording: phoneConsolePath, scanStatus: "complete",
    }, signalset);
  });

  it("labels the fixture synthetic", () => {
    expect(nameResponses.label).toMatch(/^SYNTHETIC reconstruction .*not recorded model output$/);
  });

  it.each(nameResponses.cases)("saved response $name", async (saved) => {
    const expected = nameExpected[saved.name];
    expect(expected).toBeDefined();
    const result = (await createClaimReplayArtifact(report, { cases: [saved] })).cases[0];
    expect(result.kind).toBe(expected.kind);
    if (expected.kind === "llm") expect(result.text).toBe(expected.text);
    else expect(result).toEqual({ name: saved.name, kind: "template", text: renderBatteryDiagnosis(reportForSavedCase(report, saved)) });
  });

  it("writes the replay artifact the public CLI helper produces", async () => {
    const artifact = await createClaimReplayArtifact(report, nameResponses);
    writeFileSync("/tmp/x-twelve-volt-name-summary.json", `${JSON.stringify(artifact, null, 2)}\n`);
    expect(artifact.cases.map((item) => item.name)).toEqual(Object.keys(nameExpected));
  });
});

// Summary v2 (X-2026-09-29-explanatory-summary, Stage 2): the SYNTHETIC replies run through `summarize` on the real spike report.
// The whole displayed text is written out here, not derived from the saved reply.
const explanatoryText = `This parked check read the charge level, cell voltages, the supply voltage and trouble codes, but it cannot measure how much capacity the battery has left.

State of charge
Rating: Not rated. Basis: The app does not rate state of charge.
State of charge is how full the high-voltage battery is, like a fuel gauge. This check read SoC: 69.8039 percent; it shows the charge at the time of the check, not the battery's condition.

Cell balance
Rating: Not rated. Basis: No threshold yet.
Cell balance compares the highest and lowest cell voltages; a wide gap can point to a cell group that ages faster. Here the Cell spread is 0.003 volts, a community reading, and the app has no threshold to judge it yet.

Capacity
Rating: Not rated. Basis: No threshold yet.
Capacity is how much energy the battery can still hold, which sets the car's real driving range. It was not measured: No completed charge log and reviewed capacity estimator are available.

12 V battery
Rating: Not rated. Basis: No threshold yet.
The twelve-volt battery powers the car's computers and wakes the high-voltage system. The adapter supply measured 12.7 V. A load test or service check is needed to know the battery's condition.

Diagnostic codes
Rating: OK. Basis: Project policy: no codes reported, and whether codes were cleared recently is unknown.
Diagnostic trouble codes are fault records that the car's control modules store when they detect a problem. The recently cleared check answered unknown, so a buyer could ask whether codes were cleared before the sale.`;
const explanatoryCodesPoor = explanatoryText.replace(
  "Rating: OK. Basis: Project policy: no codes reported, and whether codes were cleared recently is unknown.",
  "Rating: Poor. Basis: Project policy: a reported code is Poor.");
const explanatoryKinds: Readonly<Record<string, "llm" | "template">> = {
  "explanatory-accepted": "llm", "explanatory-accepted-stored-code": "llm",
  "verdict-contradicts-rating": "template", "verdict-unrated-area": "template", "verdict-in-takeaway": "template",
  "verdict-matches-rating": "template", "verdict-capitalized": "template",
  "verdict-substring-boundary": "llm",
  "rating-fact-cited": "template", "rating-basis-cited": "template",
  "v2-digit-outside": "template", "v2-unknown-placeholder": "template", "v2-uncited-placeholder": "template",
  "shape-v1-claims": "template", "shape-missing-area": "template", "shape-wrong-order": "template", "shape-duplicate-area": "template", "shape-extra-area": "template",
  "shape-four-claims": "template", "shape-empty-area": "template", "shape-missing-takeaway": "template", "shape-takeaway-array": "template", "shape-version-1": "template",
};

describe("explanatory summary v2 on the spike recording (synthetic replies)", () => {
  let report: Awaited<ReturnType<typeof replayReport>>;
  beforeAll(async () => { report = await replayReport(); });

  it("labels the fixture synthetic", () => {
    expect(explanatory.label).toMatch(/^SYNTHETIC hand-written v2 summary replies; not recorded model output$/);
  });

  it.each(explanatory.cases)("saved reply $name", async (saved) => {
    const caseReport = reportForSavedCase(report, saved);
    let request: SummaryRequest | undefined;
    const client: LlmClient = { generate(input) { request = input; return Promise.resolve(saved.response); } };
    const result = await summarize(caseReport, client, { model: "saved-response", effort: "none" });
    expect(explanatoryKinds[saved.name]).toBeDefined();
    expect(result.kind).toBe(explanatoryKinds[saved.name]);
    // The projection carries the app's rating for every area, after the report's own facts.
    expect(request?.promptVersion).toBe("t2.10-v3");
    // The projection sent out carries no path, scan time, garage id, header or VIN, for real and synthetic-report cases alike.
    expect(JSON.stringify(request)).not.toMatch(/summary-replay|2026-09-22T00:00:00.000Z|2026-09-22-spike\.redacted|18DAF1|VIN/i);
    expect(request?.facts.slice(-10).map((fact) => fact.id)).toEqual(["soc", "cells", "capacity", "twelve-volt", "codes"].flatMap((prefix) => [`${prefix}-rating`, `${prefix}-rating-basis`]));
    if (result.kind === "template") {
      expect(result).toEqual({ kind: "template", text: renderBatteryDiagnosis(caseReport), reason: "Summary response could not be verified." });
      return;
    }
    if (saved.name === "explanatory-accepted") expect(result.text).toBe(explanatoryText);
    if (saved.name === "explanatory-accepted-stored-code") expect(result.text).toBe(explanatoryCodesPoor);
    if (saved.name === "verdict-substring-boundary") expect(result.text).toContain(" Take a look at the service records before buying.");
  });

  it("shows the template and no provider detail when the provider fails", async () => {
    const client: LlmClient = { generate: () => Promise.reject(new Error("provider detail must never be displayed")) };
    const result = await summarize(report, client, { model: "saved-response", effort: "none" });
    expect(result).toEqual({ kind: "template", text: renderBatteryDiagnosis(report), reason: "Summary response could not be verified." });
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });

  it("writes the replay artifact the public CLI helper produces", async () => {
    const artifact = await createSummaryReplayArtifact(report, explanatory);
    writeFileSync("/tmp/x-explanatory-spike.json", `${JSON.stringify(artifact, null, 2)}\n`);
    expect(artifact.promptVersion).toBe("t2.10-v3");
    expect(explanatory.cases.map((saved) => saved.name)).toEqual(Object.keys(explanatoryKinds));
    expect(artifact.cases.map((item) => [item.name, item.kind])).toEqual(Object.entries(explanatoryKinds));
  });
});

// Summary v3 (X-2026-09-29-summary-claim-split): one sentence per claim, and four code roll-ups instead of per-module facts.
// The whole displayed text is written out here, not derived from the saved reply. Every reply is SYNTHETIC.
const splitCodesLine = "Stored diagnostic codes: none (5 of 5 modules read). Pending diagnostic codes: none (5 of 5 modules read); Permanent diagnostic codes: none (3 of 5 modules read). Readiness status: 5 of 5 modules read; the recently cleared check answered unknown.";
const splitText = `This parked check read the charge level, cell voltages, the supply voltage and trouble codes, but it cannot measure how much capacity the battery has left.

State of charge
Rating: Not rated. Basis: The app does not rate state of charge.
State of charge is how full the high-voltage battery is, like a fuel gauge. This check read SoC: 69.8039 percent. It shows the charge at the time of the check, not the battery's condition.

Cell balance
Rating: Not rated. Basis: No threshold yet.
Cell balance compares the highest and lowest cell voltages. A wide gap can point to a cell group that ages faster. Here the Cell spread is 0.003 volts, a community reading.

Capacity
Rating: Not rated. Basis: No threshold yet.
Capacity is how much energy the battery can still hold, which sets the car's real driving range. It was not measured: No completed charge log and reviewed capacity estimator are available.

12 V battery
Rating: Not rated. Basis: No threshold yet.
The twelve-volt battery powers the car's computers and wakes the high-voltage system. The adapter supply measured 12.7 V. A load test or service check is needed to know the battery's condition.

Diagnostic codes
Rating: OK. Basis: Project policy: no codes reported, and whether codes were cleared recently is unknown.
${splitCodesLine}`;
const splitTextStored = splitText
  .replace("Rating: OK. Basis: Project policy: no codes reported, and whether codes were cleared recently is unknown.", "Rating: Poor. Basis: Project policy: a reported code is Poor.")
  .replace("Stored diagnostic codes: none (5 of 5 modules read).", "Stored diagnostic codes: P0133, P0420 (5 of 5 modules read).");
const splitKinds: Readonly<Record<string, "llm" | "template">> = {
  "claim-split-accepted": "llm", "claim-split-accepted-stored-code": "llm", "claim-split-common": "llm",
  "synthetic-reconstructed-single-claim-areas": "template", "v2-era-module-citation": "template",
  // Boundary, documented (Decision A3), not a defect: a repeated {fact:ID} displays its correct value twice.
  "repeated-fact-in-claim": "llm",
};

describe("claim-split summary v3 on the spike recording (synthetic replies)", () => {
  let report: Awaited<ReturnType<typeof replayReport>>;
  beforeAll(async () => { report = await replayReport(); });

  it("labels the fixture synthetic", () => {
    expect(claimSplit.label).toBe("SYNTHETIC hand-written v3 summary replies, including a reconstruction of the diagnosed reply shape; not recorded model output");
  });

  it("projects four code roll-ups and no per-module code or readiness fact", async () => {
    let request: SummaryRequest | undefined;
    await summarize(report, { generate(input) { request = input; return Promise.resolve(undefined); } }, { model: "saved-response", effort: "none" });
    const ids = request?.facts.map((fact) => fact.id) ?? [];
    expect(ids.filter((id) => /^(codes|readiness)-\d/.test(id))).toEqual([]);
    expect(ids.slice(ids.indexOf("codes-recently-cleared"), -10)).toEqual(["codes-recently-cleared", "codes-stored", "codes-pending", "codes-permanent", "readiness"]);
    expect(ids).toHaveLength(28);
  });

  it.each(claimSplit.cases)("saved reply $name", async (saved) => {
    const caseReport = reportForSavedCase(report, saved);
    const client: LlmClient = { generate() { return Promise.resolve(saved.response); } };
    const result = await summarize(caseReport, client, { model: "saved-response", effort: "none" });
    expect(splitKinds[saved.name]).toBeDefined();
    expect(result.kind).toBe(splitKinds[saved.name]);
    if (result.kind === "template") {
      expect(result).toEqual({ kind: "template", text: renderBatteryDiagnosis(caseReport), reason: "Summary response could not be verified." });
      return;
    }
    if (saved.name === "claim-split-accepted") expect(result.text).toBe(splitText);
    if (saved.name === "claim-split-accepted-stored-code") expect(result.text).toBe(splitTextStored);
    if (saved.name === "claim-split-common") expect(result.text.split("\n").at(-1)).toBe(splitCodesLine);
    if (saved.name === "repeated-fact-in-claim") expect(result.text).toContain("The adapter supply measured 12.7 V at 12.7 V.");
  });

  it("writes the replay artifact the public CLI helper produces", async () => {
    const artifact = await createSummaryReplayArtifact(report, claimSplit);
    writeFileSync("/tmp/x-claim-split-spike-test.json", `${JSON.stringify(artifact, null, 2)}\n`);
    expect(artifact.promptVersion).toBe("t2.10-v3");
    expect(artifact.cases.map((item) => [item.name, item.kind])).toEqual(Object.entries(splitKinds));
  });
});
