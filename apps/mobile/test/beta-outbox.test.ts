// T2.9 Stage B: docs/specs/T2.9-beta-data-upload.md Verification "Stage B" (E2E, E2E charge log, O1–O15), driven through
// createBetaOutbox and finishRun with the in-memory fakes. Artifacts: /tmp/t2.9-b-codes.jsonl, /tmp/t2.9-b-charge-log.jsonl.
// Stage C1: the same E2E over createBetaClient -> handleRequest in process (artifacts /tmp/t2.9-c1-*.jsonl), the client's
// status mapping, and the orchestrator's C1-a/b/c and Stage B survivors X1/X2 (failure modes in docs/task-runs/T2.9.md).
// Vitest runs in Node; Expo's mobile typecheck intentionally omits Node typings.
// @ts-expect-error Node built-in types are not part of the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latin1Decode, latin1Encode, parseRecording } from "obd-core/recording";
import { betaManifestSchema, betaProvenanceSchema, type BetaManifest, type BetaProvenance } from "obd-core/recording/provenance";
import { scrubRecording } from "obd-core/recording/scrub";
import { codesReportFromRecording } from "obd-core/report";
import type { Transport } from "obd-core/transport";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { chargeLogFromRecording, chargePhases } from "obd-battery/session";
import { handleRequest } from "../../../tools/beta-backend/handler.js";
import { createBetaClient } from "../src/beta/client.js";
import { BACKOFF_MAX_S, BackendError, createBetaOutbox, PART_BYTES, type Auth, type BetaBackend } from "../src/beta/outbox.js";
import { runChargeLog } from "../src/chargeLogger.js";
import type { GarageVehicle } from "../src/garage/flow.js";
import { RecordingBuffer } from "../src/recording.js";
import { finishRun } from "../src/runFiles.js";
import { FakeBetaBackend, MemoryBetaFiles, MemoryBucket } from "./fakeBeta.js";
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

function outboxOver(files: MemoryBetaFiles, backend: BetaBackend, clock: { s: number }, partBytes?: number) {
  return createBetaOutbox({
    files, backend, newId: idSource(), nowS: () => clock.s, month: () => "2026-10", appVersion: "1.0.0",
    ...(partBytes === undefined ? {} : { partBytes }),
  });
}

function setup(options: { files?: MemoryBetaFiles; backend?: FakeBetaBackend; partBytes?: number; clock?: { s: number } } = {}) {
  const files = options.files ?? new MemoryBetaFiles();
  const backend = options.backend ?? new FakeBetaBackend(files);
  const clock = options.clock ?? { s: T0 };
  const outbox = outboxOver(files, backend, clock, options.partBytes);
  return { files, backend, clock, outbox };
}

const NOW = new Date("2026-10-03T12:00:00Z");
/** Stage C1: createBetaClient over handleRequest and an in-memory bucket, in process. The call log and the received
 *  files are read back the way the fake backend exposes them, so the Stage B E2E runs unchanged over it. */
class WorkerBackend implements BetaBackend {
  readonly log: string[] = [];
  readonly bucket = new MemoryBucket(() => NOW);
  /** When set, each HTTP request waits for the test to resolve it. */
  held?: (() => void)[];
  private readonly client: BetaBackend;

  constructor(files: MemoryBetaFiles) {
    const env = { BETA_BUCKET: this.bucket, ADMIN_TOKEN: "test-admin-token" };
    const send = async (request: Request) => {
      if (this.held) await new Promise<void>((resolve) => { this.held?.push(resolve); });
      return handleRequest(request, env, NOW);
    };
    this.client = createBetaClient("https://beta.test", {
      fetch: (input, init) => send(new Request(input, init)),
      // As the phone's UploadTask: the file's bytes, with the Content-Length the transport adds.
      putFile: (url, path, headers) => {
        const body = files.read(path);
        return send(new Request(url, { method: "PUT", headers: { ...headers, "Content-Length": String(body.length) }, body }));
      },
    });
  }

  register(auth: Auth, consentVersion: string): Promise<void> {
    this.log.push(`register:${auth.installId}:${consentVersion}`);
    return this.settle("register", undefined, () => this.client.register(auth, consentVersion));
  }
  putPart(auth: Auth, fileId: string, index: number, path: string, bytes: number): Promise<void> {
    this.log.push(`part:${fileId}:${String(index)}`);
    return this.settle("putPart", index, () => this.client.putPart(auth, fileId, index, path, bytes));
  }
  putManifest(auth: Auth, fileId: string, manifest: BetaManifest): Promise<void> {
    this.log.push(`manifest:${fileId}`);
    return this.settle("putManifest", undefined, () => this.client.putManifest(auth, fileId, manifest));
  }
  deleteAll(auth: Auth): Promise<void> {
    this.log.push(`delete:${auth.installId}`);
    return this.settle("deleteAll", undefined, () => this.client.deleteAll(auth));
  }
  deleteFile(auth: Auth, fileId: string): Promise<void> {
    this.log.push(`deleteFile:${fileId}`);
    return this.settle("deleteFile", undefined, () => this.client.deleteFile(auth, fileId));
  }

  /** Repair round 1: `fail` stands in for the network (the request never reaches the Worker); `settled` counts the
   *  calls that have answered, so a test can act right after one returns. */
  fail?: (call: keyof BetaBackend, index?: number) => BackendError | undefined;
  /** Repair round 2 (D4): the Worker processes the request, then the phone gets a network error (the answer is lost). */
  lose?: (call: keyof BetaBackend, index?: number) => boolean;
  settled = 0;
  private settle(call: keyof BetaBackend, index: number | undefined, request: () => Promise<void>): Promise<void> {
    const error = this.fail?.(call, index);
    const answer = error ? Promise.reject(error) : request();
    const lost = () => { throw new BackendError("network", "the answer was lost"); };
    return (this.lose?.(call, index) ? answer.then(lost, lost) : answer).finally(() => { this.settled++; });
  }

