import { z } from "zod";
import type { AreaSummary, StructuredSummary, SummaryArea, SummaryClaim, SummaryFact, SummaryRequest } from "./summary.js";

const factSchema = z.strictObject({
  id: z.string().trim().min(1), label: z.string().trim().min(1), value: z.string().trim().min(1),
  unit: z.string().trim().min(1).optional(), tier: z.enum(["verified", "community"]).optional(), status: z.string().trim().min(1).optional(),
});
const requestSchema = z.strictObject({ version: z.literal(1), promptVersion: z.literal("t2.10-v4"), facts: z.array(factSchema) });
const claimSchema = z.strictObject({ text: z.string().transform((text) => text.replace(/^ +| +$/g, "")).pipe(z.string().min(1)), factIds: z.array(z.string().trim().min(1)).min(1) });
const summarySchema = z.strictObject({ version: z.literal(1), claims: z.array(claimSchema).min(1) });
const areaSchema = <A extends SummaryArea>(area: A) => z.strictObject({ area: z.literal(area), claims: z.array(claimSchema).min(1).max(3) });
const areaSummarySchema = z.strictObject({
  version: z.literal(2), takeaway: claimSchema,
  areas: z.tuple([areaSchema("soc"), areaSchema("cells"), areaSchema("capacity"), areaSchema("twelveVolt"), areaSchema("codes")]),
});

// The five report areas in reply order. Titles are the app's own (reportView.ts labels); prefixes are the rating fact IDs' stems.
export const SUMMARY_AREAS: readonly { area: SummaryArea; title: string; prefix: string }[] = [
  { area: "soc", title: "State of charge", prefix: "soc" },
  { area: "cells", title: "Cell balance", prefix: "cells" },
  { area: "capacity", title: "Capacity", prefix: "capacity" },
  { area: "twelveVolt", title: "12 V battery", prefix: "twelve-volt" },
  { area: "codes", title: "Diagnostic codes", prefix: "codes" },
];
const ratingFactIds: ReadonlySet<string> = new Set(SUMMARY_AREAS.flatMap(({ prefix }) => [`${prefix}-rating`, `${prefix}-rating-basis`]));

// The model may not judge the car: the app prints the rating. Whole letter runs are compared, so "look" does not match "ok".
// Owner accepted this list on 2026-09-29 (X-2026-09-29-explanatory-summary, Decision 3), including occasional template fallbacks.
export const verdictWords: readonly string[] = [
  "great", "good", "ok", "okay", "poor", "bad", "fine", "healthy", "unhealthy", "excellent", "normal", "abnormal", "acceptable", "unacceptable",
  "concerning", "worrying", "alarming", "reassuring", "safe", "unsafe", "better", "worse", "best", "worst", "weak", "degraded", "failing", "faulty",
];

// The model never writes a value: it names a fact and the app renders it (X-2026-09-29-summary-placeholders).
// The ID class is printable ASCII without braces, at most the Worker's ID bound of 96.
const PLACEHOLDER = /\{(fact|label):([!-z|~]{1,96})\}/g;

/** The prompt text that teaches the placeholder grammar `checkClaim` enforces; prompts import it so they cannot drift from the checker. */
export const claimGrammar = `Claim text never contains digits, numbers or diagnostic codes. Write every value as a placeholder; the app replaces it with the report's exact text.
{fact:ID} becomes the fact's exact value, followed by its unit when it has one. {label:ID} becomes the fact's exact label; use it for any label that contains digits.
ID is a fact ID that the same claim cites in factIds. Example text: {label:ID}: {fact:ID}.
Outside placeholders, text may contain only letters, ASCII spaces and . , ; : ! ? ' ( ) -. Any other character rejects the whole reply.`;

