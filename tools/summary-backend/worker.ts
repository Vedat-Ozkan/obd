import { z } from "zod";
import { MAX_TOOL_CALLS, assistantReplySchema, type AssistantTurnRequest } from "../../packages/obd-assist/src/index.js";
import { consentFor, createOpenRouter, model as summaryModel, maxAssistantBodyBytes, maxSummaryBodyBytes, pins, prepareAssistantTurn, prepareSummary, readBounded, reservationFor, type AdapterOptions, type AdapterResult, type AssistantModel, type FailedCheck, type ModelPin, type SummaryFallback } from "./openrouter.js";

interface D1Result { meta: { changes: number }; results?: unknown[] }
interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  first<T>(): Promise<T | null>;
  all(): Promise<D1Result>;
  run(): Promise<D1Result>;
}
export interface SummaryDatabase { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<D1Result[]> }
export interface SummaryEnv {
  SUMMARY_DB?: SummaryDatabase;
  SUMMARY_DEV_ENABLED?: string; SUMMARY_DEV_HOST?: string; SUMMARY_DEV_TOKEN?: string;
  OPENROUTER_API_KEY?: string; SUMMARY_KEY_LIMIT_USD?: string; SUMMARY_BUDGET_MICRO_USD?: string;
  // "1" admits the comparison arms (assistant models other than the summary model) on the assistant route.
  SUMMARY_COMPARE_ENABLED?: string;
}
interface Budget { uses: number; spent: number; inflight: string | null; disabled: number }

const nonblank = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0);
const id = nonblank(96).regex(/^[\x21-\x7e]+$/);
const requestId = z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
const facts = z.array(z.strictObject({
  id, label: nonblank(160), value: nonblank(256), unit: nonblank(32).optional(), status: nonblank(64).optional(), tier: z.enum(["verified", "community"]).optional(),
})).max(64).refine((list) => new Set(list.map((fact) => fact.id)).size === list.length);
const requestSchema = z.strictObject({
  requestId,
  consentVersion: z.literal("t2.10-openrouter-deepseek-v1"),
  request: z.strictObject({ version: z.literal(1), promptVersion: z.literal("t2.10-v2"), facts }),
});
const tools = assistantReplySchema.properties.tool.enum.filter((name) => name !== null);
// Raw request cap; the outgoing body has its own cap (maxAssistantBodyBytes).
const maxRawAssistantBytes = 32768;
const models = Object.keys(pins) as AssistantModel[];
const assistantSchema = z.strictObject({
  requestId, model: z.enum(models), consentVersion: z.string(),
  turn: z.strictObject({ version: z.literal(1), promptVersion: z.literal("t2.11-v2"), question: nonblank(500), steps: z.array(z.strictObject({
    call: z.strictObject({ tool: z.enum(tools), sessionId: z.string().max(3).nullable() }),
    result: z.strictObject({ ok: z.boolean(), facts }),
  })).max(MAX_TOOL_CALLS) }),
});
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const fallback = (reason: SummaryFallback, status = 200) => json({ kind: "fallback", reason }, status);
/** The fallback after a paid call, both routes. `upstreamStatus` is a bare number and exists only for a provider-error, `failedCheck` a closed word and only for an invalid-response; no upstream or reply text is copied. */
const postCallFallback = (result: { reason?: SummaryFallback; usage?: unknown; upstreamStatus: number | null; failedCheck: FailedCheck | null }) => {
  const reason = result.reason ?? "invalid-response";
  return json({ kind: "fallback", reason, ...(result.usage ? { usage: result.usage } : {}), ...(reason === "provider-error" ? { upstreamStatus: result.upstreamStatus } : {}), ...(reason === "invalid-response" ? { failedCheck: result.failedCheck } : {}) });
};

function privateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function enabled(request: Request, env: SummaryEnv): boolean {
  const host = new URL(request.url).hostname;
  const peer = request.headers.get("cf-connecting-ip");
  return env.SUMMARY_DEV_ENABLED === "1" && !!env.SUMMARY_DEV_TOKEN && env.SUMMARY_DEV_TOKEN.length >= 32 &&
    !!env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY !== env.SUMMARY_DEV_TOKEN && !!env.SUMMARY_DB &&
    env.SUMMARY_DEV_HOST === host && (host === "localhost" || privateIpv4(host)) && (peer === null || privateIpv4(peer)) && env.SUMMARY_KEY_LIMIT_USD === "1" && env.SUMMARY_BUDGET_MICRO_USD === "1000000" &&
    ![...request.headers.keys()].some((header) => header === "cf-ray" || header === "forwarded" || header.startsWith("x-forwarded-"));
}
async function budget(db: SummaryDatabase): Promise<Budget> {
  const row = await db.prepare("SELECT uses, spent, inflight, disabled FROM summary_budget WHERE id=1").first<Budget>();
  if (!row) throw new Error("missing budget");
  return row;
}
async function reserve(db: SummaryDatabase, requestId: string, reservation: number): Promise<SummaryFallback | null> {
  // Both writes form one transaction. The acquisition ID guards the insert after
  // an unsuccessful conditional update; unique ID conflicts roll back the batch.
  const result = await db.batch([
    db.prepare("UPDATE summary_budget SET uses=uses+1, spent=spent+?, inflight=? WHERE id=1 AND disabled=0 AND inflight IS NULL AND spent+?<=1000000 AND NOT EXISTS (SELECT 1 FROM summary_requests WHERE request_id=?)").bind(reservation, requestId, reservation, requestId),
    db.prepare("INSERT INTO summary_requests (request_id,state,reservation,actual,error) SELECT ?, 'inflight', ?, NULL, NULL FROM summary_budget WHERE id=1 AND inflight=? AND changes()=1").bind(requestId, reservation, requestId),
  ]);
  if (result.length === 2 && result.every((entry) => entry.meta.changes === 1)) return null;
  if (await db.prepare("SELECT request_id FROM summary_requests WHERE request_id=?").bind(requestId).first()) return "already-requested";
  const row = await budget(db);
  if (row.disabled || row.inflight) return "unavailable";
  return row.spent + reservation > 1000000 ? "budget-exhausted" : "unavailable";
}
/** The `error` column: a bare reason, plus the upstream status or the failed check when one is known. */
function storedError(result: Pick<AdapterResult, "reason" | "upstreamStatus" | "failedCheck">): string | null {
  if (result.reason === "provider-error" && result.upstreamStatus !== null) return `provider-error:${String(result.upstreamStatus)}`;
  if (result.reason === "invalid-response" && result.failedCheck !== null) return `invalid-response:${result.failedCheck}`;
  return result.reason ?? null;
}
async function settle(db: SummaryDatabase, requestId: string, reservation: number, result: Pick<AdapterResult, "actualMicroUsd" | "kill" | "reason" | "upstreamStatus" | "failedCheck">): Promise<void> {
  // The update uses the still-inflight request; a second settlement changes nothing.
  const charged = result.actualMicroUsd ?? reservation;
  const adjusted = result.kill ? Math.max(charged, reservation) : charged;
  const writes = await db.batch([
    db.prepare("UPDATE summary_budget SET spent=spent-?+?, inflight=NULL, disabled=MAX(disabled,?) WHERE id=1 AND inflight=? AND EXISTS (SELECT 1 FROM summary_requests WHERE request_id=? AND state='inflight')").bind(reservation, adjusted, result.kill ? 1 : 0, requestId, requestId),
    db.prepare("UPDATE summary_requests SET state='settled',actual=?,error=? WHERE request_id=? AND state='inflight' AND changes()=1").bind(result.actualMicroUsd, storedError(result), requestId),
  ]);
  if (writes.length !== 2 || !writes.every((entry) => entry.meta.changes === 1)) throw new Error("unsettled request");
}

/** Everything before a paid call, shared by both routes: replay, one-in-flight, budget, provider preflight, then the reservation. */
async function admit(db: SummaryDatabase, key: string, adapter: ReturnType<typeof createOpenRouter>, requestId: string, reservation: number, pin: ModelPin): Promise<SummaryFallback | null> {
  const seen = await db.prepare("SELECT request_id FROM summary_requests WHERE request_id=?").bind(requestId).first();
  if (seen) return "already-requested";
  const current = await budget(db);
  if (current.disabled || current.inflight) return "unavailable";
  if (current.spent + reservation > 1000000) return "budget-exhausted";
  try { await adapter.preflight(key, reservation, pin); } catch { return "unavailable"; }
  return reserve(db, requestId, reservation);
}