  get manifests(): Map<string, BetaManifest> {
    const found = this.bucket.keys("files/").flatMap((key) => {
      const match = /^files\/[^/]+\/([^/]+)\/manifest\.json$/.exec(key);
      return match ? [[match[1], JSON.parse(this.bucket.text(key) ?? "") as BetaManifest] as const] : [];
    });
    return new Map(found);
  }

  uploaded(fileId: string): string {
    return this.bucket.keys("files/").filter((key) => key.split("/")[2] === fileId && key.includes("/part-")).map((key) => this.bucket.text(key)).join("");
  }
}

interface StoredItem { fileId: string; nextTry: number }
const stored = (files: MemoryBetaFiles) => JSON.parse(files.state ?? "{}") as {
  consent: { version: string; share: boolean }; auth: Auth; registered: boolean; outbox: (StoredItem & { sent: number })[];
  deleting: { installId: string; nextTry: number; fileId?: string }[];
};
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
const onlyFile = (backend: { manifests: Map<string, BetaManifest> }) => {
  const ids = [...backend.manifests.keys()];
  expect(ids).toHaveLength(1);
  return ids[0];
};

const BACKENDS = [
  { name: "the fake backend", artifact: "b", make: (files: MemoryBetaFiles) => new FakeBetaBackend(files) },
  { name: "createBetaClient over the Worker (Stage C1)", artifact: "c1", make: (files: MemoryBetaFiles) => new WorkerBackend(files) },
];

