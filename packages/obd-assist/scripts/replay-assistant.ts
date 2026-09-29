import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseRecording } from "../../obd-core/src/recording/format.js";
import { importObdbMode22 } from "../../obd-core/src/vehicles/index.js";
import { batteryDiagnosisFromRecording } from "obd-battery/report";
import { chargeLogFromRecording } from "obd-battery/session";
import {
  askAssistant, assistantInstructions, assistantReplySchema,
  type AssistantAnswer, type AssistantClient, type AssistantSource, type AssistantTurnRequest, type AssistantUsage,
} from "../src/index.js";

/** dropReads removes one command's reads (its tx line and the reply after it) with t in [fromT, toT], in memory only. */
export interface SourceSpec { kind: "battery-scan" | "charge-log"; recording: string; dropReads?: { command: string; fromT: number; toT: number } }
export interface DatasetSpec {
  dataTag: string;
  sources?: SourceSpec[];
  /** Dataset whose sources are rebuilt with the injection below applied to the first one, in memory only. */
  base?: string;
  injection?: { note: string; recordingName: string; realNoteFragment: string };
}
export interface QuestionSpec {
  id: string; dataset: string; question: string; repliesFrom?: string;
  expect: { kind: "answer"; mustCite?: string[]; text?: string; textIncludes?: string; missing?: { fact?: string } };
}
export interface QuestionSet { label: string; version: 1; datasets: Record<string, DatasetSpec>; questions: QuestionSpec[] }
export interface SavedRound { reply?: unknown; reject?: string; usage?: Omit<AssistantUsage, "latencyMs"> }
export interface SavedResponses {
  /** Provenance sentence, shown as the artifact note. */
  label: string;
  questions: Record<string, SavedRound[]>;
  adversarial: { name: string; dataset: string; question: string; rounds: SavedRound[] }[];
}
export interface Dataset { dataTag: string; sources: AssistantSource[]; recordings: string[] }
export interface UsageTotals { rounds: number; inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; costUsd: number | null; latencyMs: number }
export interface AssistantReplayRow {
  id?: string; name?: string; dataset: string; dataTag: string; question: string;
  kind: "answer" | "fallback"; reason: string | null; text: string;
  trace: { tool: string; sessionId: string | null; ok: boolean; facts: string[] }[];
  citedIds: string[]; citationsResolve: boolean; numbersMatch: boolean; missingHonest: boolean | null;
  expectationMet: boolean | null; clientCalls: number; usage: readonly AssistantUsage[]; totals: UsageTotals;
  injection?: { requestsEqualCleanRun: boolean; textAndTraceEqualCleanRun: boolean; sentinelAbsentFromRequests: boolean };
}
export interface AssistantReplayArtifact {
  promptVersion: "t2.11-v2"; assistantInstructions: string; replySchema: object; recordings: string[];
  note: string; sections: { real: AssistantReplayRow[]; synthetic: AssistantReplayRow[]; adversarial: AssistantReplayRow[] };
}

const SCANNED_AT = "2026-09-22T00:00:00.000Z";
const SIGNALSET = "packages/obd-core/vehicles/chevrolet-equinox-ev/default.json";

function dropReads(text: string, drop: { command: string; fromT: number; toT: number }): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] === "" ? undefined : (JSON.parse(lines[i]) as { dir: string; data?: string; t: number });
    if (line?.dir === "tx" && line.data === `${drop.command}\r` && line.t >= drop.fromT && line.t <= drop.toT) i++;
    else kept.push(lines[i]);
  }
  return kept.join("\n");
}

async function buildSource(spec: SourceSpec, root: URL, inject?: { note: string; recordingName: string }): Promise<AssistantSource> {
  const signals = importObdbMode22(JSON.parse(readFileSync(new URL(SIGNALSET, root), "utf8")));
  let text = readFileSync(new URL(spec.recording, root), "latin1");
  if (inject !== undefined) {
    // In memory only: fixtures/recordings/ is never written.
    const lines = text.split("\n");
    lines[0] = JSON.stringify({ ...(JSON.parse(lines[0]) as object), note: inject.note });
    text = lines.join("\n");
  }
  if (spec.dropReads !== undefined) text = dropReads(text, spec.dropReads);
  const recording = inject?.recordingName ?? spec.recording;
  const meta = parseRecording(text).find((line) => line.dir === "meta");
  const synthetic = meta?.dir === "meta" && meta.synthetic === true;
  if (spec.kind === "charge-log") return { kind: "charge-log", log: await chargeLogFromRecording(parseRecording(text), recording, signals) };
  const report = await batteryDiagnosisFromRecording(text, { garageVehicleId: "assistant-replay", catalogId: "chevrolet-equinox-ev-2024", scannedAt: SCANNED_AT, recording, scanStatus: "complete" }, signals);
  return { kind: "battery-scan", report, synthetic };
}

export async function buildDatasets(questionSet: QuestionSet, root: URL): Promise<Record<string, Dataset>> {
  const built: Record<string, Dataset> = {};
  for (const [name, spec] of Object.entries(questionSet.datasets)) {
    const specs = spec.sources ?? questionSet.datasets[spec.base ?? ""].sources ?? [];
    const sources = await Promise.all(specs.map((source, index) => buildSource(source, root, index === 0 ? spec.injection : undefined)));
    built[name] = { dataTag: spec.dataTag, sources, recordings: specs.map((source) => source.recording) };
  }
  return built;
}

