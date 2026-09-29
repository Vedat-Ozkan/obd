// @ts-expect-error Node-only fixture runner; Expo deliberately omits Node globals.
import { readFileSync as nodeReadFileSync, writeFileSync as nodeWriteFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { importObdbMode22 } from "obd-core/vehicles";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis, type BatteryDiagnosisReport } from "obd-battery/report";
import { prepareSummaryRequest } from "obd-assist";
import { createDevelopmentSummaryAccess, SUMMARY_CONSENT_VERSION } from "../src/summaryAccess.js";
import { createDevelopmentSummaryFlow, type SummaryView } from "../src/summaryFlow.js";

const readFileSync = nodeReadFileSync as { (path: URL, encoding: string): string; (path: URL): Uint8Array };
const writeFileSync = nodeWriteFileSync as (path: string, text: string) => void;
const bodyText = (init: RequestInit) => { if (typeof init.body !== "string") throw new Error("Expected JSON request body"); return init.body; };

const root = new URL("../../../", import.meta.url);
const paths = ["2026-09-22-spike", "2026-09-22-spike-2", "2026-09-24-phone-console"].map((name) => `fixtures/recordings/chevrolet-equinox-ev-2024/${name}.redacted.jsonl`);
const responses = JSON.parse(readFileSync(new URL("fixtures/synthetic/t2.10-summary-responses.json", root), "utf8")) as { cases: { name: string; response: unknown }[] };
const signalset = importObdbMode22(JSON.parse(readFileSync(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")));
const token = "synthetic-development-access-token-not-a-provider-key";
const url = "http://192.168.1.20:8788";
const rows: Record<string, unknown>[] = [];
let reports: BatteryDiagnosisReport[];
const ids = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const validUsage = { model: "deepseek/deepseek-v4.1-flash-20260910", provider: "DeepSeek", promptVersion: "t2.10-v1", adapterPromptVersion: "t2.10-openrouter-v1", inputTokens: 200, cachedInputTokens: 50, outputTokens: 20, reasoningTokens: 0, providerCostUsd: 0.000084, estimatedUsd: 0.000084, latencyMs: 17 };
const validBudget = { uses: 5, headroomMicroUsd: 999916, enabled: true };
const expectedBudget = { ...validBudget, chargedOrReservedMicroUsd: 84 };
const accepted = { version: 1, claims: [{ text: "Capacity is not measured because no completed charge log and reviewed capacity estimator are available.", factIds: ["capacity-status", "capacity-reason"] }] };

function harness(reply: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = () => Promise.resolve(Response.json({ kind: "llm", summary: accepted, usage: validUsage })), development = true, statusReply: () => Promise<Response> = () => Promise.resolve(Response.json(validBudget)), nextRequestId?: () => string) {
  const sent: { url: string; init: RequestInit }[] = [];
  const statusSent: { url: string; init: RequestInit }[] = [];
  let sequence = 0;
  let clock = 100;
  const access = createDevelopmentSummaryAccess({ development, fetch: async (input, init) => {
    const entry = { url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init: init ?? {} };
    if (entry.init.method === "GET") { statusSent.push(entry); return statusReply(); }
    sent.push(entry); return reply(input, init);
  } });
  access.configure(url, token);
  const flow = createDevelopmentSummaryFlow({ access, nextRequestId: nextRequestId ?? (() => ids(++sequence)), now: () => { clock += 25; return clock; } });
  const record = (name: string, view: SummaryView, source = "synthetic") => {
    rows.push({ source, name, state: view.kind, text: view.text, template: view.template, reason: view.reason, evidence: view.evidence, consentVersion: SUMMARY_CONSENT_VERSION, requestCount: sent.length, postCount: sent.length, statusCount: statusSent.length, requestIds: sent.map((entry) => (JSON.parse(bodyText(entry.init)) as { requestId: string }).requestId) });
  };
  return { access, flow, sent, statusSent, record };
}
function exactTemplate(view: SummaryView, report = reports[0], reason = "Summary response could not be verified.") {
  expect(view).toEqual({ kind: "template", text: renderBatteryDiagnosis(report), template: renderBatteryDiagnosis(report), reason, evidence: view.evidence });
}

beforeAll(async () => {
  reports = await Promise.all(paths.map(async (path) => batteryDiagnosisFromRecording(readFileSync(new URL(path, root), "latin1"), {
    garageVehicleId: "private-garage-sentinel", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z", recording: path, scanStatus: "complete",
  }, signalset)));
});
afterAll(() => {
  const groups = [
    ...paths.map((path) => ({ source: "real", path, cases: rows.filter((row) => row.source === path) })),
    { source: "synthetic", label: "Synthetic HTTP responses and missing lifecycle/error branches; no provider call.", cases: rows.filter((row) => row.source === "synthetic") },
  ];
  writeFileSync("/tmp/t2.10d-mobile-flow.json", `${JSON.stringify({ version: 1, groups }, null, 2)}\n`);
});

describe("recording → public development flow → HTTP access → local checker", () => {
  it.each(paths.map((path, index) => ({ path, index })))("replays $path without transmitting private report identifiers", async ({ path, index }) => {
    const h = harness();
    expect(h.sent).toHaveLength(0);
    h.flow.consent(true);
    expect(h.sent).toHaveLength(0);
    const view = await h.flow.summaryFor(reports[index]);
    expect(view.kind).toBe("llm");
    expect(view.text).toBe(accepted.claims[0].text);
    expect(view.template).toBe(renderBatteryDiagnosis(reports[index]));
    expect(h.sent).toHaveLength(1);
    expect(h.statusSent).toHaveLength(1);
    expect(h.statusSent[0]).toMatchObject({ url: `${url}/v1/status`, init: { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${token}` } } });
    expect(h.statusSent[0].init.body).toBeUndefined();
    expect(view.evidence).toEqual({ version: 1, consentVersion: SUMMARY_CONSENT_VERSION, requestId: ids(1), requestedModel: "deepseek/deepseek-v4.1-flash", returnedModel: validUsage.model, configuredProvider: "DeepSeek", observedProvider: null, routingEvidence: "configured-pin-only", usage: validUsage, phoneLatencyMs: 25, budget: expectedBudget, displayCategory: "llm" });
    expect(h.sent[0].url).toBe(`${url}/v1/summaries`);
    expect(h.sent[0].init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    expect(JSON.parse(bodyText(h.sent[0].init))).toEqual({ requestId: ids(1), consentVersion: SUMMARY_CONSENT_VERSION, request: prepareSummaryRequest(reports[index]) });
    for (const secret of ["private-garage-sentinel", path, reports[index].scannedAt, "garageVehicleId", "recording", "catalogId", token]) expect(bodyText(h.sent[0].init)).not.toContain(secret);
    h.record("checked summary", view, path);
  });

  it("requires separate consent and a tap, then clears auth on withdrawal", async () => {
    const h = harness();
    exactTemplate(await h.flow.summaryFor(reports[0]), reports[0], "Consent is required.");
    h.flow.consent(false);
    exactTemplate(await h.flow.summaryFor(reports[0]), reports[0], "Consent is required.");
    h.flow.consent(true);
    expect(h.sent).toHaveLength(0);
    h.flow.withdraw();
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view, reports[0], "Summary service is unavailable.");
    expect(h.sent).toHaveLength(0);
    h.record("decline / consent without tap / withdrawn auth", view);
  });

  it.each(["wrong-number", "wrong-unit", "missing-citation", "malformed", "prefix-plus-minus", "prefix-less-equal"])("locally rejects synthetic %s HTTP output", async (name) => {
    const response = responses.cases.find((entry) => entry.name === name);
    expect(response).toBeDefined();
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: response?.response })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    h.record(name, view);
  });

  it("accepts the exact recorded adapter quantity after local checking", async () => {
    const summary = { version: 1, claims: [{ text: "The adapter supply measured 12.7 V.", factIds: ["twelve-volt-0"] }] };
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    expect(view.kind).toBe("llm");
    expect(view.text).toBe(summary.claims[0].text);
    h.record("exact recorded adapter quantity", view, paths[0]);
  });

  it.each(["unavailable", "unauthorized", "invalid-request", "consent-required", "no-credit", "budget-exhausted", "already-requested", "provider-error", "invalid-response"])("maps synthetic server %s to a fixed template reason", async (reason) => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "fallback", reason })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    h.record(reason, view);
  });

  it.each(["malformed-json", "unknown-kind", "oversized", "chunked-oversized", "redirect", "http-error", "offline"])("fails closed for synthetic %s transport", async (name) => {
    const h = harness(async () => {
      await Promise.resolve();
      if (name === "offline") throw new Error("private-provider-error-sentinel");
      if (name === "http-error") return Response.json({ kind: "llm", summary: accepted }, { status: 503 });
      if (name === "redirect") return new Response(null, { status: 302, headers: { Location: "https://openrouter.ai" } });
      if (name === "oversized") return new Response(" ".repeat(32769));
      if (name === "chunked-oversized") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(" ".repeat(16384))); controller.enqueue(new TextEncoder().encode(" ".repeat(16385))); controller.close(); } }));
      return new Response(name === "malformed-json" ? "private-provider-error-sentinel" : JSON.stringify({ kind: "unknown", summary: accepted }));
    });
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(view.text).not.toContain("private-provider-error-sentinel");
    h.record(name, view);
  });

  it("times out an unresolved synthetic HTTP request without automatic retry", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(async () => new Promise(() => {}));
      h.flow.consent(true);
      const pending = h.flow.summaryFor(reports[0]);
      await vi.advanceTimersByTimeAsync(20001);
      const view = await pending;
      exactTemplate(view);
      expect(h.sent).toHaveLength(1);
      h.record("timeout", view);
    } finally { vi.useRealTimers(); }
  });

  it("keeps one stable ID during duplicate taps and uses a new ID for a fresh explicit attempt", async () => {
    let resolve!: (response: Response) => void;
    const h = harness(async () => new Promise<Response>((done) => { resolve = done; }));
    h.flow.consent(true);
    const pending = h.flow.summaryFor(reports[0]);
    const duplicate = await h.flow.summaryFor(reports[0]);
    exactTemplate(duplicate, reports[0], "A summary request is already active.");
    expect(h.sent).toHaveLength(1);
    resolve(Response.json({ kind: "llm", summary: accepted }));
    expect((await pending).kind).toBe("llm");
    const retry = h.flow.summaryFor(reports[0]);
    resolve(Response.json({ kind: "fallback", reason: "no-credit" }));
    exactTemplate(await retry);
    expect(h.sent.map((entry) => (JSON.parse(bodyText(entry.init)) as { requestId: string }).requestId)).toEqual([ids(1), ids(2)]);
    h.record("duplicate then explicit new attempt", duplicate);
  });

  it("same-ID HTTP retry is sent unchanged and rejected without trusting a returned retry summary", async () => {
    const h = harness((_input, init) => Promise.resolve(Response.json({ kind: "fallback", reason: (JSON.parse(bodyText(init ?? {})) as { requestId: string }).requestId === ids(1) ? "already-requested" : "unavailable" })), true, undefined, () => ids(1));
    const flow = h.flow;
    flow.consent(true);
    exactTemplate(await flow.summaryFor(reports[0]));
    const view = await flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(h.sent[0].init.body).toBe(h.sent[1].init.body);
    h.record("same-ID replay", view);
  });

  it.each(["withdraw", "report-navigation"])("discards synthetic pending completion after %s and clears auth", async (name) => {
    let resolve!: (response: Response) => void;
    const h = harness(async () => new Promise<Response>((done) => { resolve = done; }));
    h.flow.consent(true);
    const pending = h.flow.summaryFor(reports[0]);
    if (name === "withdraw") h.flow.withdraw();
    else exactTemplate(await h.flow.summaryFor(reports[1]), reports[1], "Consent is required.");
    resolve(Response.json({ kind: "llm", summary: accepted }));
    const view = await pending;
    exactTemplate(view, reports[0], "Summary request was discarded.");
    h.flow.consent(true);
    exactTemplate(await h.flow.summaryFor(name === "withdraw" ? reports[0] : reports[1]), name === "withdraw" ? reports[0] : reports[1], "Summary service is unavailable.");
    expect(h.sent).toHaveLength(1);
    h.record(name, view);
  });

  it.each(["release", "no-auth", "https://example.com", "http://8.8.8.8:8788", "http://192.168.1.20:8788/arbitrary", "http://192.168.1.20:8788?secret=bad", "http://token@localhost:8788", "http://localhost:8788#fragment", "http://127.1:8788", "http://2130706433:8788", "http://0177.0.0.1:8788", "http://172.32.0.1:8788", "http://192.169.1.1:8788"])("sends no facts with synthetic disabled/invalid setup %s", async (name) => {
    const h = harness(undefined, name !== "release");
    if (name === "no-auth") h.access.clear();
    else if (name !== "release") h.access.configure(name, token);
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view, reports[0], "Summary service is unavailable.");
    expect(h.sent).toHaveLength(0);
    expect(h.statusSent).toHaveLength(0);
    expect(view.evidence).toBeNull();
    h.record(name, view);
  });
});


describe("recording-backed development evidence capture (synthetic HTTP metadata)", () => {
  it.each(["fallback", "local-rejection"])("retains valid usage on %s without exposing hosted text", async (name) => {
    const usage = { ...validUsage, model: "deepseek/deepseek-v4.1-flash", cachedInputTokens: undefined, reasoningTokens: undefined, providerCostUsd: undefined };
    const h = harness(() => Promise.resolve(Response.json(name === "fallback" ? { kind: "fallback", reason: "private-evidence-sentinel", usage } : { kind: "llm", summary: { version: 1, claims: [{ text: "The adapter supply measured 99.9 V.", factIds: ["twelve-volt-0"] }] }, usage })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(view.evidence?.usage).toEqual({ ...validUsage, model: usage.model, cachedInputTokens: null, reasoningTokens: null, providerCostUsd: null });
    expect(view.evidence?.displayCategory).toBe("template");
    expect(JSON.stringify(view)).not.toContain("private-evidence-sentinel");
    h.record(`usage ${name}`, view);
  });

  const badFields: [string, unknown][] = [
    ["inputTokens", -1], ["inputTokens", 1.5], ["inputTokens", 1048577], ["inputTokens", null], ["outputTokens", 1025], ["outputTokens", -1],
    ["cachedInputTokens", 201], ["reasoningTokens", 21], ["providerCostUsd", -0.1], ["providerCostUsd", 1.01], ["estimatedUsd", null], ["estimatedUsd", 1.01],
    ["latencyMs", 1.5], ["latencyMs", -1], ["latencyMs", 9007199254740992], ["model", "private-evidence-sentinel"], ["provider", "private-evidence-sentinel"], ["promptVersion", "private-evidence-sentinel"], ["adapterPromptVersion", "private-evidence-sentinel"], ["model", "private-evidence-sentinel".repeat(1000)],
  ];
  it.each(badFields.map(([field, value], index) => ({ field, value, index })))("drops malformed usage $index $field independently of checked content", async ({ field, value, index }) => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: accepted, usage: { ...validUsage, [field]: value } })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    expect(view.kind).toBe("llm");
    expect(view.evidence?.usage).toBeNull();
    expect(view.evidence?.returnedModel).toBeNull();
    expect(JSON.stringify(view)).not.toContain("private-evidence-sentinel");
    h.record(`invalid usage ${String(index)} ${field}`, view);
  });

  it("projects only allowlisted metadata and never trusts the server request ID", async () => {
    const sentinel = "private-evidence-sentinel";
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: accepted, requestId: sentinel, rawError: sentinel, facts: sentinel, token: sentinel, usage: { ...validUsage, rawReply: sentinel, auth: token, facts: sentinel } })), true, () => Promise.resolve(Response.json({ ...validBudget, auth: token, rawReply: sentinel, summary: sentinel })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    expect(view.evidence?.requestId).toBe(ids(1));
    expect(view.evidence?.usage).toEqual(validUsage);
    expect(view.evidence?.budget).toEqual(expectedBudget);
    expect(view.evidence?.observedProvider).toBeNull();
    for (const secret of [sentinel, token]) expect(JSON.stringify(view)).not.toContain(secret);
    for (const secret of ["private-garage-sentinel", paths[0]]) expect(JSON.stringify(view.evidence)).not.toContain(secret);
    expect(new TextEncoder().encode(JSON.stringify(view.evidence)).byteLength).toBeLessThanOrEqual(4096);
    h.record("allowlisted metadata", view);
  });

  it("rejects invalid local UUID before either HTTP request", async () => {
    const h = harness(undefined, true, undefined, () => "private-evidence-sentinel");
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(view.evidence).toBeNull();
    expect(h.sent).toHaveLength(0);
    expect(h.statusSent).toHaveLength(0);
    h.record("invalid local UUID", view);
  });

  it.each(["401", "redirect", "malformed", "oversized", "offline", "bad-uses", "bad-headroom", "bad-enabled"])("keeps checked summary when status is %s", async (name) => {
    const h = harness(undefined, true, async () => {
      await Promise.resolve();
      if (name === "offline") throw new Error("private-evidence-sentinel");
      if (name === "401") return Response.json({ token: "private-evidence-sentinel" }, { status: 401 });
      if (name === "redirect") return new Response(null, { status: 302 });
      if (name === "malformed") return new Response("private-evidence-sentinel");
      if (name === "oversized") return new Response(" ".repeat(32769));
      return Response.json({ ...validBudget, ...(name === "bad-uses" ? { uses: -1 } : name === "bad-headroom" ? { headroomMicroUsd: -1 } : { enabled: "private-evidence-sentinel" }) });
    });
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    expect(view.kind).toBe("llm");
    expect(view.evidence?.budget).toBeNull();
    expect(h.sent).toHaveLength(1);
    expect(h.statusSent).toHaveLength(1);
    expect(h.statusSent[0].init.body).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("private-evidence-sentinel");
    h.record(`status ${name}`, view);
  });

  it("bounds status at two seconds without retrying or invalidating checked summary", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(undefined, true, () => new Promise(() => {}));
      h.flow.consent(true);
      const pending = h.flow.summaryFor(reports[0]);
      await vi.advanceTimersByTimeAsync(2001);
      const view = await pending;
      expect(view.kind).toBe("llm");
      expect(view.evidence?.phoneLatencyMs).toBe(25);
      expect(view.evidence?.budget).toBeNull();
      expect(h.sent).toHaveLength(1);
      expect(h.statusSent).toHaveLength(1);
      h.record("status timeout", view);
    } finally { vi.useRealTimers(); }
  });

  it("retains local UUID after POST timeout and labels reserved ledger separately", async () => {
    vi.useFakeTimers();
    try {
      const h = harness(() => new Promise(() => {}));
      h.flow.consent(true);
      const pending = h.flow.summaryFor(reports[0]);
      await vi.advanceTimersByTimeAsync(20001);
      const view = await pending;
      exactTemplate(view);
      expect(view.evidence?.requestId).toBe(ids(1));
      expect(view.evidence?.usage).toBeNull();
      expect(view.evidence?.budget).toEqual(expectedBudget);
      expect(h.sent).toHaveLength(1);
      expect(h.statusSent).toHaveLength(1);
      h.record("POST timeout with reservation snapshot", view);
    } finally { vi.useRealTimers(); }
  });

  it.each(["withdraw", "navigation", "credential-edit", "unmount"])("discards evidence after %s during status completion", async (name) => {
    let resolve!: (response: Response) => void;
    let started!: () => void;
    const statusStarted = new Promise<void>((done) => { started = done; });
    const h = harness(undefined, true, () => { started(); return new Promise((done) => { resolve = done; }); });
    h.flow.consent(true);
    const pending = h.flow.summaryFor(reports[0]);
    await statusStarted;
    if (name === "navigation") await h.flow.summaryFor(reports[1]);
    else { h.flow.withdraw(); if (name === "credential-edit") h.access.configure(url, "synthetic-replacement-access-token-0000000000"); }
    resolve(Response.json(validBudget));
    const view = await pending;
    exactTemplate(view, reports[0], "Summary request was discarded.");
    expect(view.evidence).toBeNull();
    expect(h.sent).toHaveLength(1);
    expect(h.statusSent).toHaveLength(1);
    h.record(`stale status ${name}`, view);
  });
});
