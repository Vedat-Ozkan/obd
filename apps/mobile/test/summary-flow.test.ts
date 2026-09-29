// @ts-expect-error Node-only fixture runner; Expo deliberately omits Node globals.
import { readFileSync as nodeReadFileSync, writeFileSync as nodeWriteFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { importObdbMode22 } from "obd-core/vehicles";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis, type BatteryDiagnosisReport } from "obd-battery/report";
import { ratingWord } from "obd-battery/rating";
import { prepareSummaryRequest } from "obd-assist";
import { reportSummary } from "../src/app/reportView.js";
import { createDevelopmentSummaryAccess, SUMMARY_CONSENT_VERSION } from "../src/summaryAccess.js";
import { createDevelopmentSummaryFlow, type SummaryView } from "../src/summaryFlow.js";

const readFileSync = nodeReadFileSync as { (path: URL, encoding: string): string; (path: URL): Uint8Array };
const writeFileSync = nodeWriteFileSync as (path: string, text: string) => void;
const bodyText = (init: RequestInit) => { if (typeof init.body !== "string") throw new Error("Expected JSON request body"); return init.body; };

const root = new URL("../../../", import.meta.url);
const paths = ["2026-09-22-spike", "2026-09-22-spike-2", "2026-09-24-phone-console"].map((name) => `fixtures/recordings/chevrolet-equinox-ev-2024/${name}.redacted.jsonl`);
// SYNTHETIC hand-written v2 replies; not recorded model output.
const responses = JSON.parse(readFileSync(new URL("fixtures/synthetic/x-2026-09-29-explanatory-summary-responses.json", root), "utf8")) as { cases: { name: string; response: unknown }[] };
// SYNTHETIC hand-written v3 replies, including a reconstruction of the diagnosed reply shape; not recorded model output.
const splitResponses = JSON.parse(readFileSync(new URL("fixtures/synthetic/x-2026-09-29-summary-claim-split-responses.json", root), "utf8")) as { cases: { name: string; response: unknown }[] };
function savedSplitReply(name: string): unknown {
  const found = splitResponses.cases.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing claim-split reply ${name}`);
  return found.response;
}
const savedReply = (name: string): unknown => {
  const found = responses.cases.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing saved reply ${name}`);
  return found.response;
};
const signalset = importObdbMode22(JSON.parse(readFileSync(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")));
const token = "synthetic-development-access-token-not-a-provider-key";
const url = "http://192.168.1.20:8788";
const rows: Record<string, unknown>[] = [];
let reports: BatteryDiagnosisReport[];
const ids = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const validUsage = { model: "deepseek/deepseek-v4.1-flash-20260910", provider: "DeepSeek", promptVersion: "t2.10-v3", adapterPromptVersion: "t2.10-openrouter-v6", inputTokens: 200, cachedInputTokens: 50, outputTokens: 20, reasoningTokens: 0, providerCostUsd: 0.000084, estimatedUsd: 0.000084, latencyMs: 17 };
const validBudget = { uses: 5, headroomMicroUsd: 999916, enabled: true };
const expectedBudget = { ...validBudget, chargedOrReservedMicroUsd: 84 };
const accepted = savedReply("explanatory-accepted");
// Cites only IDs all three recordings have; the full explanatory reply cites SoC and 12 V facts the other reports may lack. The codes area is three claims citing the roll-ups.
const commonReply = savedSplitReply("claim-split-common");

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
  // The card rating and basis the app itself shows for the report, recorded beside each displayed summary so the artifact pairs them.
  const record = (name: string, view: SummaryView, source = "synthetic", report: BatteryDiagnosisReport = reports[0]) => {
    const cards = view.kind === "llm" ? reportSummary(report).rows.map((row) => ({ label: row.label, rating: ratingWord[row.rating.rating], basis: row.rating.basis })) : undefined;
    rows.push({ source, name, state: view.kind, text: view.text, ...cards ? { cards } : {}, template: view.template, reason: view.reason, evidence: view.evidence, consentVersion: SUMMARY_CONSENT_VERSION, requestCount: sent.length, postCount: sent.length, statusCount: statusSent.length, requestIds: sent.map((entry) => (JSON.parse(bodyText(entry.init)) as { requestId: string }).requestId) });
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
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: commonReply, usage: validUsage })));
    expect(h.sent).toHaveLength(0);
    h.flow.consent(true);
    expect(h.sent).toHaveLength(0);
    const view = await h.flow.summaryFor(reports[index]);
    expect(view.kind).toBe("llm");
    // Five headed sections, each with the app's own rating line; the takeaway and prose come from the reply.
    expect(view.text.split("\n\n")).toHaveLength(6);
    for (const title of ["State of charge", "Cell balance", "Capacity", "12 V battery", "Diagnostic codes"]) expect(view.text).toContain(`\n\n${title}\nRating: `);
    for (const row of reportSummary(reports[index]).rows) expect(view.text).toContain(`\n\n${row.label}\nRating: ${ratingWord[row.rating.rating]}. Basis: ${row.rating.basis}.\n`);
    expect(view.text).not.toContain("{");
    // The codes area reads the four roll-ups, each with its coverage; the phone console read only stored.
    const codesLine = view.text.split("\n\n").at(-1)?.split("\n")[2];
    expect(codesLine).toContain("Stored diagnostic codes: none (5 of 5 modules read). ");
    if (index === 0) expect(codesLine).toBe("Stored diagnostic codes: none (5 of 5 modules read). Pending diagnostic codes: none (5 of 5 modules read); Permanent diagnostic codes: none (3 of 5 modules read). Readiness status: 5 of 5 modules read; the recently cleared check answered unknown.");
    if (index === 2) expect(codesLine).toBe("Stored diagnostic codes: none (5 of 5 modules read). Pending diagnostic codes: not read (0 of 5 modules read); Permanent diagnostic codes: not read (0 of 5 modules read). Readiness status: 0 of 5 modules read; the recently cleared check answered unknown.");
    expect(view.template).toBe(renderBatteryDiagnosis(reports[index]));
    expect(h.sent).toHaveLength(1);
    expect(h.statusSent).toHaveLength(1);
    expect(h.statusSent[0]).toMatchObject({ url: `${url}/v1/status`, init: { method: "GET", redirect: "error", headers: { Authorization: `Bearer ${token}` } } });
    expect(h.statusSent[0].init.body).toBeUndefined();
    expect(view.evidence).toEqual({ version: 1, consentVersion: SUMMARY_CONSENT_VERSION, requestId: ids(1), requestedModel: "deepseek/deepseek-v4.1-flash", returnedModel: validUsage.model, configuredProvider: "DeepSeek", observedProvider: null, routingEvidence: "configured-pin-only", usage: validUsage, phoneLatencyMs: 25, budget: expectedBudget, displayCategory: "llm", failedCheck: null });
    expect(h.sent[0].url).toBe(`${url}/v1/summaries`);
    expect(h.sent[0].init).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    expect(JSON.parse(bodyText(h.sent[0].init))).toEqual({ requestId: ids(1), consentVersion: SUMMARY_CONSENT_VERSION, request: prepareSummaryRequest(reports[index]) });
    for (const secret of ["private-garage-sentinel", path, reports[index].scannedAt, "garageVehicleId", "recording", "catalogId", token]) expect(bodyText(h.sent[0].init)).not.toContain(secret);
    h.record("checked summary", view, path, reports[index]);
  });

  // Item 4: the diagnosed reply shape, and a v2-era module citation, served as an `llm` summary, are caught by the phone's own check.
  it.each(["synthetic-reconstructed-single-claim-areas", "v2-era-module-citation"])("locally rejects synthetic %s HTTP output", async (name) => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: savedSplitReply(name) })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(view.evidence?.failedCheck).toBeNull();
    h.record(name, view);
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

  it.each(["verdict-contradicts-rating", "verdict-unrated-area", "verdict-in-takeaway", "rating-fact-cited", "rating-basis-cited", "v2-digit-outside", "shape-v1-claims", "shape-missing-area", "shape-version-1"])("locally rejects synthetic %s HTTP output", async (name) => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: savedReply(name) })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    h.record(name, view);
  });

  it("renders the adapter quantity from the phone's own report, whatever the server sent", async () => {
    // One fixed server reply; only the report it is rendered against differs. The 12.8 report is a synthetic copy, not a recording.
    const synthetic128: BatteryDiagnosisReport = { ...reports[0], twelveVolt: { ...reports[0].twelveVolt, observations: reports[0].twelveVolt.observations.map((observation, index) => index === 0 ? { ...observation, volts: 12.8 } : observation) } };
    const shown: string[] = [];
    for (const [name, report, source] of [["real spike report", reports[0], paths[0]], ["synthetic copy with 12.8 V", synthetic128, "synthetic"]] as const) {
      const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: accepted })));
      h.flow.consent(true);
      const view = await h.flow.summaryFor(report);
      expect(view.kind).toBe("llm");
      shown.push(/The adapter supply measured \d+\.\d+ V\./.exec(view.text)?.[0] ?? "");
      h.record(`placeholder rendered against the ${name}`, view, source, report);
    }
    expect(shown).toEqual(["The adapter supply measured 12.7 V.", "The adapter supply measured 12.8 V."]);
  });

  it("renders every rating line from the phone's own report, whatever the server or the request handed to the client said", async () => {
    // One fixed server reply. The stored-code report is a synthetic copy of the spike report, not a recording.
    const stored: BatteryDiagnosisReport = { ...reports[0], codes: { ...reports[0].codes, modules: reports[0].codes.modules.map((module, index) => index === 0 ? { ...module, stored: { status: "read", dtcs: ["P0133", "P0420"] } } : module) } };
    const codesLine = (text: string) => text.split("\n").filter((line, index, lines) => lines[index - 1] === "Diagnostic codes")[0];
    const shown: string[] = [];
    for (const [name, report, source, mutate] of [["real spike report", reports[0], paths[0], false], ["synthetic stored-code copy", stored, "synthetic", false], ["real spike report, request mutated by the client", reports[0], paths[0], true]] as const) {
      const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: accepted })));
      if (mutate) {
        // A test client that tampers with the request it was handed: the displayed rating must not follow it.
        const generate = h.access.generate.bind(h.access);
        h.access.generate = (request, requestId) => {
          for (const fact of request.facts) if (fact.id === "codes-rating") (fact as { value: string }).value = "Great";
          return generate(request, requestId);
        };
      }
      h.flow.consent(true);
      const view = await h.flow.summaryFor(report);
      expect(view.kind).toBe("llm");
      // The card's own data: every area except state of charge, which the app does not rate.
      for (const row of reportSummary(report).rows) expect(view.text, `${name} ${row.label}`).toContain(`\n\n${row.label}\nRating: ${ratingWord[row.rating.rating]}. Basis: ${row.rating.basis}.\n`);
      shown.push(codesLine(view.text));
      h.record(`rating lines rendered against the ${name}`, view, source, report);
    }
    expect(shown).toEqual([
      "Rating: OK. Basis: Project policy: no codes reported, and whether codes were cleared recently is unknown.",
      "Rating: Poor. Basis: Project policy: a reported code is Poor.",
      "Rating: OK. Basis: Project policy: no codes reported, and whether codes were cleared recently is unknown.",
    ]);
  });

  it.each(["unavailable", "unauthorized", "invalid-request", "consent-required", "no-credit", "budget-exhausted", "already-requested", "provider-error", "invalid-response"])("maps synthetic server %s to a fixed template reason", async (reason) => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "fallback", reason })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    // A bare reason (a legacy or pre-call envelope) carries no category.
    expect(view.evidence?.failedCheck).toBeNull();
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
    const h = harness(() => Promise.resolve(Response.json(name === "fallback" ? { kind: "fallback", reason: "private-evidence-sentinel", usage } : { kind: "llm", summary: savedReply("v2-digit-outside"), usage })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(view.evidence?.usage).toEqual({ ...validUsage, model: usage.model, cachedInputTokens: null, reasoningTokens: null, providerCostUsd: null });
    expect(view.evidence?.displayCategory).toBe("template");
    expect(JSON.stringify(view)).not.toContain("private-evidence-sentinel");
    h.record(`usage ${name}`, view);
  });

  // Failure 8: the phone shows a failed-check category only when the server envelope is an invalid-response naming one of the six.
  it.each([
    ["invalid-response", "facts", "facts"], ["invalid-response", "envelope", "envelope"], ["invalid-response", "bounds", "bounds"], ["invalid-response", "provider", "provider"], ["invalid-response", "json", "json"], ["invalid-response", "shape", "shape"],
    ["invalid-response", "SENTINEL reply", null], ["invalid-response", "FACTS", null], ["invalid-response", "facts ", null], ["invalid-response", 7, null], ["invalid-response", null, null], ["provider-error", "facts", null], ["no-credit", "facts", null],
  ] as [string, unknown, string | null][])("shows failedCheck for server %s with %j as %j", async (reason, failedCheck, shown) => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "fallback", reason, failedCheck, usage: validUsage })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(view.evidence?.failedCheck).toBe(shown);
    expect(view.evidence?.usage).toEqual(validUsage);
    expect(JSON.stringify(view)).not.toContain("SENTINEL");
    // The artifact row must not carry the sentinel value itself.
    h.record(`failedCheck ${reason} ${failedCheck === "SENTINEL reply" ? "reply-like text" : JSON.stringify(failedCheck)}`, view);
  });

  it("shows no failedCheck for an llm result, even when the server sends one", async () => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: accepted, failedCheck: "facts", usage: validUsage })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    expect(view.kind).toBe("llm");
    expect(view.evidence?.failedCheck).toBeNull();
    h.record("llm ignores failedCheck", view);
  });

  it("shows no failedCheck when the phone rejects the reply locally", async () => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: savedReply("v2-digit-outside"), failedCheck: "facts" })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(view.evidence?.failedCheck).toBeNull();
    h.record("local rejection has no category", view);
  });

  const badFields: [string, unknown][] = [
    ["inputTokens", -1], ["inputTokens", 1.5], ["inputTokens", 1048577], ["inputTokens", null], ["outputTokens", 2049], ["outputTokens", -1],
    ["cachedInputTokens", 201], ["reasoningTokens", 21], ["providerCostUsd", -0.1], ["providerCostUsd", 1.01], ["estimatedUsd", null], ["estimatedUsd", 1.01],
    ["latencyMs", 1.5], ["latencyMs", -1], ["latencyMs", 9007199254740992], ["model", "private-evidence-sentinel"], ["provider", "private-evidence-sentinel"], ["promptVersion", "private-evidence-sentinel"], ["adapterPromptVersion", "private-evidence-sentinel"], ["adapterPromptVersion", "t2.10-openrouter-v1"], ["adapterPromptVersion", "t2.10-openrouter-v2"], ["adapterPromptVersion", "t2.10-openrouter-v3"], ["adapterPromptVersion", "t2.10-openrouter-v4"], ["promptVersion", "t2.10-v1"], ["promptVersion", "t2.10-v2"], ["adapterPromptVersion", "t2.10-openrouter-v5"], ["model", "private-evidence-sentinel".repeat(1000)],
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

  // Stage 3: the summary route's completion cap is 2,048 (openrouter.ts summaryMaxCompletionTokens); 1,024 was the v1 bound.
  it.each([1025, 1500, 2048])("keeps valid usage with %i output tokens", async (outputTokens) => {
    const usage = { ...validUsage, outputTokens };
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: accepted, usage })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    expect(view.kind).toBe("llm");
    expect(view.evidence?.usage).toEqual(usage);
    h.record(`usage with ${String(outputTokens)} output tokens`, view);
  });

  it("shows the template for a v1-shaped server summary, and keeps its usage", async () => {
    const h = harness(() => Promise.resolve(Response.json({ kind: "llm", summary: savedReply("shape-v1-claims"), usage: validUsage })));
    h.flow.consent(true);
    const view = await h.flow.summaryFor(reports[0]);
    exactTemplate(view);
    expect(view.evidence?.usage).toEqual(validUsage);
    h.record("v1-shaped summary", view);
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
