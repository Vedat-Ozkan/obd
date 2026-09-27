import { z } from "zod";
import type { StructuredSummary, SummaryFact, SummaryRequest } from "./summary.js";

const factSchema = z.strictObject({
  id: z.string().trim().min(1), label: z.string().trim().min(1), value: z.string().trim().min(1),
  unit: z.string().trim().min(1).optional(), tier: z.enum(["verified", "community"]).optional(), status: z.string().trim().min(1).optional(),
});
const requestSchema = z.strictObject({ version: z.literal(1), promptVersion: z.literal("t2.10-v1"), facts: z.array(factSchema) });
const summarySchema = z.strictObject({
  version: z.literal(1),
  claims: z.array(z.strictObject({ text: z.string().trim().min(1), factIds: z.array(z.string().trim().min(1)).min(1) })).min(1),
});

function numericPhrase(fact: SummaryFact): string | undefined {
  return fact.unit && /^-?\d+(?:\.\d+)?$/.test(fact.value) ? `${fact.value} ${fact.unit}` : undefined;
}

function checkClaim(text: string, cited: readonly SummaryFact[], allFactIds: ReadonlySet<string>): void {
  if ([...allFactIds].some((id) => text.includes(id))) throw new Error("summary claim includes a source identifier");
  if (/\d+\s*[-–]\s*\d+/.test(text)) throw new Error("summary claim includes a range");
  const withoutDtcs = text.replace(/\b[A-Z][0-9A-F]{4}\b/g, (dtc) => {
    if (!cited.some((fact) => fact.value === dtc)) throw new Error("summary claim has an uncited DTC");
    return " ".repeat(dtc.length);
  });
  for (const match of withoutDtcs.matchAll(/(?:(?:-|−|–)\s*)?\d+(?:\.\d+)?/g)) {
    const value = match[0].replace(/[−–]/g, "-").replace(/\s/g, "");
    const unit = text.slice(match.index + match[0].length).match(/^\s+([^\s.,;:!?]+)/)?.[1];
    if (unit === undefined || !cited.some((fact) => numericPhrase(fact) === `${value} ${unit}`)) {
      throw new Error("summary claim has an unsupported number or unit");
    }
  }
}

/** Validate a structured response only against the projection sent to a provider. */
export function checkSummaryFacts(request: SummaryRequest, response: unknown): StructuredSummary {
  const parsedRequest = requestSchema.parse(request);
  const parsedSummary = summarySchema.parse(response);
  const facts = new Map(parsedRequest.facts.map((fact) => [fact.id, fact]));
  if (facts.size !== parsedRequest.facts.length) throw new Error("summary request has duplicate fact identifiers");
  for (const claim of parsedSummary.claims) {
    if (new Set(claim.factIds).size !== claim.factIds.length) throw new Error("summary claim repeats a citation");
    const cited = claim.factIds.map((id) => facts.get(id));
    const knownFacts = cited.filter((fact): fact is SummaryFact => fact !== undefined);
    if (knownFacts.length !== cited.length) throw new Error("summary claim cites an unknown fact");
    checkClaim(claim.text, knownFacts, new Set(facts.keys()));
  }
  return parsedSummary;
}
