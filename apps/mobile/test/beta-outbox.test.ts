// T2.9 Stage B: docs/specs/T2.9-beta-data-upload.md Verification "Stage B" (E2E, E2E charge log, O1–O15), driven through
// createBetaOutbox and finishRun with the in-memory fakes. Artifacts: /tmp/t2.9-b-codes.jsonl, /tmp/t2.9-b-charge-log.jsonl.
// Vitest runs in Node; Expo's mobile typecheck intentionally omits Node typings.
// @ts-expect-error Node built-in types are not part of the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latin1Decode, latin1Encode, parseRecording } from "obd-core/recording";
import { betaManifestSchema, betaProvenanceSchema, type BetaProvenance } from "obd-core/recording/provenance";
import { scrubRecording } from "obd-core/recording/scrub";
import { codesReportFromRecording } from "obd-core/report";
import type { Transport } from "obd-core/transport";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { chargeLogFromRecording, chargePhases } from "obd-battery/session";
import { BACKOFF_MAX_S, BackendError, createBetaOutbox, PART_BYTES } from "../src/beta/outbox.js";
import { runChargeLog } from "../src/chargeLogger.js";
import type { GarageVehicle } from "../src/garage/flow.js";
import { RecordingBuffer } from "../src/recording.js";
import { finishRun } from "../src/runFiles.js";
import { FakeBetaBackend, MemoryBetaFiles } from "./fakeBeta.js";
import { FakeTargets } from "./fakeTargets.js";