export function createSummaryWorker(options: AdapterOptions = { fetch: globalThis.fetch.bind(globalThis), now: Date.now }) {
  const adapter = createOpenRouter(options);
  async function assistantTurn(request: Request, env: SummaryEnv, db: SummaryDatabase, key: string): Promise<Response> {
    let input: z.infer<typeof assistantSchema>;
    try {
      const parsed = JSON.parse(await readBounded(request, maxRawAssistantBytes)) as unknown;
      if (typeof parsed === "object" && parsed !== null && "model" in parsed && typeof parsed.model === "string" && models.some((name) => name === parsed.model)) {
        // The comparison arms exist only while the owner switches them on; each arm has its own consent.
        if (parsed.model !== summaryModel && env.SUMMARY_COMPARE_ENABLED !== "1") return fallback("unavailable", 503);
        if (!("consentVersion" in parsed) || parsed.consentVersion !== consentFor(parsed.model as AssistantModel)) return fallback("consent-required", 400);
      }
      input = assistantSchema.parse(parsed);
    } catch { return fallback("invalid-request", 400); }
    const turn: AssistantTurnRequest = input.turn;
    const prepared = prepareAssistantTurn(input.model, turn);
    if (prepared.bodyBytes > maxAssistantBodyBytes) return fallback("invalid-request", 400);
    const reservation = prepared.reservation.microUsd;
    const denied = await admit(db, key, adapter, input.requestId, reservation, pins[input.model]);
    if (denied) return fallback(denied);
    const result = await adapter.generateAssistantTurn(input.model, turn, prepared, key);
    await settle(db, input.requestId, reservation, result);
    if (result.reply) return json({ kind: "reply", reply: result.reply, usage: result.usage });
    return postCallFallback(result);
  }
  return { async fetch(request: Request, env: SummaryEnv): Promise<Response> {
    if (!enabled(request, env)) return fallback("unavailable", 503);
    if (request.headers.get("Authorization") !== `Bearer ${env.SUMMARY_DEV_TOKEN ?? ""}`) return fallback("unauthorized", 401);
    const db = env.SUMMARY_DB;
    const key = env.OPENROUTER_API_KEY;
    if (!db || !key) return fallback("unavailable", 503);
    try {
      const path = new URL(request.url).pathname;
      if (path === "/v1/status" && request.method === "GET") {
        const row = await budget(db);
        return json({ uses: row.uses, headroomMicroUsd: Math.max(0, 1000000 - row.spent), enabled: !row.disabled && !row.inflight && row.spent + reservationFor(maxSummaryBodyBytes).microUsd <= 1000000 });
      }
      if (path === "/v1/assistant/turns" && request.method === "POST") return await assistantTurn(request, env, db, key);
      if (path !== "/v1/summaries" || request.method !== "POST") return fallback("invalid-request", 400);
      let input: z.infer<typeof requestSchema>;
      try {
        const parsed = JSON.parse(await readBounded(request, 16384)) as unknown;
        if (typeof parsed === "object" && parsed !== null && (!('consentVersion' in parsed) || parsed.consentVersion !== "t2.10-openrouter-deepseek-v1")) return fallback("consent-required", 400);
        input = requestSchema.parse(parsed);
      } catch { return fallback("invalid-request", 400); }
      // The reservation comes from the exact outgoing body, before any D1 access.
      const prepared = prepareSummary(input.request);
      if (prepared.bodyBytes > maxSummaryBodyBytes) return fallback("invalid-request", 400);
      const reservation = prepared.reservation.microUsd;
      const denied = await admit(db, key, adapter, input.requestId, reservation, pins[summaryModel]);
      if (denied) return fallback(denied);
      const result = await adapter.generate(input.request, prepared, key);
      await settle(db, input.requestId, reservation, result);
      if (result.summary) return json({ kind: "llm", summary: result.summary, usage: result.usage });
      return postCallFallback(result);
    } catch { return fallback("unavailable", 503); }
  } };
}

const worker = createSummaryWorker();
// Wrangler's module entry requires a default export; the factory is the named API.
export default worker;
