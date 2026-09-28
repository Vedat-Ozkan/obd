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

// Exact quantity/DTC grammar: T2.10a-exact-quantity-amendment, rules 2–6.
const eligibleLabel = (label: string): boolean => /^[A-Za-z ()-]+$/.test(label) && /^[A-Za-z(]/.test(label) && /[A-Za-z)]$/.test(label);

function acceptedBodies(cited: readonly SummaryFact[]): ReadonlySet<string> {
  const bodies = new Set<string>();
  const storedCodes: SummaryFact[] = [];
  for (const fact of cited) {
    if (fact.unit && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(fact.value) && /^[A-Za-z%]+(?:\/[A-Za-z%]+)?$/.test(fact.unit)) {
      const quantity = `${fact.value} ${fact.unit}`;
      if (eligibleLabel(fact.label)) bodies.add(`${fact.label}: ${quantity}`);
      if (fact.label === "adapter-supply 12 V supply" && fact.unit === "V") {
        bodies.add(`The adapter supply measured ${quantity}`);
        bodies.add(`adapter supply was ${quantity}`);
      }
      if (fact.label === "Cell spread" && fact.unit === "volts" && fact.tier === "community") {
        bodies.add(`The community cell spread measured ${quantity}`);
      }
    }
    // DTC alphabet/encoding: docs/ELM327.md, DTC 2-byte encoding.
    if (/^[PCBU][0-3][0-9A-F]{3}$/.test(fact.value)) {
      if (eligibleLabel(fact.label)) bodies.add(`${fact.label}: ${fact.value}`);
      if (fact.label === "stored diagnostic code") {
        bodies.add(`Stored diagnostic code ${fact.value} was reported`);
        bodies.add(`${fact.value} was stored`);
        storedCodes.push(fact);
      }
    }
  }
  for (const first of storedCodes) {
    for (const second of storedCodes) {
      if (first.id !== second.id && first.value !== second.value) {
        bodies.add(`Stored diagnostic codes ${first.value} and ${second.value} were reported`);
      }
    }
  }
  return bodies;
}

function checkClaim(text: string, cited: readonly SummaryFact[], allFactIds: ReadonlySet<string>): void {
  if ([...allFactIds].some((id) => text.includes(id))) throw new Error("summary claim includes a source identifier");
  // Only symbol-free prose gets this route; quantities and codes require full coverage.
  if (/^[\p{L}\p{M} .,;:!?'()\-]+$/u.test(text)) return;
  if (/[^\x20-\x7E]/.test(text) || text.includes("  ")) throw new Error("summary claim has unsupported whitespace or characters");
  const bodies = acceptedBodies(cited);
  if (!text.endsWith(".") || !text.slice(0, -1).split(/; |, and /).every((body) => bodies.has(body))) {
    throw new Error("summary claim has an unsupported quantity or DTC body");
  }
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
    const cited = claim.factIds.map((id) => facts.get(id));
    const knownFacts = cited.filter((fact): fact is SummaryFact => fact !== undefined);
    if (knownFacts.length !== cited.length) throw new Error("summary claim cites an unknown fact");
    checkClaim(claim.text, knownFacts, new Set(facts.keys()));
  }
  return parsedSummary;
}

/** Validate a structured response only against the projection sent to a provider. */
export function checkSummaryFacts(request: SummaryRequest, response: unknown): StructuredSummary {
  requestSchema.parse(request);
  // Raw facts, not the parsed copy: boundary trimming must not authorize altered spellings.
  return checkFacts(request.facts, response);
}