/** Replays saved rounds through public askAssistant with a fixed stepping clock; records every request the client saw. */
export async function runSavedCase(sources: readonly AssistantSource[], question: string, rounds: readonly SavedRound[]): Promise<{ result: AssistantAnswer; requests: AssistantTurnRequest[]; calls: number }> {
  const requests: AssistantTurnRequest[] = [];
  const client: AssistantClient = {
    next(request) {
      requests.push(structuredClone(request));
      const round = rounds.at(requests.length - 1);
      if (round === undefined || round.reject !== undefined) return Promise.reject(new Error(round?.reject ?? "no saved reply left"));
      return Promise.resolve({ reply: round.reply, usage: round.usage ?? null });
    },
  };
  let clock = 0;
  const result = await askAssistant(sources, question, client, { now: () => (clock += 25) });
  return { result, requests, calls: requests.length };
}

// Any null round makes the total null: a partial sum would read as a real cost. No rounds is also null, not zero.
const total = (values: readonly (number | null)[]): number | null =>
  values.length === 0 || values.some((value) => value === null) ? null : Math.round(values.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 1e9) / 1e9;

function totals(usage: readonly AssistantUsage[]): UsageTotals {
  return {
    rounds: usage.length, inputTokens: total(usage.map((u) => u.inputTokens)), cachedInputTokens: total(usage.map((u) => u.cachedInputTokens)),
    outputTokens: total(usage.map((u) => u.outputTokens)), costUsd: total(usage.map((u) => u.costUsd)), latencyMs: total(usage.map((u) => u.latencyMs)) ?? 0,
  };
}

const factLine = (f: { id: string; value: string; unit?: string; status?: string }) => `${f.id}=${f.value}${f.unit ? ` ${f.unit}` : ""} (${f.status ?? "none"})`;

export function row(dataset: string, dataTag: string, question: string, run: Awaited<ReturnType<typeof runSavedCase>>): AssistantReplayRow {
  const { result } = run;
  const answered = result.kind === "answer";
  return {
    dataset, dataTag, question, kind: result.kind, reason: result.kind === "fallback" ? result.reason : null, text: result.text,
    trace: result.steps.map((step) => ({ tool: step.call.tool, sessionId: step.call.sessionId, ok: step.result.ok, facts: step.result.facts.map(factLine) })),
    citedIds: result.kind === "answer" ? [...new Set(result.answer.claims.flatMap((claim) => claim.factIds))] : [],
    // askAssistant returns an answer only after the shared checker passed both; a fallback proves neither.
    citationsResolve: answered, numbersMatch: answered, missingHonest: null, expectationMet: null,
    clientCalls: run.calls, usage: result.usage, totals: totals(result.usage),
  };
}

// Tests base.text, the rendered text the user sees: a raw claim would count the digit inside a placeholder ID such as {label:s2/cell-spread}.
export function scoreExpectation(base: AssistantReplayRow, expect: QuestionSpec["expect"]): AssistantReplayRow {
  const answered = base.kind === "answer";
  const missingHonest = expect.missing === undefined ? null
    : answered && (expect.missing.fact === undefined || base.citedIds.includes(expect.missing.fact)) && !/[0-9]/.test(base.text);
  const met = answered && (expect.mustCite ?? []).every((id) => base.citedIds.includes(id))
    && (expect.text === undefined || base.text === expect.text) && (expect.textIncludes === undefined || base.text.includes(expect.textIncludes))
    && missingHonest !== false;
  return { ...base, missingHonest, expectationMet: met };
}

export async function createAssistantReplayArtifact(questionSet: QuestionSet, responses: SavedResponses, root: URL): Promise<AssistantReplayArtifact> {
  const datasets = await buildDatasets(questionSet, root);
  const real: AssistantReplayRow[] = [];
  const synthetic: AssistantReplayRow[] = [];
  for (const q of questionSet.questions) {
    const rounds = responses.questions[q.repliesFrom ?? q.id];
    const data = datasets[q.dataset];
    const run = await runSavedCase(data.sources, q.question, rounds);
    let scored = { ...scoreExpectation(row(q.dataset, data.dataTag, q.question, run), q.expect), id: q.id };
    const injection = questionSet.datasets[q.dataset].injection;
    if (injection !== undefined) {
      const clean = await runSavedCase(datasets[questionSet.datasets[q.dataset].base ?? ""].sources, q.question, rounds);
      const serialized = JSON.stringify([clean.requests, run.requests]);
      scored = { ...scored, injection: {
        requestsEqualCleanRun: isDeepStrictEqual(run.requests, clean.requests),
        textAndTraceEqualCleanRun: run.result.text === clean.result.text && isDeepStrictEqual(run.result.steps, clean.result.steps),
        sentinelAbsentFromRequests: [injection.note, injection.recordingName, injection.realNoteFragment].every((secret) => !serialized.includes(secret)),
      } };
    }
    (data.dataTag === "real" ? real : synthetic).push(scored);
  }
  const adversarial: AssistantReplayRow[] = [];
  for (const a of responses.adversarial) {
    const data = datasets[a.dataset];
    adversarial.push({ name: a.name, ...row(a.dataset, data.dataTag, a.question, await runSavedCase(data.sources, a.question, a.rounds)) });
  }
  return {
    promptVersion: "t2.11-v2", assistantInstructions, replySchema: assistantReplySchema,
    recordings: [...new Set(Object.values(datasets).flatMap((data) => data.recordings))],
    note: responses.label,
    sections: { real, synthetic, adversarial },
  };
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length !== 2) throw new Error("usage: replay-assistant <question-set.json> <saved-responses.json>");
  const root = new URL("../../../", import.meta.url);
  const questionSet = JSON.parse(readFileSync(args[0], "utf8")) as QuestionSet;
  const responses = JSON.parse(readFileSync(args[1], "utf8")) as SavedResponses;
  process.stdout.write(`${JSON.stringify(await createAssistantReplayArtifact(questionSet, responses, root), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