describe.each(BACKENDS)("E2E over $name", ({ artifact, make }) => {
  it("a codes run goes finishRun -> outbox -> drain: register, parts, manifest; the upload replays into the same codes report", async () => {
    const files = new MemoryBetaFiles();
    const backend = make(files);
    const outbox = outboxOver(files, backend, { s: T0 });
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
    write(`/tmp/t2.9-${artifact}-codes.jsonl`, uploaded);
  });

  it("a RecordingBuffer-written charge log, queued line by line, splits into parts and keeps its sessions, phases and windows", async () => {
    const input = await happyChargeLog();
    const files = new MemoryBetaFiles();
    const backend = make(files);
    const outbox = outboxOver(files, backend, { s: T0 }, 256 * 1024);
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
    write(`/tmp/t2.9-${artifact}-charge-log.jsonl`, uploaded);
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
      // No retry; the one later call is the C1-b delete of the parts the server had accepted.
      expect(backend.log.slice(calls)).toEqual([`deleteFile:${backend.log[1].split(":")[1]}`]);
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
    // C1-c, D3: a register was attempted, so Delete my data sends the install delete after it.
    const install = backend.log[0]?.split(":")[1] ?? "";
    expect(backend.log).toEqual([`register:${install}:beta-1`, `delete:${install}`]);
    expect(backend.installs.size).toBe(0);
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

describe("Stage C1: client status mapping", () => {
  const auth: Auth = { installId: "00000001-0000-4000-8000-000000000000", secret: "00000002-0000-4000-8000-00000000000000000003-0000-4000-8000-000000000000" };
  const unreachable = () => Promise.reject(new TypeError("Network request failed"));

  it("Client: a rejected fetch or putFile is BackendError network; a non-2xx answer is BackendError with its status", async () => {
    const offline = createBetaClient("https://beta.test", { fetch: unreachable, putFile: unreachable });
    for (const call of [
      () => offline.register(auth, "beta-1"), () => offline.putPart(auth, auth.installId, 0, "p", 1), () => offline.deleteAll(auth),
      () => offline.deleteFile(auth, auth.installId),
    ]) await expect(call()).rejects.toMatchObject({ name: "BackendError", status: "network" });

    const files = new MemoryBetaFiles();
    files.appendPart(auth.installId, 0, "x\n");
    const worker = new WorkerBackend(files);
    await expect(worker.register(auth, "beta-0")).rejects.toMatchObject({ status: 400 });
    await expect(worker.putPart(auth, auth.installId, 0, files.partPath(auth.installId, 0), 2)).rejects.toMatchObject({ status: 401 });
    await worker.register(auth, "beta-1");
    await expect(worker.register(auth, "beta-1")).rejects.toMatchObject({ status: 409 });
    await worker.putPart(auth, auth.installId, 0, files.partPath(auth.installId, 0), 2);
    await expect(worker.putManifest(auth, auth.installId, { parts: [] } as unknown as BetaManifest)).rejects.toMatchObject({ status: 400 });
    await worker.deleteFile(auth, auth.installId);
    await worker.deleteAll(auth);
    await expect(worker.putPart(auth, auth.installId, 0, files.partPath(auth.installId, 0), 2)).rejects.toMatchObject({ name: "BackendError", status: 401 });
  });
});

describe("Stage C1: outbox failure modes (C1-a, C1-b, C1-c, X1, X2)", () => {
  it("A1 (C1-a, D1): a 401 on a part or manifest keeps the file, backs off, then re-registers the same installId and secret", async () => {
    for (const failing of ["putPart", "putManifest"] as const) {
      const { outbox, backend, files, clock } = setup({ partBytes: 512 });
      await outbox.decide(true);
      await outbox.queue("capture", MINE, PHONE);
      await outbox.drain();
      const first = split(backend.uploaded(onlyFile(backend))).provenance;
      const before = stored(files).auth;
      await outbox.queue("codes-scan", MINE, PHONE);
      const [item] = stored(files).outbox;
      // The server no longer knows the install: after part 0 (or at the manifest) it answers 401.
      backend.fail = (call, index) => (call === failing && (index ?? 1) >= 1 ? new BackendError(401, "unknown install") : undefined);
      backend.log.length = 0;
      await outbox.drain();
      expect(backend.log[0]).toBe(`part:${item.fileId}:0`);
      expect(await outbox.status()).toMatchObject({ queued: 1, failed: 0, sharing: true });
      expect(files.parts.has(item.fileId)).toBe(true);
      const after = stored(files);
      expect(after.outbox[0].nextTry - clock.s).toBe(60);
      expect(after.registered).toBe(false);
      expect(after.auth).toEqual(before);
      backend.fail = undefined;
      backend.installs.clear();
      backend.log.length = 0;
      clock.s += 30;
      await outbox.drain();
      expect(backend.log).toEqual([]);
      clock.s = after.outbox[0].nextTry;
      await outbox.drain();
      const manifest = betaManifestSchema.parse(backend.manifests.get(item.fileId));
      expect(backend.log).toEqual([`register:${before.installId}:beta-1`, ...manifest.parts.map((_, i) => `part:${item.fileId}:${String(i)}`), `manifest:${item.fileId}`]);
      expect(manifest.provenance.testerKey).toBe(first.testerKey);
      expect(await outbox.status()).toMatchObject({ queued: 0, failed: 0 });
    }
  });

  it("A2 (C1-a): a register rejected with 400 (or anything but 409) keeps the files queued with backoff", async () => {
    const { outbox, backend, files, clock } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    backend.fail = (call) => (call === "register" ? new BackendError(400, "unknown consent version") : undefined);
    await outbox.drain();
    expect(await outbox.status()).toMatchObject({ queued: 1, failed: 0 });
    expect(files.parts.size).toBe(1);
    const [item] = stored(files).outbox;
    expect(item.nextTry - clock.s).toBe(60);
    backend.fail = undefined;
    clock.s = item.nextTry;
    await outbox.drain();
    expect(backend.manifests.size).toBe(1);
    expect(await outbox.status()).toMatchObject({ queued: 0, failed: 0 });
  });

  it("A3 (C1-a): only 400, 409 and 413 on a part or manifest discard a file; 411 backs off", async () => {
    const { outbox, backend, files, clock } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    backend.fail = (call) => (call === "putPart" ? new BackendError(411, "length required") : undefined);
    await outbox.drain();
    expect(await outbox.status()).toMatchObject({ queued: 1, failed: 0 });
    expect(stored(files).outbox[0].nextTry - clock.s).toBe(60);
    expect(files.parts.size).toBe(1);
  });

  it("A4 (C1b): a pending Delete my data answered 401 is not complete; it backs off and retries until a 204", async () => {
    const { outbox, backend, files, clock } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.drain();
    backend.fail = (call) => (call === "deleteAll" ? new BackendError(401, "unauthorized") : undefined);
    expect(await outbox.deleteMyData()).toBe("Delete requested; it retries until the server confirms.");
    expect(await outbox.status()).toMatchObject({ deletePending: true, needsConsent: false, sharing: false });
    const [pending] = stored(files).deleting;
    expect(pending.nextTry - clock.s).toBe(60);
    backend.fail = undefined;
    clock.s = pending.nextTry;
    await outbox.drain();
    expect(await outbox.status()).toMatchObject({ deletePending: false, needsConsent: true, sharing: false });
    expect(backend.manifests.size).toBe(0);
  });

  it("B1 (C1-b): a file stopped after an accepted part, or with its first part in flight, is deleted on the server by the next drain", async () => {
    // After parts 0-1 were accepted and part 2 failed.
    {
      const { outbox, backend, files, clock } = setup({ partBytes: 512 });
      await outbox.decide(true);
      await outbox.queue("capture", MINE, PHONE);
      backend.fail = (call, index) => (call === "putPart" && index === 2 ? new BackendError("network", "offline") : undefined);
      await outbox.drain();
      const [item] = stored(files).outbox;
      expect(backend.received.get(item.fileId)).toHaveLength(2);
      await outbox.decide(false);
      backend.fail = undefined;
      backend.log.length = 0;
      await outbox.drain();
      expect(backend.log).toEqual([`deleteFile:${item.fileId}`]);
      expect(backend.received.has(item.fileId)).toBe(false);
      expect(stored(files).deleting).toEqual([]);
      clock.s += BACKOFF_MAX_S;
      await outbox.drain();
      expect(backend.log).toHaveLength(1);
    }
    // With part 0 in flight: it lands after the stop.
    {
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
      expect(backend.received.get(item.fileId)).toHaveLength(1);
      await outbox.drain();
      expect(backend.log.at(-1)).toBe(`deleteFile:${item.fileId}`);
      expect(backend.received.has(item.fileId)).toBe(false);
    }
  });

  it("B2 (C1-b, D2): a file failing permanently after any attempted part, part 0 included, is deleted on the server", async () => {
    for (const failAt of [2, 0]) {
      const { outbox, backend, files } = setup({ partBytes: 512 });
      await outbox.decide(true);
      await outbox.queue("capture", MINE, PHONE);
      const [item] = stored(files).outbox;
      backend.fail = (call, index) => (call === "putPart" && index === failAt ? new BackendError(413, "too large") : undefined);
      await outbox.drain();
      expect(await outbox.status()).toMatchObject({ queued: 0, failed: 1 });
      backend.fail = undefined;
      await outbox.drain();
      expect(backend.log.at(-1)).toBe(`deleteFile:${item.fileId}`);
      expect(backend.received.has(item.fileId)).toBe(false);
    }
  });

  it("B3 (C1-b): a file delete that fails offline is retried with backoff; Delete my data supersedes it", async () => {
    const { outbox, backend, files, clock } = setup({ partBytes: 512 });
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    backend.fail = (call, index) => (call === "putPart" && index === 1 ? new BackendError("network", "offline") : undefined);
    await outbox.drain();
    const [item] = stored(files).outbox;
    await outbox.decide(false);
    backend.fail = (call) => (call === "deleteFile" ? new BackendError("network", "offline") : undefined);
    await outbox.drain();
    const [pending] = stored(files).deleting;
    expect(pending).toMatchObject({ fileId: item.fileId });
    expect(pending.nextTry - clock.s).toBe(60);
    expect(await outbox.status()).toMatchObject({ deletePending: false });
    const calls = backend.log.length;
    clock.s += 30;
    await outbox.drain();
    expect(backend.log).toHaveLength(calls);
    backend.fail = undefined;
    clock.s = pending.nextTry;
    await outbox.drain();
    expect(backend.log.at(-1)).toBe(`deleteFile:${item.fileId}`);
    expect(backend.received.has(item.fileId)).toBe(false);
    expect(stored(files).deleting).toEqual([]);

    // A second stopped file with a pending file delete, then Delete my data: only the install delete is sent.
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    backend.fail = (call, index) => (call === "putPart" && index === 1 ? new BackendError("network", "offline") : undefined);
    await outbox.drain();
    await outbox.decide(false);
    backend.fail = (call) => (call === "deleteFile" ? new BackendError("network", "offline") : undefined);
    await outbox.drain();
    expect(stored(files).deleting.filter((d) => d.fileId !== undefined)).toHaveLength(1);
    backend.log.length = 0;
    expect(await outbox.deleteMyData()).toBe("Your beta data was deleted.");
    expect(backend.log).toEqual([`delete:${pending.installId}`]);
    expect(stored(files).deleting).toEqual([]);
  });

  it("C1 (C1-c, W7): Delete my data during an in-flight register leaves no install record in the Worker's bucket", async () => {
    const files = new MemoryBetaFiles();
    const backend = new WorkerBackend(files);
    const outbox = outboxOver(files, backend, { s: T0 });
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    const install = stored(files).auth.installId;
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    while (calls.length === 0) await tick();
    const deleted = outbox.deleteMyData();
    while ((await outbox.status()).sharing) await tick();
    backend.held = undefined;
    calls.shift()?.();
    await drained;
    expect(await deleted).toBe("Your beta data was deleted.");
    expect(backend.log).toEqual([`register:${install}:beta-1`, `delete:${install}`]);
    expect(backend.bucket.keys()).toEqual([`tombstones/${install}.json`]);
    expect(await outbox.status()).toMatchObject({ deletePending: false, needsConsent: true, sharing: false, queued: 0 });
  });

  it("X1: a pending delete confirmed after a new opt-in keeps the new consent", async () => {
    const { outbox, backend, files, clock } = setup();
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.drain();
    backend.fail = (call) => (call === "deleteAll" ? new BackendError("network", "offline") : undefined);
    await outbox.deleteMyData();
    await outbox.decide(true);
    expect(await outbox.status()).toMatchObject({ deletePending: true, sharing: true });
    backend.fail = undefined;
    clock.s = stored(files).deleting[0].nextTry;
    await outbox.drain();
    expect(await outbox.status()).toMatchObject({ deletePending: false, sharing: true, needsConsent: false });
    expect(stored(files).consent).toEqual({ version: "beta-1", share: true });
  });

  it("X2: a stopped file whose in-flight part then fails permanently is not counted as failed", async () => {
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
    backend.fail = (call) => (call === "putPart" ? new BackendError(400, "bad part") : undefined);
    calls.shift()?.();
    await drained;
    expect(await outbox.status()).toMatchObject({ sharing: false, queued: 0, failed: 0 });
  });
});

/** Holds every beta.json write from `hold()` until `open()`; `waiting` counts the writes held. */
function holdWrites(files: MemoryBetaFiles) {
  const write = files.writeState.bind(files);
  let gate: Promise<void> | undefined;
  let release = (): void => undefined;
  const writes = {
    waiting: 0,
    hold() { gate = new Promise<void>((resolve) => { release = resolve; }); },
    open() { gate = undefined; release(); },
  };
  files.writeState = async (text: string) => {
    if (gate) { writes.waiting++; await gate; }
    return write(text);
  };
  return writes;
}

/** An outbox over createBetaClient -> handleRequest, with one file queued. */
async function workerSetup(partBytes?: number) {
  const files = new MemoryBetaFiles();
  const backend = new WorkerBackend(files);
  const clock = { s: T0 };
  const outbox = outboxOver(files, backend, clock, partBytes);
  await outbox.decide(true);
  await outbox.queue("capture", MINE, PHONE);
  return { files, backend, clock, outbox, auth: stored(files).auth, fileId: stored(files).outbox[0].fileId };
}
const SERVER_DELETED = "Your beta data was deleted on the server. Sharing is off.";

describe("Stage C1 repair round 1 (R1-R5, docs/task-runs/T2.9.md)", () => {
  it("R1 (P1b): a switch-off while the state write after a successful register is held sends no part; the file delete follows", async () => {
    const { outbox, backend, files, auth, fileId } = await workerSetup(512);
    const writes = holdWrites(files);
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    while (calls.length === 0) await tick();
    writes.hold();
    backend.held = undefined;
    calls.shift()?.();
    while (writes.waiting === 0) await tick();
    const stopped = outbox.decide(false);
    writes.open();
    await stopped;
    await drained;
    await outbox.drain();
    expect(backend.log).toEqual([`register:${auth.installId}:beta-1`, `deleteFile:${fileId}`]);
    expect(backend.bucket.keys("files/")).toEqual([]);
    expect(stored(files).deleting).toEqual([]);
    expect(await outbox.status()).toMatchObject({ sharing: false, queued: 0 });
  });

  it("R1: a register that answers while decide(false) is saving sends no part; the file delete follows", async () => {
    const { outbox, backend, files, auth, fileId } = await workerSetup(512);
    const writes = holdWrites(files);
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    while (calls.length === 0) await tick();
    writes.hold();
    const stopped = outbox.decide(false);
    while (writes.waiting === 0) await tick();
    backend.held = undefined;
    calls.shift()?.();
    while (backend.settled === 0) await tick();
    await tick();
    writes.open();
    await stopped;
    await drained;
    await outbox.drain();
    expect(backend.log).toEqual([`register:${auth.installId}:beta-1`, `deleteFile:${fileId}`]);
    expect(backend.bucket.keys("files/")).toEqual([]);
    expect(await outbox.status()).toMatchObject({ sharing: false, queued: 0 });
  });

  it("R1: a switch-off while the state write after a part is held sends no further part and no manifest", async () => {
    // Several parts (the next call is a part) and one part (the next call is the manifest).
    for (const partBytes of [512, undefined]) {
      const { outbox, backend, files, auth, fileId } = await workerSetup(partBytes);
      const writes = holdWrites(files);
      const calls: (() => void)[] = [];
      backend.held = calls;
      const drained = outbox.drain();
      while (calls.length === 0) await tick();
      calls.shift()?.();
      while (backend.log.length < 2 || calls.length === 0) await tick();
      expect(backend.log.at(-1)).toBe(`part:${fileId}:0`);
      writes.hold();
      backend.held = undefined;
      calls.shift()?.();
      while (writes.waiting === 0) await tick();
      const stopped = outbox.decide(false);
      writes.open();
      await stopped;
      await drained;
      await outbox.drain();
      expect(backend.log).toEqual([`register:${auth.installId}:beta-1`, `part:${fileId}:0`, `deleteFile:${fileId}`]);
      expect(backend.bucket.keys("files/")).toEqual([]);
      expect(await outbox.status()).toMatchObject({ sharing: false, queued: 0 });
    }
  });

  it("R2 (P2), D1: an install deleted on the server answers 410 to the re-register and ends in a local wipe; a later opt-in is a new identity", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup(512);
    await outbox.drain();
    const first = split(backend.uploaded(onlyFile(backend))).provenance;
    // The owner deletes the install on the tester's request (by email).
    await backend.deleteAll(auth);
    await outbox.queue("codes-scan", MINE, PHONE);
    const [queued] = stored(files).outbox;
    backend.log.length = 0;
    for (let i = 0; i < 12; i++) {
      clock.s += 7 * 3600;
      await outbox.drain();
    }
    expect(backend.log).toEqual([`part:${queued.fileId}:0`, `register:${auth.installId}:beta-1`]);
    expect(await outbox.status()).toEqual({ needsConsent: true, sharing: false, queued: 0, failed: 0, deletePending: false, line: SERVER_DELETED });
    expect(stored(files)).toMatchObject({ consent: null, auth: null, registered: false, outbox: [], deleting: [] });
    expect(files.parts.size).toBe(0);
    expect(backend.bucket.keys()).toEqual([`tombstones/${auth.installId}.json`]);

    await outbox.decide(true);
    const fresh = stored(files).auth;
    expect(fresh.installId).not.toBe(auth.installId);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.drain();
    const provenance = split(backend.uploaded(onlyFile(backend))).provenance;
    expect(provenance.testerKey).not.toBe(first.testerKey);
    expect(backend.bucket.keys(`files/${fresh.installId}/`).length).toBeGreaterThan(0);
    expect(await outbox.status()).toMatchObject({ sharing: true, queued: 0, failed: 0 });
  });

  it("R2, D1: a switch-off while the re-register is in flight, answered 410, wipes locally and drops the file delete", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup(512);
    await outbox.drain();
    await backend.deleteAll(auth);
    await outbox.queue("codes-scan", MINE, PHONE);
    await outbox.drain();                       // part 0: 401, backoff
    clock.s = stored(files).outbox[0].nextTry;
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    while (calls.length === 0) await tick();    // register (it will answer 410)
    await outbox.decide(false);                 // queues the file delete
    expect(stored(files).deleting).toHaveLength(1);
    backend.held = undefined;
    calls.shift()?.();
    await drained;
    expect(await outbox.status()).toMatchObject({ needsConsent: true, sharing: false, deletePending: false, line: SERVER_DELETED });
    expect(stored(files)).toMatchObject({ consent: null, auth: null, deleting: [] });
    backend.log.length = 0;
    await outbox.drain();
    expect(backend.log).toEqual([]);
  });

  it("R2, D1: a 401 right after a register answered 201, or after a first-register 409 and an accepted part, is an ordinary retry with the same secret, not a wipe", async () => {
    for (const registerAnswer of [undefined, 409] as const) {
      const { outbox, backend, files } = setup();
      await outbox.decide(true);
      const before = stored(files).auth;
      if (registerAnswer === 409) backend.installs.add(before.installId);
      const failing = registerAnswer === 409 ? "putManifest" : "putPart";
      backend.fail = (call) => (call === "register" && registerAnswer === 409 ? new BackendError(409, "exists") : call === failing ? new BackendError(401, "unknown install") : undefined);
      await outbox.queue("capture", MINE, PHONE);
      await outbox.drain();
      expect(backend.log.map((entry) => entry.split(":")[0])).toEqual(registerAnswer === 409 ? ["register", "part", "manifest"] : ["register", "part"]);
      expect(await outbox.status()).toMatchObject({ sharing: true, queued: 1, failed: 0 });
      expect(stored(files).auth).toEqual(before);
    }
  });

  it("R3 (C1-a): after a 401, every partly sent file is sent again from part 0", async () => {
    const { outbox, backend, files, clock } = setup({ partBytes: 512 });
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    await outbox.queue("codes-scan", MINE, PHONE);
    const [a, b] = stored(files).outbox;
    backend.fail = (call, index) => (call === "putPart" && index === 2 ? new BackendError("network", "offline") : undefined);
    await outbox.drain();                       // a: parts 0-1, then offline
    backend.fail = (call, index) => (call === "putPart" && index === 1 ? new BackendError("network", "offline") : undefined);
    await outbox.drain();                       // a waits; b: part 0, then offline
    expect(stored(files).outbox.map((item) => item.sent)).toEqual([2, 1]);
    clock.s = Math.max(...stored(files).outbox.map((item) => item.nextTry));
    backend.fail = (call) => (call === "putPart" ? new BackendError(401, "unknown install") : undefined);
    await outbox.drain();                       // a: 401
    expect(stored(files).outbox.map((item) => item.sent)).toEqual([0, 0]);
    backend.fail = undefined;
    backend.installs.clear();
    backend.log.length = 0;
    clock.s = Math.max(...stored(files).outbox.map((item) => item.nextTry));
    await outbox.drain();
    const parts = (id: string) => betaManifestSchema.parse(backend.manifests.get(id)).parts.map((_, i) => `part:${id}:${String(i)}`);
    expect(backend.log.slice(1)).toEqual([...parts(a.fileId), `manifest:${a.fileId}`, ...parts(b.fileId), `manifest:${b.fileId}`]);
  });

  it("R5, D1: a pending file delete still succeeds after a 401 and a re-register, which keeps the secret", async () => {
    const { outbox, backend, files, clock, auth, fileId } = await workerSetup(512);
    backend.fail = (call, index) => (call === "putPart" && index === 2 ? new BackendError("network", "offline") : undefined);
    await outbox.drain();                       // parts 0-1 on the server
    expect(backend.bucket.keys(`files/${auth.installId}/${fileId}/`)).toHaveLength(2);
    await outbox.decide(false);                 // queues the file delete
    backend.fail = (call) => (call === "deleteFile" ? new BackendError("network", "offline") : undefined);
    await outbox.drain();                       // offline: backoff
    // The server loses the install record (no tombstone), so the next upload gets 401 and re-registers.
    await backend.bucket.delete(`installs/${auth.installId}.json`);
    await outbox.decide(true);
    await outbox.queue("codes-scan", MINE, PHONE);
    clock.s += 1;
    await outbox.drain();
    expect(stored(files).auth).toEqual(auth);
    clock.s = stored(files).outbox[0].nextTry;
    await outbox.drain();                       // the delete is still offline; register (201, same secret), upload
    expect(stored(files).outbox).toEqual([]);
    backend.fail = undefined;
    clock.s = stored(files).deleting[0].nextTry;
    await outbox.drain();
    expect(backend.log.at(-1)).toBe(`deleteFile:${fileId}`);
    expect(backend.bucket.keys(`files/${auth.installId}/${fileId}/`)).toEqual([]);
    expect(stored(files).deleting).toEqual([]);
  });
});

const uuid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const partCalls = (backend: WorkerBackend, fileId: string) =>
  betaManifestSchema.parse(backend.manifests.get(fileId)).parts.map((_, i) => `part:${fileId}:${String(i)}`);

describe("Stage C1 repair round 2 (D1-D4, docs/task-runs/T2.9.md)", () => {
  it("D1 (Q1): a 401 from in front of the Worker, with the install intact, pauses uploads without a wipe; they resume", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup(512);
    await outbox.drain();
    const { betaId } = await outbox.status();
    await outbox.queue("codes-scan", MINE, PHONE);
    const [queued] = stored(files).outbox;
    backend.fail = (call) => (call === "putPart" ? new BackendError(401, "not from the Worker") : undefined);
    backend.log.length = 0;
    await outbox.drain();                       // part 0: 401
    backend.fail = undefined;
    clock.s = stored(files).outbox[0].nextTry;
    await outbox.drain();                       // register, same installId and secret: 409
    expect(backend.log).toEqual([`part:${queued.fileId}:0`, `register:${auth.installId}:beta-1`]);
    expect(stored(files)).toMatchObject({ auth, consent: { version: "beta-1", share: true } });
    expect(await outbox.status()).toMatchObject({ sharing: true, queued: 1, failed: 0, betaId, line: `Uploads paused. Beta ID ${betaId ?? ""}.` });
    expect(stored(files).outbox[0].nextTry - clock.s).toBe(120);
    clock.s = stored(files).outbox[0].nextTry;
    await outbox.drain();
    expect(backend.log.slice(2)).toEqual([...partCalls(backend, queued.fileId), `manifest:${queued.fileId}`]);
    expect(backend.manifests.size).toBe(2);
    expect(await outbox.status()).toMatchObject({ sharing: true, queued: 0, line: "Beta data sharing is on; nothing waiting to upload." });
  });

  it("D1 (Q2): a stale secret (beta.json restored) while the install is live keeps consent, files and the server data; uploads pause", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup(512);
    await outbox.drain();
    await outbox.queue("codes-scan", MINE, PHONE);
    const [queued] = stored(files).outbox;
    const onServer = backend.bucket.keys();
    const stale = { installId: auth.installId, secret: `${uuid(0x201)}${uuid(0x202)}` };
    files.state = (files.state ?? "").replace(auth.secret, stale.secret);
    const restored = outboxOver(files, backend, clock, 512);
    const { betaId } = await restored.status();
    backend.log.length = 0;
    for (let i = 0; i < 6; i++) {
      clock.s += 7 * 3600;
      await restored.drain();
    }
    expect(backend.log).toEqual(Array.from({ length: 3 }, () => [`part:${queued.fileId}:0`, `register:${auth.installId}:beta-1`]).flat());
    expect(stored(files)).toMatchObject({ auth: stale, consent: { version: "beta-1", share: true }, deleting: [] });
    expect(await restored.status()).toMatchObject({ needsConsent: false, sharing: true, queued: 1, failed: 0, betaId, line: `Uploads paused. Beta ID ${betaId ?? ""}.` });
    expect(files.parts.has(queued.fileId)).toBe(true);
    expect(backend.bucket.keys()).toEqual(onServer);
  });

  it("D1: after a 410 wipe, a new identity whose first register answer was lost uploads on its 409, without a pause", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup(512);
    await outbox.drain();
    await backend.deleteAll(auth);
    await outbox.queue("codes-scan", MINE, PHONE);
    await outbox.drain();                       // part 0: 401
    clock.s = stored(files).outbox[0].nextTry;
    await outbox.drain();                       // register: 410, wipe
    await outbox.decide(true);
    await outbox.queue("capture", MINE, PHONE);
    backend.lose = (call) => call === "register";
    await outbox.drain();                       // the new install is stored, its answer lost
    backend.lose = undefined;
    clock.s = stored(files).outbox[0].nextTry;
    await outbox.drain();                       // 409: the earlier register succeeded
    expect(await outbox.status()).toMatchObject({ sharing: true, queued: 0, line: "Beta data sharing is on; nothing waiting to upload." });
  });

  it("C1-c, D3: a register answering after Delete my data and a new opt-in leaves the new identity to register itself", async () => {
    const { outbox, backend, files, auth } = await workerSetup();
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    while (calls.length === 0) await tick();    // the old identity's register
    const deleted = outbox.deleteMyData();
    while ((await outbox.status()).sharing) await tick();
    await outbox.decide(true);
    const fresh = stored(files).auth;
    await outbox.queue("capture", MINE, PHONE);
    backend.held = undefined;
    calls.shift()?.();
    await drained;
    await deleted;
    await outbox.drain();
    expect(backend.log.slice(0, 3)).toEqual([`register:${auth.installId}:beta-1`, `delete:${auth.installId}`, `register:${fresh.installId}:beta-1`]);
    expect(backend.manifests.size).toBe(1);
    expect(backend.bucket.keys(`files/${auth.installId}/`)).toEqual([]);
  });

  it("D2 (Q3): a part the Worker stored but whose answer was lost is deleted on the server after a stop, across a restart", async () => {
    const { outbox, backend, files, clock, auth, fileId } = await workerSetup(512);
    backend.lose = (call, index) => call === "putPart" && index === 0;
    await outbox.drain();
    backend.lose = undefined;
    expect(backend.bucket.keys(`files/${auth.installId}/${fileId}/`)).toHaveLength(1);
    expect(stored(files).outbox[0].sent).toBe(0);
    const restarted = outboxOver(files, backend, clock, 512);
    await restarted.decide(false);
    await restarted.drain();
    expect(backend.log.at(-1)).toBe(`deleteFile:${fileId}`);
    expect(backend.bucket.keys("files/")).toEqual([]);
    expect(stored(files).deleting).toEqual([]);
  });

  it("D2 (Q3): the same lost part, then a permanent failure of that part, is deleted on the server, across a restart", async () => {
    const { outbox, backend, files, clock, auth, fileId } = await workerSetup(512);
    backend.lose = (call, index) => call === "putPart" && index === 0;
    await outbox.drain();
    backend.lose = undefined;
    const restarted = outboxOver(files, backend, clock, 512);
    backend.fail = (call) => (call === "putPart" ? new BackendError(400, "refused") : undefined);
    clock.s = stored(files).outbox[0].nextTry;
    await restarted.drain();
    backend.fail = undefined;
    expect(await restarted.status()).toMatchObject({ queued: 0, failed: 1 });
    await restarted.drain();
    expect(backend.log.at(-1)).toBe(`deleteFile:${fileId}`);
    expect(backend.bucket.keys(`files/${auth.installId}/`)).toEqual([]);
  });

  it("D2: an app killed while part 0 is in flight still deletes it on the server after a restart and a stop", async () => {
    const { outbox, backend, files, clock, fileId } = await workerSetup(512);
    const calls: (() => void)[] = [];
    backend.held = calls;
    void outbox.drain();
    while (calls.length === 0) await tick();
    calls.shift()?.();                          // register
    while (backend.log.length < 2 || calls.length === 0) await tick();
    expect(backend.log.at(-1)).toBe(`part:${fileId}:0`);
    backend.held = undefined;                   // the held part never returns: the app was killed
    const restarted = outboxOver(files, backend, clock, 512);
    await restarted.decide(false);
    await restarted.drain();
    expect(backend.log.at(-1)).toBe(`deleteFile:${fileId}`);
    expect(stored(files).deleting).toEqual([]);
  });

  it("D3: an app killed while register is in flight still sends the install delete after a restart", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup();
    const calls: (() => void)[] = [];
    backend.held = calls;
    void outbox.drain();
    while (calls.length === 0) await tick();    // register held and never returns: the app was killed
    backend.held = undefined;
    const restarted = outboxOver(files, backend, clock);
    expect(await restarted.deleteMyData()).toBe("Your beta data was deleted.");
    expect(backend.log).toEqual([`register:${auth.installId}:beta-1`, `delete:${auth.installId}`]);
  });

  it("D3 (Q4): Delete my data after a register whose answer was lost removes the install record, across a restart", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup();
    backend.lose = (call) => call === "register";
    await outbox.drain();
    backend.lose = undefined;
    expect(backend.bucket.keys()).toEqual([`installs/${auth.installId}.json`]);
    expect(stored(files).registered).toBe(false);
    const restarted = outboxOver(files, backend, clock);
    expect(await restarted.deleteMyData()).toBe("Your beta data was deleted.");
    expect(backend.log).toEqual([`register:${auth.installId}:beta-1`, `delete:${auth.installId}`]);
    expect(backend.bucket.keys()).toEqual([`tombstones/${auth.installId}.json`]);
    expect(await restarted.status()).toMatchObject({ deletePending: false, needsConsent: true, sharing: false, queued: 0 });
  });

  it("D3, C1b: Delete my data after a register that never reached the Worker sends the delete; the Worker's 204 writes nothing", async () => {
    const { outbox, backend, auth } = await workerSetup();
    backend.fail = (call) => (call === "register" ? new BackendError("network", "offline") : undefined);
    await outbox.drain();
    backend.fail = undefined;
    expect(await outbox.deleteMyData()).toBe("Your beta data was deleted.");
    expect(backend.log).toEqual([`register:${auth.installId}:beta-1`, `delete:${auth.installId}`]);
    expect(backend.bucket.keys()).toEqual([]);
    expect(await outbox.status()).toMatchObject({ deletePending: false, needsConsent: true, sharing: false });
    // A new identity starts with no register attempted, so its Delete my data calls no server.
    await outbox.decide(true);
    expect(await outbox.deleteMyData()).toBe("Your beta data was deleted.");
    expect(backend.log).toHaveLength(2);
  });
});

