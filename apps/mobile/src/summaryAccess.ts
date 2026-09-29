import type { SummaryRequest } from "obd-assist";

// C1 HTTP contract and D1 disclosure version, not beta consent.
export const SUMMARY_CONSENT_VERSION = "t2.10-openrouter-deepseek-v1";
export const SUMMARY_DISCLOSURE = "Send minimized, VIN-free battery report facts through OpenRouter (United States) to DeepSeek (mainland China) for an AI summary. These services may process or retain the facts under their privacy policies. The offline report stays available. You can stop future requests by withdrawing consent.";

// Exact C1 aliases, prompts and development policy bounds (T2.10d Sources).
export const SUMMARY_MODEL = "deepseek/deepseek-v4.1-flash";
export interface DevelopmentUsage {
  model: typeof SUMMARY_MODEL | "deepseek/deepseek-v4.1-flash-20260910";
  provider: "DeepSeek"; promptVersion: "t2.10-v1"; adapterPromptVersion: "t2.10-openrouter-v1";
  inputTokens: number; cachedInputTokens: number | null; outputTokens: number; reasoningTokens: number | null;
  providerCostUsd: number | null; estimatedUsd: number; latencyMs: number;
}
export interface DevelopmentBudget { uses: number; headroomMicroUsd: number; enabled: boolean; chargedOrReservedMicroUsd: number }
export interface SummaryAccessResult { kind: "llm" | "fallback"; summary?: unknown; usage: DevelopmentUsage | null }
export interface SummaryAccess {
  generate(request: SummaryRequest, requestId: string): Promise<SummaryAccessResult>;
  status(): Promise<DevelopmentBudget | null>;
  clear(): void;
}
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
const cost = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
function projectUsage(value: unknown): DevelopmentUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const u = value as Record<string, unknown>;
  if ((u.model !== SUMMARY_MODEL && u.model !== "deepseek/deepseek-v4.1-flash-20260910") || u.provider !== "DeepSeek" || u.promptVersion !== "t2.10-v1" || u.adapterPromptVersion !== "t2.10-openrouter-v1" || !integer(u.inputTokens, 1048576) || !integer(u.outputTokens, 1024) || !integer(u.latencyMs) || !cost(u.estimatedUsd)) return null;
  const cachedInputTokens = u.cachedInputTokens ?? null;
  const reasoningTokens = u.reasoningTokens ?? null;
  const providerCostUsd = u.providerCostUsd ?? null;
  if ((cachedInputTokens !== null && !integer(cachedInputTokens, u.inputTokens)) || (reasoningTokens !== null && !integer(reasoningTokens, u.outputTokens)) || (providerCostUsd !== null && !cost(providerCostUsd))) return null;
  return { model: u.model, provider: u.provider, promptVersion: u.promptVersion, adapterPromptVersion: u.adapterPromptVersion, inputTokens: u.inputTokens, cachedInputTokens, outputTokens: u.outputTokens, reasoningTokens, providerCostUsd, estimatedUsd: u.estimatedUsd, latencyMs: u.latencyMs };
}
function projectBudget(value: unknown): DevelopmentBudget | null {
  if (typeof value !== "object" || value === null) return null;
  const b = value as Record<string, unknown>;
  if (!integer(b.uses) || !integer(b.headroomMicroUsd, 1000000) || typeof b.enabled !== "boolean") return null;
  return { uses: b.uses, headroomMicroUsd: b.headroomMicroUsd, enabled: b.enabled, chargedOrReservedMicroUsd: 1000000 - b.headroomMicroUsd };
}
export class SummaryAccessError extends Error {
  constructor() { super("Summary service is unavailable."); }
}

function localOrigin(value: string): string | undefined {
  // Validate the spelling before URL canonicalization (which accepts 127.1,
  // octal and integer hostnames). Never accept credentials, query or paths.
  const match = /^(https?):\/\/(localhost|\d+\.\d+\.\d+\.\d+)(?::([1-9]\d{0,4}))?\/?$/.exec(value);
  if (!match) return;
  const [, , host, port] = match;
  if (port && Number(port) > 65535) return;
  if (host !== "localhost") {
    const parts = host.split(".");
    if (parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return;
    const [a, b] = parts.map(Number);
    if (!(a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) return;
  }
  return new URL(value).origin;
}

async function readResponse(response: Response): Promise<string> {
  // C1 bounds output at 32 KiB. Expo fetch may not expose a stream reader;
  // both the streaming and text response paths enforce the same byte bound.
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 32768) throw new Error("invalid response");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 32768) throw new Error("invalid response");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { void reader.cancel().catch(() => {}); }
}

/** Holds only the separate owner-entered development token, never a provider key. */
export function createDevelopmentSummaryAccess(options: { development: boolean; fetch: typeof globalThis.fetch }) {
  let origin: string | undefined;
  let token = "";
  return {
    configure(url: string, accessToken: string): void {
      origin = options.development ? localOrigin(url) : undefined;
      token = origin && accessToken.length >= 32 && !/[\r\n]/.test(accessToken) ? accessToken : "";
    },
    clear(): void { token = ""; origin = undefined; },
    async generate(request: SummaryRequest, requestId: string): Promise<SummaryAccessResult> {
      if (!options.development || !origin || !token) throw new SummaryAccessError();
      const body = JSON.stringify({ requestId, consentVersion: SUMMARY_CONSENT_VERSION, request });
      if (new TextEncoder().encode(body).byteLength > 16384) throw new Error("Summary response could not be verified.");
      const parsed = await document("/v1/summaries", "POST", 20000, body);
      if (typeof parsed !== "object" || parsed === null || !("kind" in parsed)) throw new Error("Summary response could not be verified.");
      const envelope = parsed as Record<string, unknown>;
      const usage = projectUsage(envelope.usage);
      if (envelope.kind === "fallback") return { kind: "fallback", usage };
      if (envelope.kind !== "llm" || !("summary" in envelope)) throw new Error("Summary response could not be verified.");
      return { kind: "llm", summary: envelope.summary, usage };
    },
    async status(): Promise<DevelopmentBudget | null> {
      if (!options.development || !origin || !token) return null;
      try { return projectBudget(await document("/v1/status", "GET", 2000)); }
      catch { return null; }
    },
  } satisfies SummaryAccess & { configure(url: string, accessToken: string): void };

  async function document(path: string, method: "POST" | "GET", deadlineMs: number, body?: string): Promise<unknown> {
    if (!origin || !token) throw new SummaryAccessError();
    const endpoint = `${origin}${path}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (method === "POST") headers["Content-Type"] = "application/json";
    try {
      return await Promise.race([
        (async () => {
          const response = await options.fetch(endpoint, { method, redirect: "error", signal: controller.signal, headers, ...(body === undefined ? {} : { body }) });
          if (!response.ok || response.redirected) throw new Error("invalid response");
          return JSON.parse(await readResponse(response)) as unknown;
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("invalid response")); }, deadlineMs); }),
      ]);
    } catch { throw new Error("Summary response could not be verified."); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
}
