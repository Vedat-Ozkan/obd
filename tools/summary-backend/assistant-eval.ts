import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { askAssistant, type AssistantClient, type AssistantTurnRequest } from "../../packages/obd-assist/src/index.js";
import { buildDatasets, row, scoreExpectation, type QuestionSet, type SavedRound } from "../../packages/obd-assist/scripts/replay-assistant.js";
import { consentFor, pins, prepareAssistantTurn, type AssistantModel } from "./openrouter.js";

// Design: docs/specs/T2.11b-assistant-backend-live-eval.md, Eval CLI. Runs the frozen T2.11a question set once per arm against the local Worker.
// It never retries, and never prints or writes the development token or any provider key.

const root = new URL("../../", import.meta.url);
const openRouterBase = "https://openrouter.ai/api/v1";
const LIVE_LABEL = "RECORDED MODEL OUTPUT (live, scripted T2.11 questions; not synthetic, not an ELM327 recording)";
const DRY_LABEL = "SYNTHETIC dry-run replies through the test harness (not live model output; not an ELM327 recording)";

interface Options { url: string; questions: string; models: AssistantModel[]; capsUsd: number[]; out: string; saveReplies?: string; syntheticMetadataBase?: string }

function parseArgs(args: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const value = args.at(i + 1);
    if (!args[i].startsWith("--") || value === undefined) throw new Error(`bad argument ${args[i]}`);
    flags.set(args[i].slice(2), value);
  }
  const need = (name: string): string => flags.get(name) ?? (() => { throw new Error(`missing --${name}`); })();
  const models = need("models").split(",").map((name) => {
    if (!Object.hasOwn(pins, name)) throw new Error(`unpinned model ${name}`);
    return name as AssistantModel;
  });
  const capsUsd = need("max-spend-usd").split(",").map(Number);
  if (capsUsd.length !== models.length || capsUsd.some((cap) => !Number.isFinite(cap) || cap <= 0)) throw new Error("--max-spend-usd needs one positive number per model");
  return { url: need("url").replace(/\/$/, ""), questions: need("questions"), models, capsUsd, out: need("out"), saveReplies: flags.get("save-replies"), syntheticMetadataBase: flags.get("synthetic-metadata-base") };
}

const token = process.env.SUMMARY_DEV_TOKEN ?? "";
const usageSchema = z.object({ model: z.string(), inputTokens: z.number(), cachedInputTokens: z.number().nullable(), outputTokens: z.number(), reasoningTokens: z.number().nullable(), providerCostUsd: z.number().nullable(), estimatedUsd: z.number(), latencyMs: z.number() });
const turnResponse = z.object({ kind: z.enum(["reply", "fallback"]), reply: z.unknown().optional(), reason: z.string().optional(), usage: usageSchema.optional() });
const statusResponse = z.object({ headroomMicroUsd: z.number() });

interface Round {
  inputTokens: number | null; cachedInputTokens: number | null; reasoningTokens: number | null; outputTokens: number | null;
  providerCostUsd: number | null; estimatedUsd: number | null; reservationMicroUsd: number; providerLatencyMs: number | null; serverReason?: string;
}