const DELETE_PENDING = "Deleting your uploaded beta data; it retries until the server confirms.";
const NOTHING_WAITING = "Beta data sharing is on; nothing waiting to upload.";
const recheck = (files: MemoryBetaFiles) => (JSON.parse(files.state ?? "{}") as { recheck: boolean }).recheck;

describe("Stage C1b (docs/task-runs/T2.9.md)", () => {
  it("C1b-1 (PA): a 401 from in front of the Worker on Delete my data is not done; it stays pending with backoff until the Worker's 204", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup(512);
    await outbox.drain();
    const onServer = backend.bucket.keys();
    backend.fail = (call) => (call === "deleteAll" ? new BackendError(401, "not from the Worker") : undefined);
    expect(await outbox.deleteMyData()).toBe("Delete requested; it retries until the server confirms.");
    expect(await outbox.status()).toMatchObject({ deletePending: true, needsConsent: false, sharing: false, line: DELETE_PENDING });
    const [pending] = stored(files).deleting;
    expect(pending.nextTry - clock.s).toBe(60);
    expect(stored(files).consent).toEqual({ version: "beta-1", share: false });
    expect(backend.bucket.keys()).toEqual(onServer);
    backend.fail = undefined;
    clock.s = pending.nextTry;
    await outbox.drain();
    expect(backend.log.filter((entry) => entry === `delete:${auth.installId}`)).toHaveLength(2);
    expect(backend.bucket.keys()).toEqual([`tombstones/${auth.installId}.json`]);
    expect(await outbox.status()).toMatchObject({ deletePending: false, needsConsent: true, sharing: false });
    expect(stored(files).deleting).toEqual([]);
  });

  it("C1b-1: Delete my data with a stale secret while the install is live (the Worker's 401) stays pending and keeps retrying; the server data stays", async () => {
    const { outbox, backend, files, clock, auth } = await workerSetup(512);
    await outbox.drain();
    const onServer = backend.bucket.keys();
    files.state = (files.state ?? "").replace(auth.secret, `${uuid(0x201)}${uuid(0x202)}`);
    const restored = outboxOver(files, backend, clock, 512);
    expect(await restored.deleteMyData()).toBe("Delete requested; it retries until the server confirms.");
    for (let i = 0; i < 3; i++) {
      clock.s = stored(files).deleting[0].nextTry;
      await restored.drain();
    }
    expect(backend.log.filter((entry) => entry === `delete:${auth.installId}`)).toHaveLength(4);
    expect(stored(files).deleting[0].nextTry - clock.s).toBe(480);
    expect(await restored.status()).toMatchObject({ deletePending: true, needsConsent: false, line: DELETE_PENDING });
    expect(backend.bucket.keys()).toEqual(onServer);
  });

  it("C1b-1 (PH): a 401 from in front of the Worker on a pending file delete is retried; the Worker's 204 then removes the parts", async () => {
    const { outbox, backend, files, clock, auth, fileId } = await workerSetup(512);
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    while (calls.length === 0) await tick();
    calls.shift()?.();                          // register
    while (backend.log.length < 2 || calls.length === 0) await tick();
    await outbox.decide(false);                 // part 0 in flight: queues the file delete
    backend.held = undefined;
    calls.shift()?.();
    await drained;
    backend.fail = (call) => (call === "deleteFile" ? new BackendError(401, "not from the Worker") : undefined);
    await outbox.drain();
    const [pending] = stored(files).deleting;
    expect(pending).toMatchObject({ fileId });
    expect(pending.nextTry - clock.s).toBe(60);
    expect(backend.bucket.keys(`files/${auth.installId}/${fileId}/`)).toHaveLength(1);
    backend.fail = undefined;
    clock.s = pending.nextTry;
    await outbox.drain();
    expect(backend.log.slice(-2)).toEqual([`deleteFile:${fileId}`, `deleteFile:${fileId}`]);
    expect(backend.bucket.keys("files/")).toEqual([]);
    expect(stored(files).deleting).toEqual([]);
  });

  it("C1b-3 (PB): paused, then off and on with nothing queued: the stopped file's delete succeeds and the paused line is gone", async () => {
    const { outbox, backend, files, clock } = await workerSetup(512);
    await outbox.drain();
    await outbox.queue("codes-scan", MINE, PHONE);
    backend.fail = (call) => (call === "putPart" ? new BackendError(401, "not from the Worker") : undefined);
    await outbox.drain();                       // part 0: 401
    backend.fail = undefined;
    clock.s = stored(files).outbox[0].nextTry;
    await outbox.drain();                       // register: 409, paused
    const { betaId } = await outbox.status();
    expect((await outbox.status()).line).toBe(`Uploads paused. Beta ID ${betaId ?? ""}.`);
    await outbox.decide(false);
    await outbox.decide(true);
    await outbox.drain();                       // the file delete: 204
    expect(backend.log.at(-1)).toMatch(/^deleteFile:/);
    expect(stored(files).deleting).toEqual([]);
    expect(await outbox.status()).toMatchObject({ sharing: true, queued: 0, line: NOTHING_WAITING });
    expect(recheck(files)).toBe(false);
  });

  it("C1b-3: a re-register answering 409 after a stop, with nothing queued, clears the paused state", async () => {
    const { outbox, backend, files, clock } = await workerSetup(512);
    await outbox.drain();
    await outbox.queue("codes-scan", MINE, PHONE);
    backend.fail = (call) => (call === "putPart" ? new BackendError(401, "not from the Worker") : undefined);
    await outbox.drain();                       // part 0: 401
    backend.fail = (call) => (call === "deleteFile" ? new BackendError("network", "offline") : undefined);
    clock.s = stored(files).outbox[0].nextTry;
    const calls: (() => void)[] = [];
    backend.held = calls;
    const drained = outbox.drain();
    while (calls.length === 0) await tick();    // the re-register, which will answer 409
    await outbox.decide(false);
    backend.held = undefined;
    calls.shift()?.();
    await drained;
    expect(recheck(files)).toBe(false);
    await outbox.decide(true);
    expect(await outbox.status()).toMatchObject({ sharing: true, queued: 0, line: NOTHING_WAITING });
  });

  it("C1b-4 (PG): a stop or Delete my data during the save before the first register sends no register and leaves the bucket empty", async () => {
    for (const act of ["stop", "delete"] as const) {
      const { outbox, backend, files, auth, fileId } = await workerSetup(512);
      const writes = holdWrites(files);
      writes.hold();
      const drained = outbox.drain();
      while (writes.waiting === 0) await tick();   // the registerAttempted save
      const acted = act === "stop" ? outbox.decide(false) : outbox.deleteMyData();
      writes.open();
      await drained;
      const message = await acted;
      await outbox.drain();
      expect(backend.log).toEqual([act === "stop" ? `deleteFile:${fileId}` : `delete:${auth.installId}`]);
      expect(backend.bucket.keys()).toEqual([]);
      expect(stored(files).deleting).toEqual([]);
      if (act === "delete") expect(message).toBe("Your beta data was deleted.");
      expect(await outbox.status()).toMatchObject({ sharing: false, queued: 0, deletePending: false });
    }
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
