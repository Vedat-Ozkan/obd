import { z } from "zod";
import type { StructuredSummary, SummaryFact, SummaryRequest } from "./summary.js";

const factSchema = z.strictObject({
  id: z.string().trim().min(1), label: z.string().trim().min(1), value: z.string().trim().min(1),
  unit: z.string().trim().min(1).optional(), tier: z.enum(["verified", "community"]).optional(), status: z.string().trim().min(1).optional(),
});
const requestSchema = z.strictObject({ version: z.literal(1), promptVersion: z.literal("t2.10-v1"), facts: z.array(factSchema) });
const summarySchema = z.strictObject({
  version: z.literal(1),
  claims: z.array(z.strictObject({ text: z.string().transform((text) => text.replace(/^ +| +$/g, "")).pipe(z.string().min(1)), factIds: z.array(z.string().trim().min(1)).min(1) })).min(1),
});

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

/** Validate a structured response only against the projection sent to a provider. */
export function checkSummaryFacts(request: SummaryRequest, response: unknown): StructuredSummary {
  requestSchema.parse(request);
  // Raw facts, not the parsed copy: boundary trimming must not authorize altered spellings.
  return checkFacts(request.facts, response);
}