async function spentMicroUsd(url: string): Promise<number> {
  const response = await fetch(`${url}/v1/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`status ${String(response.status)}`);
  return 1000000 - statusResponse.parse(await response.json()).headroomMicroUsd;
}

/** One client per question: every round is one POST with a fresh request ID; a server fallback throws so askAssistant falls back, and is kept for the record. */
function questionClient(url: string, model: AssistantModel) {
  const rounds: Round[] = [];
  const saved: SavedRound[] = [];
  const requests: AssistantTurnRequest[] = [];
  let stop = false;
  const client: AssistantClient = {
    async next(request) {
      requests.push(structuredClone(request));
      const reservationMicroUsd = prepareAssistantTurn(model, request).reservation.microUsd;
      let data: z.infer<typeof turnResponse>;
      try {
        const response = await fetch(`${url}/v1/assistant/turns`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000),
          body: JSON.stringify({ requestId: randomUUID(), model, consentVersion: consentFor(model), turn: request }),
        });
        data = turnResponse.parse(await response.json());
      } catch {
        rounds.push({ inputTokens: null, cachedInputTokens: null, reasoningTokens: null, outputTokens: null, providerCostUsd: null, estimatedUsd: null, reservationMicroUsd, providerLatencyMs: null, serverReason: "transport-error" });
        saved.push({ reject: "transport-error" });
        throw new Error("transport-error");
      }
      const u = data.usage;
      rounds.push({ inputTokens: u?.inputTokens ?? null, cachedInputTokens: u?.cachedInputTokens ?? null, reasoningTokens: u?.reasoningTokens ?? null, outputTokens: u?.outputTokens ?? null, providerCostUsd: u?.providerCostUsd ?? null,
        estimatedUsd: u?.estimatedUsd ?? null, reservationMicroUsd, providerLatencyMs: u?.latencyMs ?? null, ...data.kind === "fallback" ? { serverReason: data.reason ?? "unknown" } : {} });
      if (data.kind === "fallback" || u === undefined) {
        saved.push({ reject: data.reason ?? "unknown" });
        if (data.reason === "budget-exhausted" || data.reason === "unavailable") stop = true;
        throw new Error(data.reason ?? "unknown");
      }
      const usage = { model: u.model, inputTokens: u.inputTokens, cachedInputTokens: u.cachedInputTokens, outputTokens: u.outputTokens, costUsd: u.providerCostUsd };
      saved.push({ reply: data.reply, usage });
      return { reply: data.reply, usage };
    },
  };
  return { client, rounds, saved, requests, stopped: () => stop };
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const rate = (n: number, d: number) => ({ n, d, rate: d === 0 ? null : n / d });
const rounded = (value: number | null) => value === null ? null : Math.round(value * 1e9) / 1e9;

interface RunRow {
  id: string; status: string; dataset: string; dataTag: string; question: string; kind?: "answer" | "fallback"; reason?: string | null; serverReasons?: string[]; text?: string;
  trace?: { tool: string; sessionId: string | null; ok: boolean }[]; citedIds?: string[]; citationsResolve?: boolean; numbersMatch?: boolean; missingHonest?: boolean | null; expectationMet?: boolean | null;
  rounds?: Round[]; costUsd?: number | null; providerLatencyMs?: number | null; wallLatencyMs?: number;
}
interface Captured { requests: AssistantTurnRequest[]; trace: { tool: string; sessionId: string | null }[] }

/** q10 vs q04: the model inputs must be deep-equal at every round where the tool traces coincide, and the traces must be equal. */
function injection(clean: Captured | undefined, injected: Captured | undefined) {
  if (clean === undefined || injected === undefined) return { verdict: "NOT RUN" };
  const calls = (request: AssistantTurnRequest) => request.steps.map((step) => step.call);
  let inputsEqual = true;
  for (let i = 0; i < Math.min(clean.requests.length, injected.requests.length); i++) {
    if (isDeepStrictEqual(calls(clean.requests[i]), calls(injected.requests[i])) && !isDeepStrictEqual(clean.requests[i], injected.requests[i])) inputsEqual = false;
  }
  const tracesEqual = isDeepStrictEqual(clean.trace, injected.trace);
  if (inputsEqual && tracesEqual) return { verdict: "PASS" };
  return { verdict: "FAIL", cause: inputsEqual ? "nondeterminism: identical inputs, different traces" : "inputs differ where traces coincide", cleanTrace: clean.trace, injectedTrace: injected.trace };
}

function group(rows: readonly RunRow[]) {
  const ran = rows.filter((item) => item.status === "RUN");
  return {
    numberCheck: rate(ran.filter((item) => item.kind === "answer").length, ran.length),
    citationResolution: rate(ran.filter((item) => item.citationsResolve === true).length, ran.length),
    citationCorrectness: rate(ran.filter((item) => item.expectationMet === true).length, ran.filter((item) => item.expectationMet !== null && item.expectationMet !== undefined).length),
    missingHonesty: rate(ran.filter((item) => item.missingHonest === true).length, ran.filter((item) => item.missingHonest !== null && item.missingHonest !== undefined).length),
  };
}

function comparison(model: string, rows: readonly RunRow[], verdict: string) {
  const ran = rows.filter((item) => item.status === "RUN");
  const roundList = ran.flatMap((item) => item.rounds ?? []);
  const costs = ran.flatMap((item) => item.costUsd === null || item.costUsd === undefined ? [] : [item.costUsd]);
  const wall = ran.flatMap((item) => item.wallLatencyMs === undefined ? [] : [item.wallLatencyMs]);
  const provider = ran.flatMap((item) => item.providerLatencyMs === null || item.providerLatencyMs === undefined ? [] : [item.providerLatencyMs]);
  return {
    model, real: group(rows.filter((item) => item.dataTag === "real")), synthetic: group(rows.filter((item) => item.dataTag !== "real")), injection: verdict,
    reasoningRounds: { ...rate(roundList.filter((item) => (item.reasoningTokens ?? 0) > 0).length, roundList.length), unreported: roundList.filter((item) => item.reasoningTokens === null).length },
    // The spec's owner targets: about US$0.01 per cheap answer and US$0.05 per thorough one.
    cost: { answers: ran.length, unknown: ran.length - costs.length, medianUsd: rounded(median(costs)), maxUsd: costs.length ? Math.max(...costs) : null, totalUsd: rounded(costs.reduce((sum, value) => sum + value, 0)),
      overCheapTarget: costs.filter((value) => value > 0.01).length, overThoroughTarget: costs.filter((value) => value > 0.05).length },
    latency: { medianMs: median(wall), maxMs: wall.length ? Math.max(...wall) : null, providerMedianMs: median(provider), providerMaxMs: provider.length ? Math.max(...provider) : null },
  };
}

async function snapshots(models: readonly AssistantModel[], base: string) {
  const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
  const fetchedAt = new Date().toISOString();
  const result: Record<string, unknown> = {};
  let catalog: { raw: string; entries: Record<string, unknown>[] } | undefined;
  try {
    const raw = await (await fetch(`${base}/models`, { signal: AbortSignal.timeout(60000) })).text();
    catalog = { raw, entries: z.object({ data: z.array(z.record(z.string(), z.unknown())) }).parse(JSON.parse(raw)).data };
  } catch { /* Evidence only: a missing snapshot is recorded, and never stops the run. */ }
  for (const model of models) {
    const pin = pins[model];
    try {
      const raw = await (await fetch(`${base}/models/${model}/endpoints`, { signal: AbortSignal.timeout(60000) })).text();
      const endpoints = z.object({ data: z.object({ endpoints: z.array(z.record(z.string(), z.unknown())) }) }).parse(JSON.parse(raw)).data.endpoints;
      const endpoint = endpoints.find((item) => item.provider_name === pin.providerName && item.tag === pin.providerTag);
      const pricing = z.record(z.string(), z.unknown()).parse(endpoint?.pricing ?? {});
      const overrides = z.array(z.record(z.string(), z.unknown())).parse(pricing.overrides ?? []);
      const maxOf = (key: string) => Math.max(...[pricing, ...overrides].map((item) => Number(item[key] ?? 0)));
      const entry = catalog?.entries.find((item) => item.id === model);
      result[model] = {
        fetchedAt, catalogSha256: catalog ? sha(catalog.raw) : null, endpointsSha256: sha(raw), catalogCanonicalSlug: entry?.canonical_slug ?? null, canonicalSlug: pin.canonicalSlug, providerName: pin.providerName, providerTag: pin.providerTag,
        endpointFound: endpoint !== undefined, supportedParameters: endpoint?.supported_parameters ?? null, contextLength: endpoint?.context_length ?? null, maxCompletionTokens: endpoint?.max_completion_tokens ?? null,
        rates: { baseInputUsdPerToken: Number(pricing.prompt ?? NaN), baseOutputUsdPerToken: Number(pricing.completion ?? NaN), maxInputUsdPerToken: maxOf("prompt"), maxOutputUsdPerToken: maxOf("completion") },
        ceilingsUsdPerToken: { input: pin.inputTenthMicroUsdPerToken / 1e7, output: pin.outputTenthMicroUsdPerToken / 1e7 },
      };
    } catch { result[model] = { fetchedAt, error: "metadata unavailable", canonicalSlug: pin.canonicalSlug, providerName: pin.providerName, providerTag: pin.providerTag }; }
  }
  return result;
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseArgs(args);
  if (token.length === 0) throw new Error("SUMMARY_DEV_TOKEN is not set");
  const questionSet = JSON.parse(readFileSync(options.questions, "utf8")) as QuestionSet;
  const datasets = await buildDatasets(questionSet, root);
  const synthetic = options.syntheticMetadataBase !== undefined;
  const codeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
  const runDate = new Date().toISOString();
  const header = {
    codeSha, codeDirty: dirty, date: runDate, promptVersion: "t2.11-v1", adapterPromptVersion: "t2.11-openrouter-v1", questionSet: options.questions, questionSetLabel: questionSet.label,
    metadataSource: synthetic ? "synthetic harness metadata (not OpenRouter)" : openRouterBase, snapshots: await snapshots(options.models, options.syntheticMetadataBase ?? openRouterBase),
  };
  const arms: unknown[] = [];
  const comparisons: ReturnType<typeof comparison>[] = [];
  for (const [index, model] of options.models.entries()) {
    const pin = pins[model];
    const capMicroUsd = Math.round(options.capsUsd[index] * 1e6);
    const before = await spentMicroUsd(options.url);
    const rows: RunRow[] = [];
    const captured = new Map<string, Captured>();
    const savedQuestions: Record<string, SavedRound[]> = {};
    let stoppedBy: "spend cap" | "budget" | null = null;
    for (const q of questionSet.questions) {
      const data = datasets[q.dataset];
      const base = { id: q.id, dataset: q.dataset, dataTag: data.dataTag, question: q.question };
      if (stoppedBy === null && (await spentMicroUsd(options.url)) - before >= capMicroUsd) stoppedBy = "spend cap";
      if (stoppedBy !== null) { rows.push({ ...base, status: `NOT RUN (${stoppedBy})` }); continue; }
      const one = questionClient(options.url, model);
      const started = performance.now();
      const result = await askAssistant(data.sources, q.question, one.client);
      const wallLatencyMs = Math.round(performance.now() - started);
      const claims = result.kind === "answer" ? result.answer.claims.map((claim) => claim.text) : [];
      const scored = scoreExpectation(row(q.dataset, data.dataTag, q.question, { result, requests: one.requests, calls: one.requests.length }), q.expect, claims);
      const costs = one.rounds.map((item) => item.providerCostUsd);
      const latencies = one.rounds.map((item) => item.providerLatencyMs);
      rows.push({
        ...base, status: "RUN", kind: scored.kind, reason: scored.reason, serverReasons: one.rounds.flatMap((item) => item.serverReason === undefined ? [] : [item.serverReason]), text: scored.text,
        trace: scored.trace.map((step) => ({ tool: step.tool, sessionId: step.sessionId, ok: step.ok })), citedIds: scored.citedIds, citationsResolve: scored.citationsResolve, numbersMatch: scored.numbersMatch,
        missingHonest: scored.missingHonest, expectationMet: scored.expectationMet, rounds: one.rounds, wallLatencyMs,
        costUsd: costs.length === 0 || costs.some((value) => value === null) ? null : rounded(costs.reduce<number>((sum, value) => sum + (value ?? 0), 0)),
        providerLatencyMs: latencies.length === 0 || latencies.some((value) => value === null) ? null : latencies.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      });
      captured.set(q.id, { requests: one.requests, trace: scored.trace.map((step) => ({ tool: step.tool, sessionId: step.sessionId })) });
      savedQuestions[q.id] = one.saved;
      if (one.stopped()) stoppedBy = "budget";
    }
    const injectedSpec = questionSet.questions.find((q) => questionSet.datasets[q.dataset].injection !== undefined && q.repliesFrom !== undefined);
    const verdict = injectedSpec === undefined ? { verdict: "NOT RUN" } : injection(captured.get(injectedSpec.repliesFrom ?? ""), captured.get(injectedSpec.id));
    const after = await spentMicroUsd(options.url);
    let repliesFile: string | null = null;
    if (options.saveReplies !== undefined && rows.every((item) => item.status === "RUN")) {
      // Only a complete arm is written: CI replays every scripted question, so a partial file would break it. The file is never hand-edited.
      mkdirSync(options.saveReplies, { recursive: true });
      repliesFile = join(options.saveReplies, `t2.11-live-${model.split("/")[1]}.json`);
      writeFileSync(repliesFile, `${JSON.stringify({
        label: synthetic ? DRY_LABEL : LIVE_LABEL, model, canonicalSlug: pin.canonicalSlug, providerTag: pin.providerTag, promptVersion: "t2.11-v1", adapterPromptVersion: "t2.11-openrouter-v1",
        runDate, codeSha, evalArtifact: basename(options.out), questions: savedQuestions, adversarial: [],
      }, null, 2)}\n`);
    }
    arms.push({ model, pin: { canonicalSlug: pin.canonicalSlug, providerName: pin.providerName, providerTag: pin.providerTag }, maxSpendUsd: options.capsUsd[index], spentBeforeMicroUsd: before, spentAfterMicroUsd: after, stoppedBy, injection: verdict, repliesFile: repliesFile === null ? null : basename(repliesFile), rows });
    comparisons.push(comparison(model, rows, verdict.verdict));
    process.stdout.write(`${model}: ${String(rows.filter((item) => item.status === "RUN").length)}/${String(rows.length)} questions run, spent ${String(after - before)} micro-USD${stoppedBy === null ? "" : `, stopped (${stoppedBy})`}\n`);
  }
  writeFileSync(options.out, `${JSON.stringify({ label: synthetic ? DRY_LABEL : "LIVE paid eval through the local summary Worker", header, arms, comparison: comparisons }, null, 2)}\n`);
  process.stdout.write(`wrote ${options.out}\n${JSON.stringify(comparisons, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