function checkClaim(text: string, citedIds: ReadonlySet<string>, allFactIds: ReadonlySet<string>): void {
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!allFactIds.has(match[2])) throw new Error("summary claim names an unknown fact");
    if (!citedIds.has(match[2])) throw new Error("summary claim names an uncited fact");
  }
  const rest = text.replace(PLACEHOLDER, " ");
  // No fact-ID guard: IDs with a digit, "_" or "/" fail below, and the rest are words like "twelve-volt" that prose needs (Stage 3b).
  // Every Unicode number, brace, symbol and non-ASCII space fails here; every DTC contains a digit (docs/ELM327.md, DTC 2-byte encoding).
  if (!/^[\p{L}\p{M} .,;:!?'()\-]+$/u.test(rest)) throw new Error("summary claim has a digit, symbol or malformed placeholder outside a placeholder");
}

/** Rendered display text: one line per claim, every placeholder replaced in one pass with the fact's raw spelling. */
export function renderClaims(facts: readonly SummaryFact[], summary: StructuredSummary): string {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return summary.claims.map((claim) => claim.text.replace(PLACEHOLDER, (_match, kind: string, id: string) => {
    const fact = byId.get(id);
    if (fact === undefined) throw new Error("summary claim names an unknown fact");
    if (kind === "label") return fact.label;
    return fact.unit ? `${fact.value} ${fact.unit}` : fact.value;
  })).join("\n");
}

/** Validate a structured response only against the facts the caller actually supplied. */
export function checkFacts(supplied: readonly SummaryFact[], response: unknown): StructuredSummary {
  const parsedFacts = z.array(factSchema).parse(supplied);
  const parsedSummary = summarySchema.parse(response);
  // Boundary validation may trim strings; it must not authorize altered fact spellings.
  const facts = new Map<string, SummaryFact>(parsedFacts.map((fact, index) => [fact.id, {
    ...fact, label: supplied[index].label, value: supplied[index].value, unit: supplied[index].unit,
  }]));
  if (facts.size !== parsedFacts.length) throw new Error("summary request has duplicate fact identifiers");
  for (const claim of parsedSummary.claims) {
    if (new Set(claim.factIds).size !== claim.factIds.length) throw new Error("summary claim repeats a citation");
    if (claim.factIds.some((id) => !facts.has(id))) throw new Error("summary claim cites an unknown fact");
    checkClaim(claim.text, new Set(claim.factIds), new Set(facts.keys()));
  }
  return parsedSummary;
}

function checkAreaClaim(claim: SummaryClaim): void {
  if (claim.factIds.some((id) => ratingFactIds.has(id))) throw new Error("summary claim cites a rating fact");
  const prose = claim.text.replace(PLACEHOLDER, " ");
  for (const run of prose.matchAll(/[\p{L}\p{M}]+/gu)) {
    if (verdictWords.includes(run[0].toLowerCase())) throw new Error("summary claim contains a judging word");
  }
}

/** Validate a v2 reply only against the projection sent to a provider. */
export function checkSummaryFacts(request: SummaryRequest, response: unknown): AreaSummary {
  requestSchema.parse(request);
  const parsed = areaSummarySchema.parse(response);
  const claims = [parsed.takeaway, ...parsed.areas.flatMap((entry) => entry.claims)];
  // Raw facts, not the parsed copy: boundary trimming must not authorize altered spellings.
  checkFacts(request.facts, { version: 1, claims });
  claims.forEach(checkAreaClaim);
  return parsed;
}

/** Display text: the takeaway, then each area's title, the app's own rating line and the area's claims. Ratings come from `facts`, never from the reply. */
export function renderSummary(facts: readonly SummaryFact[], summary: AreaSummary): string {
  const value = (id: string): string => {
    const found = facts.find((fact) => fact.id === id);
    if (!found) throw new Error("summary is missing a rating fact");
    return found.value;
  };
  // Display only, after rendering, so the checker's input is unchanged: a claim starting with a reason clause reads as a sentence, and one ending in a bare clause is closed.
  const render = (claim: SummaryClaim) => {
    const text = renderClaims(facts, { version: 1, claims: [claim] });
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
  };
  return [
    render(summary.takeaway),
    ...SUMMARY_AREAS.flatMap(({ title, prefix }, index) => [
      "", title, `Rating: ${value(`${prefix}-rating`)}. Basis: ${value(`${prefix}-rating-basis`)}.`, summary.areas[index].claims.map(render).join(" "),
    ]),
  ].join("\n");
}