const readText = readFileSync as (path: URL, encoding: "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const PHONE = readText(new URL("../../../fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl", import.meta.url), "latin1");
const HEADING = { vehicle: "2024 Chevrolet Equinox EV", date: "2026-10-03", result: { sent: 10, total: 10 } };
const MINE: GarageVehicle = { id: "1", catalogId: "chevrolet-equinox-ev-2024", ownership: "mine" };
const CHECKED: GarageVehicle = { id: "2", catalogId: "chevrolet-equinox-ev-2024", ownership: "checked" };
const QUEUED = "Queued for beta upload.";
const T0 = 1_000_000;

/** Deterministic UUID v4s. */
const idSource = () => {
  let n = 0;
  return () => `${(++n).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
};

function setup(options: { files?: MemoryBetaFiles; backend?: FakeBetaBackend; partBytes?: number; clock?: { s: number } } = {}) {
  const files = options.files ?? new MemoryBetaFiles();
  const backend = options.backend ?? new FakeBetaBackend(files);
  const clock = options.clock ?? { s: T0 };
  const outbox = createBetaOutbox({
    files, backend, newId: idSource(), nowS: () => clock.s, month: () => "2026-10", appVersion: "1.0.0",
    ...(options.partBytes === undefined ? {} : { partBytes: options.partBytes }),
  });
  return { files, backend, clock, outbox };
}

interface StoredItem { fileId: string; nextTry: number }
const stored = (files: MemoryBetaFiles) => JSON.parse(files.state ?? "{}") as { consent: { version: string }; auth: { installId: string }; outbox: StoredItem[]; deleting: { nextTry: number }[] };
const lines = (text: string) => text.split("\n").slice(0, -1);
/** The uploaded file split into its recording (with "\n") and its provenance line. */
function split(uploaded: string): { body: string; provenance: BetaProvenance } {
  const all = lines(uploaded);
  const last = all.pop() ?? "";
  return { body: all.map((line) => `${line}\n`).join(""), provenance: betaProvenanceSchema.parse((JSON.parse(last) as { beta: unknown }).beta) };
}
async function* asyncLines(text: string): AsyncIterable<string> {
  for (const line of lines(text)) { await Promise.resolve(); yield line; }
}
const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });
/** Waits until the fake backend holds a call (FakeBetaBackend.held) and returns that call's log entry. */
async function waitHeld(backend: FakeBetaBackend, calls: readonly (() => void)[]): Promise<string> {
  while (calls.length === 0) await tick();
  return backend.log.at(-1) ?? "";
}
/** Yields the first line, then waits for `open()` before the rest, so a test can act while the file is scrubbed. */
function gatedLines(text: string) {
  const gate = { reached: false, open: (): void => undefined };
  const opened = new Promise<void>((resolve) => { gate.open = resolve; });
  async function* gen(): AsyncIterable<string> {
    const all = lines(text);
    yield all[0];
    gate.reached = true;
    await opened;
    yield* all.slice(1);
  }
  return { gate, lines: gen() };
}
const onlyFile = (backend: FakeBetaBackend) => {
  const ids = [...backend.manifests.keys()];
  expect(ids).toHaveLength(1);
  return ids[0];
};

describe("E2E", () => {
  it("a codes run goes finishRun -> outbox -> drain: register, parts, manifest; the upload replays into the same codes report", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    const plain = await finishRun("codes", PHONE, HEADING, new FakeTargets());
    const outcome = await finishRun("codes", PHONE, HEADING, new FakeTargets(), (jsonl) => outbox.queue("codes-scan", MINE, jsonl));
    expect(outcome.status).toBe(`${plain.status} ${QUEUED}`);
    expect(outcome.report).toBe(plain.report);
    await outbox.drain();

    const fileId = onlyFile(backend);
    const manifest = betaManifestSchema.parse(backend.manifests.get(fileId));
    const parts = manifest.parts.map((_, i) => `part:${fileId}:${String(i)}`);
    expect(backend.log).toEqual([expect.stringMatching(/^register:.+:beta-1$/), ...parts, `manifest:${fileId}`]);
    const uploaded = backend.uploaded(fileId);
    const { body, provenance } = split(uploaded);
    expect(body).toBe(scrubRecording(PHONE).text);
    expect(provenance).toMatchObject({ fileId, kind: "codes-scan", catalogId: "chevrolet-equinox-ev-2024", month: "2026-10", consentVersion: "beta-1", ownership: "mine", appVersion: "1.0.0" });
    expect(manifest.provenance).toEqual(provenance);
    expect(manifest.parts.reduce((sum, part) => sum + part.bytes, 0)).toBe(uploaded.length);
    expect(manifest.parts.reduce((sum, part) => sum + part.lines, 0)).toBe(lines(uploaded).length);
    expect(await codesReportFromRecording(parseRecording(uploaded))).toEqual(await codesReportFromRecording(parseRecording(PHONE)));
    expect(files.parts.size).toBe(0);
    expect((await outbox.status()).queued).toBe(0);
    write("/tmp/t2.9-b-codes.jsonl", uploaded);
  });

  it("a RecordingBuffer-written charge log, queued line by line, splits into parts and keeps its sessions, phases and windows", async () => {
    const input = await happyChargeLog();
    const partBytes = 256 * 1024;
    const { outbox, backend } = setup({ partBytes });
    await outbox.decide(true);
    expect(await outbox.queue("charge-log", MINE, asyncLines(input))).toBe(QUEUED);
    await outbox.drain();

    const fileId = onlyFile(backend);
    const manifest = betaManifestSchema.parse(backend.manifests.get(fileId));
    expect(manifest.parts.length).toBeGreaterThanOrEqual(3);
    const uploaded = backend.uploaded(fileId);
    const { body, provenance } = split(uploaded);
    expect(provenance.kind).toBe("charge-log");
    expect(body).toBe(scrubRecording(input).text);
    const signals = importObdbMode22(signalsetJson);
    const before = await chargeLogFromRecording(parseRecording(input), CHARGE_FILE, signals);
    const after = await chargeLogFromRecording(parseRecording(body), CHARGE_FILE, signals);
    expect(before.sessions?.map((session) => session.reason)).toEqual(["start", "lv-reset"]);
    expect(after).toEqual(before);
    expect(chargePhases(after)).toEqual(chargePhases(before));
    expect(chargePhases(before).postRest).toBeDefined();
    write("/tmp/t2.9-b-charge-log.jsonl", uploaded);
  }, 120_000);
});

describe("outbox failure modes", () => {
  it("O1 off-by-default: no decision, or sharing off, queues nothing and calls nothing", async () => {
    const { outbox, backend, files } = setup();
    expect(await outbox.status()).toMatchObject({ needsConsent: true, sharing: false, queued: 0 });
    const plain = await finishRun("codes", PHONE, HEADING, new FakeTargets());
    const outcome = await finishRun("codes", PHONE, HEADING, new FakeTargets(), (jsonl) => outbox.queue("codes-scan", MINE, jsonl));
    expect(outcome.status).toBe(plain.status);
    await outbox.decide(false);
    expect(await outbox.status()).toMatchObject({ needsConsent: false, sharing: false });
    expect(await outbox.queue("capture", MINE, PHONE)).toBeUndefined();
    await outbox.drain();
    expect(backend.log).toEqual([]);
    expect(files.parts.size).toBe(0);
  });

  it("O2 outdated-consent: sharing decided under an older version needs consent again, queues nothing, and drains nothing already queued", async () => {
    const { outbox, files, backend } = setup();
    await outbox.decide(true);
    expect(await outbox.queue("capture", MINE, PHONE)).toBe(QUEUED);
    files.state = (files.state ?? "").replace('"beta-1"', '"beta-0"');
    expect(stored(files).consent.version).toBe("beta-0");
    const again = setup({ files, backend });
    expect(await again.outbox.status()).toMatchObject({ needsConsent: true, sharing: false, queued: 1 });
    expect(await again.outbox.queue("capture", MINE, PHONE)).toBeUndefined();
    await again.outbox.drain();
    expect(backend.log).toEqual([]);
    expect(stored(files).outbox).toHaveLength(1);
    expect(files.parts.size).toBe(1);
  });

  it("O3 checked-queues-with-tag: a checked entry is queued like mine and keeps its ownership tag", async () => {
    const { outbox, backend } = setup();
    await outbox.decide(true);
    expect(await outbox.queue("codes-scan", CHECKED, PHONE)).toBe(QUEUED);
    await outbox.drain();
    const fileId = onlyFile(backend);
    expect(split(backend.uploaded(fileId)).provenance.ownership).toBe("checked");
    expect(backend.manifests.get(fileId)?.provenance.ownership).toBe("checked");
  });

  it("O4 offline-retry: a network error keeps the file with a doubling backoff capped at 6 h, then it uploads", async () => {
    const { outbox, backend, files, clock } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    backend.fail = () => new BackendError("network", "offline");
    const delays: number[] = [];
    for (let i = 0; i < 11; i++) {
      await outbox.drain();
      const [item] = stored(files).outbox;
      delays.push(item.nextTry - clock.s);
      const calls = backend.log.length;
      clock.s += 30;
      await outbox.drain();
      expect(backend.log).toHaveLength(calls);
      clock.s = item.nextTry;
    }
    expect(delays).toEqual([60, 120, 240, 480, 960, 1920, 3840, 7680, 15360, BACKOFF_MAX_S, BACKOFF_MAX_S]);
    expect(await outbox.status()).toMatchObject({ queued: 1, failed: 0 });
    backend.fail = undefined;
    await outbox.drain();
    expect(backend.manifests.size).toBe(1);
    expect(await outbox.status()).toMatchObject({ queued: 0, failed: 0 });
  });

  it("O5 resume: after parts 0-1 and a failed part 2, a new outbox over the same files resumes at part 2, manifest last", async () => {
    const { outbox, backend, files, clock } = setup({ partBytes: 512 });
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    backend.fail = (call, index) => (call === "putPart" && index === 2 ? new BackendError("network", "offline") : undefined);
    await outbox.drain();
    const [item] = stored(files).outbox;
    const id = item.fileId;
    expect(backend.log.slice(1)).toEqual([`part:${id}:0`, `part:${id}:1`, `part:${id}:2`]);
    backend.fail = undefined;
    backend.log.length = 0;
    clock.s = item.nextTry;
    const resumed = setup({ files, backend, clock, partBytes: 512 });
    await resumed.outbox.drain();
    const manifest = betaManifestSchema.parse(backend.manifests.get(id));
    expect(manifest.parts.length).toBeGreaterThanOrEqual(4);
    expect(backend.log).toEqual([...manifest.parts.slice(2).map((_, i) => `part:${id}:${String(i + 2)}`), `manifest:${id}`]);
    expect(split(backend.uploaded(id)).body).toBe(scrubRecording(PHONE).text);
  });

  it("O6 status-classes: 429 and 5xx back off; 400, 409 and 413 fail permanently with the parts deleted", async () => {
    for (const status of [429, 503]) {
      const { outbox, backend, files, clock } = setup();
      await outbox.decide(true);
      await outbox.queue("capture", MINE, PHONE);
      backend.fail = (call) => (call === "putPart" ? new BackendError(status, "busy") : undefined);
      await outbox.drain();
      expect(stored(files).outbox[0].nextTry - clock.s).toBe(60);
      expect(await outbox.status()).toMatchObject({ queued: 1, failed: 0 });
      expect(files.parts.size).toBe(1);
    }
    for (const status of [400, 409, 413]) {
      const { outbox, backend, files, clock } = setup();
      await outbox.decide(true);
      await outbox.queue("capture", MINE, PHONE);
      backend.fail = (call) => (call === "putManifest" ? new BackendError(status, "rejected") : undefined);
      await outbox.drain();
      expect(await outbox.status()).toMatchObject({ queued: 0, failed: 1 });
      expect(files.parts.size).toBe(0);
      const calls = backend.log.length;
      clock.s += BACKOFF_MAX_S;
      await outbox.drain();
      expect(backend.log).toHaveLength(calls);
    }
  });

  it("O7 scrub-refusal: a refused file sends nothing, leaves no parts, and finishRun says why", async () => {
    const { outbox, backend, files } = setup({ partBytes: 512 });
    await outbox.decide(true);
    const bad = `${PHONE}{"t":9,"dir":"meta","note":"compact form"}\n`;
    const outcome = await finishRun("recording", bad, HEADING, new FakeTargets(), (jsonl) => outbox.queue("capture", MINE, jsonl));
    expect(outcome.status).toMatch(/ Not queued for beta upload: line 55: not in Python json\.dumps form\.$/);
    expect(files.parts.size).toBe(0);
    expect(await outbox.status()).toMatchObject({ queued: 0 });
    // Pass 2 (safety net): the synthetic 0902 serial of the Stage A tests survives in a later note, after every part was written.
    const vin = [0x49, 0x02, 0x01, ...Array.from("1C4SYNTHETICVIN00", (c) => c.charCodeAt(0))];
    const reply = [`18DAF1171014${hex(vin.slice(0, 6))}`, `18DAF11721${hex(vin.slice(6, 13))}`, `18DAF11722${hex(vin.slice(13))}`].join("\r");
    const leak = [`{"t": 5, "dir": "tx", "data": "0902\\r"}`, `{"t": 5.1, "dir": "rx", "data": ${JSON.stringify(`${reply}\r\r>`)}}`, `{"t": 6, "dir": "meta", "note": "serial CVIN00"}`];
    const refused = await outbox.queue("capture", MINE, `${PHONE}${leak.join("\n")}\n`);
    expect(refused).toBe("Not queued for beta upload: line 57: a VIN serial survives masking.");
    expect(files.parts.size).toBe(0);
    await outbox.drain();
    expect(backend.log).toEqual([]);
  });

  it("O8 stop: switching off empties the queue unsent, and later runs queue nothing", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.queue("codes-scan", MINE, PHONE);
    expect((await outbox.status()).queued).toBe(2);
    await outbox.decide(false);
    expect(await outbox.status()).toMatchObject({ sharing: false, queued: 0 });
    expect(files.parts.size).toBe(0);
    expect(await outbox.queue("capture", MINE, PHONE)).toBeUndefined();
    await outbox.drain();
    expect(backend.log).toEqual([]);
  });

  it("O8 stop, in flight: switching off during a part upload sends no further part and no manifest", async () => {
    const { outbox, backend, files } = setup({ partBytes: 512 });
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    const [item] = stored(files).outbox;
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    expect(await waitHeld(backend, calls)).toMatch(/^register:/);
    calls.shift()?.();
    expect(await waitHeld(backend, calls)).toBe(`part:${item.fileId}:0`);
    await outbox.decide(false);
    backend.held = undefined;
    calls.shift()?.();
    await drained;
    expect(backend.log.slice(1)).toEqual([`part:${item.fileId}:0`]);
    expect(backend.received.get(item.fileId)).toHaveLength(1);
    expect(backend.manifests.size).toBe(0);
    expect(await outbox.status()).toMatchObject({ sharing: false, queued: 0 });
    expect(files.parts.size).toBe(0);
  });

  it("O8 stop, mid-scrub: a file still scrubbing when sharing is switched off is not queued", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    const { gate, lines: input } = gatedLines(PHONE);
    const queued = outbox.queue("capture", MINE, input);
    while (!gate.reached) await tick();
    await outbox.decide(false);
    gate.open();
    expect(await queued).toBeUndefined();
    expect(files.parts.size).toBe(0);
    expect(await outbox.status()).toMatchObject({ sharing: false, queued: 0 });
    await outbox.drain();
    expect(backend.log).toEqual([]);
  });

  it("O8 stop then re-opt-in, mid-scrub: a file still scrubbing when sharing is switched off is dropped even if sharing is back on", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    const { gate, lines: input } = gatedLines(PHONE);
    const queued = outbox.queue("capture", MINE, input);
    while (!gate.reached) await tick();
    await outbox.decide(false);
    await outbox.decide(true);
    gate.open();
    expect(await queued).toBeUndefined();
    expect(files.parts.size).toBe(0);
    expect(await outbox.status()).toMatchObject({ sharing: true, queued: 0 });
    await outbox.drain();
    expect(backend.log).toEqual([]);
  });

  it("O9 delete-offline: Delete my data survives being offline, retries on drain, then wipes consent; a new opt-in gets new keys", async () => {
    const { outbox, backend, files, clock } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.drain();
    const oldInstall = [...backend.installs][0];
    const oldBetaId = (await outbox.status()).betaId;
    const oldVehicleKey = backend.manifests.get(onlyFile(backend))?.provenance.vehicleKey;
    expect(oldVehicleKey).toBeDefined();
    await outbox.queue("codes-scan", MINE, PHONE);
    backend.fail = (call) => (call === "deleteAll" ? new BackendError("network", "offline") : undefined);
    await outbox.deleteMyData();
    expect(await outbox.status()).toMatchObject({ deletePending: true, sharing: false, queued: 0 });
    expect(files.parts.size).toBe(0);
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) await outbox.drain();
      const [pending] = stored(files).deleting;
      delays.push(pending.nextTry - clock.s);
      const calls = backend.log.length;
      clock.s += 30;
      await outbox.drain();
      expect(backend.log).toHaveLength(calls);
      clock.s = pending.nextTry;
    }
    expect(delays).toEqual([60, 120, 240]);
    expect(await outbox.status()).toMatchObject({ deletePending: true });
    expect(backend.installs.has(oldInstall)).toBe(true);
    backend.fail = undefined;
    await outbox.drain();
    expect(backend.log.filter((entry) => entry === `delete:${oldInstall}`)).toHaveLength(4);
    expect(backend.installs.has(oldInstall)).toBe(false);
    expect(backend.manifests.size).toBe(0);
    const wiped = await outbox.status();
    expect(wiped).toMatchObject({ deletePending: false, needsConsent: true, sharing: false, queued: 0 });
    expect(wiped.betaId).toBeUndefined();
    await outbox.decide(true);
    const fresh = await outbox.status();
    expect(fresh.betaId).toBeDefined();
    expect(fresh.betaId).not.toBe(oldBetaId);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.drain();
    const newInstall = [...backend.installs][0];
    expect(newInstall).not.toBe(oldInstall);
    const provenance = split(backend.uploaded(onlyFile(backend))).provenance;
    expect(provenance.testerKey.slice(0, 8)).toBe(fresh.betaId);
    expect(provenance.vehicleKey).not.toBe(oldVehicleKey);
  });

  it("O9 delete, never registered: Delete my data wipes locally and calls no server", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    expect(await outbox.deleteMyData()).toBe("Your beta data was deleted.");
    expect(backend.log).toEqual([]);
    expect(files.parts.size).toBe(0);
    expect(await outbox.status()).toMatchObject({ deletePending: false, needsConsent: true, sharing: false, queued: 0 });
  });

  it("O9 delete, in flight register: Delete my data while register is in flight uploads no part", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    expect(await waitHeld(backend, calls)).toMatch(/^register:/);
    const deleted = outbox.deleteMyData();
    while ((await outbox.status()).sharing) await tick();
    backend.held = undefined;
    calls.shift()?.();
    await drained;
    await deleted;
    expect(backend.log).toEqual([expect.stringMatching(/^register:/)]);
    expect(backend.received.size).toBe(0);
    expect(files.parts.size).toBe(0);
  });

  it("O9 delete, during a drain: Delete my data sends its delete even when the running drain passed its delete step", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.drain();
    const [install] = backend.installs;
    await outbox.queue("codes-scan", MINE, PHONE);
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    expect(await waitHeld(backend, calls)).toMatch(/^part:/);
    const deleted = outbox.deleteMyData();
    // Let deleteMyData reach its first drain(), which joins the held one.
    while (files.parts.size > 0) await tick();
    await tick();
    backend.held = undefined;
    calls.shift()?.();
    await drained;
    expect(await deleted).toBe("Your beta data was deleted.");
    expect(backend.log.at(-1)).toBe(`delete:${install}`);
    expect(backend.installs.size).toBe(0);
    expect(await outbox.status()).toMatchObject({ deletePending: false, needsConsent: true });
  });

  it("O9 delete, mid-scrub: a file still scrubbing when Delete my data runs is not uploaded after a new opt-in", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    const oldBetaId = (await outbox.status()).betaId;
    const { gate, lines: input } = gatedLines(PHONE);
    const queued = outbox.queue("capture", MINE, input);
    while (!gate.reached) await tick();
    await outbox.deleteMyData();
    await outbox.decide(true);
    expect((await outbox.status()).betaId).not.toBe(oldBetaId);
    gate.open();
    expect(await queued).toBeUndefined();
    expect(files.parts.size).toBe(0);
    await outbox.drain();
    expect(backend.log).toEqual([]);
    expect(await outbox.status()).toMatchObject({ sharing: true, queued: 0 });
  });

  it("O10 register-once: the first upload registers first, and never again", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.queue("codes-scan", MINE, PHONE);
    await outbox.drain();
    await outbox.queue("capture", MINE, PHONE);
    await outbox.drain();
    await setup({ files, backend }).outbox.queue("capture", MINE, PHONE);
    await setup({ files, backend }).outbox.drain();
    expect(backend.log[0]).toMatch(/^register:/);
    expect(backend.log.filter((entry) => entry.startsWith("register:"))).toHaveLength(1);
    expect(backend.manifests.size).toBe(4);
  });

  it("O10 register-once, 409: a register that finds the install already there counts as registered", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    // An earlier register succeeded but its state write was lost: the server has the install and answers 409.
    backend.installs.add(stored(files).auth.installId);
    backend.fail = (call) => (call === "register" ? new BackendError(409, "exists") : undefined);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.drain();
    await outbox.queue("codes-scan", MINE, PHONE);
    await outbox.drain();
    expect(backend.log.filter((entry) => entry.startsWith("register:"))).toHaveLength(1);
    expect(backend.manifests.size).toBe(2);
    expect(await outbox.status()).toMatchObject({ queued: 0, failed: 0 });
  });

  it("O11 vehicle-key: one stable vehicleKey per garage entry, different between entries", async () => {
    const { outbox, backend, files } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.queue("capture", CHECKED, PHONE);
    await outbox.drain();
    await setup({ files, backend }).outbox.queue("capture", MINE, PHONE);
    await setup({ files, backend }).outbox.drain();
    const provenance = [...backend.manifests.values()].map((manifest) => manifest.provenance);
    expect(provenance.map((p) => p.ownership)).toEqual(["mine", "checked", "mine"]);
    expect(provenance[2].vehicleKey).toBe(provenance[0].vehicleKey);
    expect(provenance[1].vehicleKey).not.toBe(provenance[0].vehicleKey);
    expect(new Set(provenance.map((p) => p.testerKey)).size).toBe(1);
  });

  it("O12 finish-run-never-throws: a rejecting or throwing upload keeps every save sentence and adds its reason", async () => {
    const plain = await finishRun("codes", PHONE, HEADING, new FakeTargets());
    const rejected = await finishRun("codes", PHONE, HEADING, new FakeTargets(), () => Promise.reject(new Error("disk full")));
    expect(rejected.status).toBe(`${plain.status} Not queued for beta upload: disk full.`);
    expect(rejected.report).toBe(plain.report);
    const thrown = await finishRun("recording", PHONE, HEADING, new FakeTargets(), () => { throw new Error("boom"); });
    expect(thrown.status).toMatch(/ Not queued for beta upload: boom\.$/);
  });

  it("O13 corrupt-state: an unreadable beta.json is never overwritten and nothing uploads", async () => {
    for (const corrupt of ["{not json", '{"version": 2}', '{"version": 1, "outbox": "x"}']) {
      const files = new MemoryBetaFiles();
      files.state = corrupt;
      const { outbox, backend } = setup({ files });
      const status = await outbox.status();
      expect(status).toMatchObject({ sharing: false, queued: 0 });
      expect(status.line).toMatch(/unreadable/);
      expect(await outbox.queue("capture", MINE, PHONE)).toMatch(/^Not queued for beta upload: /);
      await expect(outbox.decide(true)).rejects.toThrow(/unreadable/);
      expect(await outbox.deleteMyData()).toMatch(/unreadable/);
      await outbox.drain();
      expect(backend.log).toEqual([]);
      expect(files.parts.size).toBe(0);
      expect(files.state).toBe(corrupt);
      expect(files.stateWrites).toBe(0);
    }
  });

  it("O14 part-split: parts are line-aligned and exceed PART_BYTES by at most their last line", async () => {
    expect(PART_BYTES).toBe(16 * 1024 * 1024);
    const partBytes = 700;
    const { outbox, backend } = setup({ partBytes });
    await outbox.decide(true);
    const long = `{"t": 5.0, "dir": "meta", "note": "${"x".repeat(900)}"}`;
    await outbox.queue("capture", MINE, `${PHONE}${long}\n`);
    await outbox.drain();
    const fileId = onlyFile(backend);
    const parts = backend.received.get(fileId) ?? [];
    const manifest = backend.manifests.get(fileId);
    expect(parts.length).toBeGreaterThanOrEqual(5);
    parts.forEach((part, i) => {
      expect(part.endsWith("\n")).toBe(true);
      const partLines = lines(part);
      partLines.forEach((line) => { expect(() => JSON.parse(line) as unknown).not.toThrow(); });
      expect(part.length - (partLines.at(-1)?.length ?? 0) - 1).toBeLessThanOrEqual(partBytes);
      expect(manifest?.parts[i]).toEqual({ bytes: part.length, lines: partLines.length });
    });
    expect(parts.some((part) => part.length > partBytes)).toBe(true);
    expect(split(parts.join("")).body).toBe(scrubRecording(`${PHONE}${long}\n`).text);
  });

  it("O15 single-drain: concurrent drains share one run and upload each part once", async () => {
    const { outbox, backend } = setup({ partBytes: 512 });
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    const held: (() => void)[] = [];
    backend.held = held;
    const first = outbox.drain();
    const second = outbox.drain();
    expect(second).toBe(first);
    const settled = { done: false };
    void first.then(() => { settled.done = true; });
    let third: Promise<void> | undefined;
    while (!settled.done) {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      held.splice(0).forEach((release) => { release(); });
      third ??= outbox.drain();
    }
    await third;
    expect(new Set(backend.log).size).toBe(backend.log.length);
    expect(backend.manifests.size).toBe(1);
  });
});

// ---- The charge-log input: runChargeLog's own RecordingBuffer output (spec Decision 15) ------------------------------

const CHARGE_FILE = "2026-10-03-charge-log.jsonl";
const META = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "Ready, Park; dash SOC 61%, 12 C", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
const hex = (bytes: readonly number[]) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");

const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
/** ISO-TP frames as the ELM prints them with ATH1 and ATS0: apps/mobile/test/charge-logger.test.ts frames(). */
function frames(module: string, did: string, data: readonly number[]): string {
  const header = `18DAF1${module}`;
  const payload = [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16), ...data];
  if (payload.length <= 7) return `${header}${hex([payload.length, ...payload])}\r\r>`;
  const out = [`${header}${hex([0x10 | (payload.length >> 8), payload.length & 0xff, ...payload.slice(0, 6)])}`];
  for (let i = 6, n = 1; i < payload.length; i += 7, n++) out.push(`${header}${hex([0x20 | (n & 0x0f), ...payload.slice(i, i + 7)])}`);
  return `${out.join("\r")}\r\r>`;
}
// apps/mobile/test/charge-logger.test.ts GROUP_RECORDS: 80 records [u16 x 0.0001 V][module 1-10] plus 4 zero records.
const GROUP_RECORDS = (() => {
  const records = Array.from({ length: 80 }, (_, i) => [...u16(39000 + (i % 5) * 2), Math.floor(i / 8) + 1]).flat();
  while (records.length < 7 * 36) records.push(0, 0, 0);
  return records;
})();
const GROUP_DIDS = ["2AE1", "2AE2", "2AE3", "2AE4", "2AE5", "2AE6", "2AE7"];

/** The T2.4 B1 fake ELM (apps/mobile/test/charge-logger.test.ts FakeElm) with its happy-path plan fixed: the same init
 *  and DID replies as sourced there. Each reply advances the run clock 20 ms. One LV RESET at about 1500 s adds a
 *  second session boundary (T2.4 failure mode 3). */
class HappyElm implements Transport {
  private target = "";
  private reset = false;
  private readonly listeners = new Set<(bytes: Uint8Array) => void>();
  constructor(private readonly clock: { s: number }, private readonly start: number) {}

  write(bytes: Uint8Array): Promise<void> {
    const command = latin1Decode(bytes).replace(/\r$/, "");
    const text = this.answer(command);
    this.clock.s += 0.02;
    queueMicrotask(() => { this.listeners.forEach((cb) => { cb(latin1Encode(text)); }); });
    return Promise.resolve();
  }

  onData(cb: (bytes: Uint8Array) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  close(): Promise<void> { this.listeners.clear(); return Promise.resolve(); }

  private answer(command: string): string {
    if (command === "ATZ") return "\r\rELM327 v1.5\r\r>";
    if (command === "ATI") return "ELM327 v1.5\r\r>";
    if (command === "ATDPN") return "A0\r\r>";
    if (command === "ATRV") return "12.7V\r\r>";
    if (command === "0100") return "18DAF1CB06410080000001\r\r>";
    if (command.startsWith("ATSH DA")) this.target = command.slice(7, 9);
    if (command.startsWith("AT")) return "OK\r\r>";
    const s = this.clock.s - this.start;
    if (!this.reset && s >= 1500) { this.reset = true; return "LV RESET\r\r>"; }
    const did = command.slice(3);
    const amps = s < 700 ? 0.5 : s < 720 ? -3 : s < 1020 ? -20 : 0.5;
    if (this.target === "17" && did === "2414") return frames("17", did, u16(Math.round(amps * 20) & 0xffff));
    if (this.target === "17" && did === "2885") return frames("17", did, u16(33000));
    if (this.target === "CB" && did === "27AF") return frames("CB", did, u16(4000));
    if (this.target === "CB" && did === "2B43") return frames("CB", did, [128]);
    if (this.target === "CB" && did === "2AF5") return frames("CB", did, [...u16(39004), ...u16(39000), ...u16(39008)]);
    const group = GROUP_DIDS.indexOf(did);
    if (this.target === "CB" && group >= 0) return frames("CB", did, GROUP_RECORDS.slice(group * 36, group * 36 + 36));
    return "NO DATA\r\r>";
  }
}

async function happyChargeLog(): Promise<string> {
  const clock = { s: T0 };
  const recording = new RecordingBuffer(() => clock.s);
  recording.start(META);
  let content = "";
  let elm: HappyElm | undefined;
  const result = await runChargeLog({
    connect: () => Promise.resolve((elm ??= new HappyElm(clock, T0))),
    recording,
    signals: importObdbMode22(signalsetJson),
    now: () => clock.s,
    sleep: (ms) => { clock.s += ms / 1000; return Promise.resolve(); },
    onStatus: () => undefined,
    stream: { create: () => CHARGE_FILE, append: (_name, text) => { content += text; }, copyToFolder: () => Promise.resolve() },
    stopRequested: () => false,
  });
  expect(result.complete, result.stopReason).toBe(true);
  return content;
}
