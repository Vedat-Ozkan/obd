// T2.9 Stage C2: docs/specs/T2.9-beta-data-upload.md Verification "Stage C2" (the full-chain E2E and I1–I7; failure
// modes listed in docs/task-runs/T2.9.md before any code), plus the orchestrator's ruling (3) on a redact failure (I8).
// Chain: outbox (Stage B) -> createBetaClient (C1) -> handleRequest over an in-memory bucket -> runIntake into a temp
// repoRoot. Artifact: /tmp/t2.9-c2-intake.txt (runIntake's log lines). Nothing is written under the real fixtures/.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBetaClient } from "../../apps/mobile/src/beta/client.js";
import { createBetaOutbox } from "../../apps/mobile/src/beta/outbox.js";
import type { GarageVehicle } from "../../apps/mobile/src/garage/flow.js";
import { finishRun } from "../../apps/mobile/src/runFiles.js";
import { MemoryBetaFiles, MemoryBucket } from "../../apps/mobile/test/fakeBeta.js";
import { FakeTargets } from "../../apps/mobile/test/fakeTargets.js";
import { replayRecording } from "../../packages/obd-core/scripts/replay.js";
import { parseRecording } from "../../packages/obd-core/src/recording/format.js";
import type { BetaManifest } from "../../packages/obd-core/src/recording/provenance.js";
import { codesReportFromRecording } from "../../packages/obd-core/src/report/replay.js";
import { handleRequest } from "../beta-backend/handler.js";
import { runIntake, uvRedact, type IntakeDeps } from "./intake.js";

// Repair 2 crash snapshots: while `hook.on`, every fs mutation calls hook.after, so a test can copy the temp repo at
// each point a run could be killed. Off, the wrappers are plain pass-throughs.
const hook = vi.hoisted(() => ({ on: false, after: () => {} }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const wrap = <F extends (...args: never[]) => unknown>(f: F) => ((...args: Parameters<F>) => {
    const out = f(...args);
    if (hook.on) hook.after();
    return out;
  }) as F;
  return { ...fs, default: fs, writeFileSync: wrap(fs.writeFileSync), renameSync: wrap(fs.renameSync),
    rmSync: wrap(fs.rmSync), rmdirSync: wrap(fs.rmdirSync), mkdirSync: wrap(fs.mkdirSync) };
});
afterEach(() => { hook.on = false; });

const REPO = new URL("../../", import.meta.url);
const PHONE = readFileSync(new URL("fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl", REPO), "latin1");
const HEADING = { vehicle: "2024 Chevrolet Equinox EV", date: "2026-10-03", result: { sent: 10, total: 10 } };
const MINE: GarageVehicle = { id: "1", catalogId: "chevrolet-equinox-ev-2024", ownership: "mine" };
const CHECKED: GarageVehicle = { id: "2", catalogId: "chevrolet-equinox-ev-2024", ownership: "checked" };
const NOW = new Date("2026-10-03T12:00:00Z");
const ADMIN = "test-admin-token-not-a-real-secret";
const BASE = "https://beta.test";
const ARTIFACT = "/tmp/t2.9-c2-intake.txt";
const OTHER = "0000ffff-0000-4000-8000-000000000000";

// Synthetic (tools/spike/test_redact_vin.py): the repo's synthetic VIN, whose serial is "CVIN00".
const VIN = "1C4SYNTHETICVIN00";
const SERIAL = VIN.slice(11);
/** ISO-TP frames as the ELM prints them with ATH1 (tools/spike/test_redact_vin.py `frames`). */
function frames(header: string, payload: number[]): string[] {
  const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  const out = [`${header}1${payload.length.toString(16).padStart(3, "0").toUpperCase()}${hex(payload.slice(0, 6))}`];
  for (let i = 6, n = 1; i < payload.length; i += 7, n++) out.push(`${header}2${(n & 0xf).toString(16).toUpperCase()}${hex(payload.slice(i, i + 7))}`);
  return out;
}
/** A synthetic capture: 0902 answered by two ECUs, interleaved, cut into 11-character rx chunks. Python json.dumps form. */
function syntheticCapture(): string {
  const vin = [0x49, 0x02, 0x01, ...Array.from(VIN, (c) => c.charCodeAt(0))];
  const a = frames("18DAF117", vin);
  const b = frames("18DAF128", vin);
  const reply = `${a.flatMap((f, i) => [f, b[i]]).join("\r")}\r\r>`;
  const rows = ['{"t": 0.5, "dir": "meta", "car": "synthetic"}', '{"t": 1.5, "dir": "tx", "data": "0902\\r"}'];
  for (let i = 0; i < reply.length; i += 11) rows.push(`{"t": ${String(i + 2)}.5, "dir": "rx", "data": ${JSON.stringify(reply.slice(i, i + 11))}}`);
  return rows.map((row) => `${row}\n`).join("");
}

const idSource = (base: number) => {
  let n = base;
  return () => `${(++n).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
};

/** One Worker over one bucket; each phone() is an install talking to it through the real client. */
function world() {
  const bucket = new MemoryBucket(() => NOW);
  const env = { BETA_BUCKET: bucket, ADMIN_TOKEN: ADMIN };
  const fetched: string[] = [];
  const serverFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    fetched.push(new URL(request.url).pathname);
    return handleRequest(request, env, NOW);
  }) as typeof fetch;
  function phone(base: number, month = { value: "2026-10" }) {
    const files = new MemoryBetaFiles();
    const backend = createBetaClient(BASE, {
      fetch: serverFetch,
      putFile: (url, path, headers) => {
        const body = files.read(path);
        return handleRequest(new Request(url, { method: "PUT", headers: { ...headers, "Content-Length": String(body.length) }, body }), env, NOW);
      },
    });
    return createBetaOutbox({ files, backend, newId: idSource(base), nowS: () => 1_000_000, month: () => month.value, appVersion: "1.0.0" });
  }
  return { bucket, fetched, serverFetch, phone };
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "t2.9-c2-"));
  roots.push(root);
  mkdirSync(join(root, "tools/spike"), { recursive: true });
  copyFileSync(new URL("tools/spike/redact_vin.py", REPO), join(root, "tools/spike/redact_vin.py"));
  return root;
}
/** Isolated tests: a stand-in for redact_vin.py that writes the .redacted.jsonl beside the original. */
const fakeRedact = (path: string) => {
  writeFileSync(path.replace(/\.jsonl$/, ".redacted.jsonl"), readFileSync(path), { flag: "wx" });
  return Promise.resolve();
};
function deps(w: ReturnType<typeof world>, repoRoot: string, log: string[], extra: Partial<IntakeDeps> = {}): IntakeDeps {
  return { fetch: w.serverFetch, baseUrl: BASE, adminToken: ADMIN, repoRoot, now: NOW, redact: fakeRedact, log: (line) => { log.push(line); }, ...extra };
}
/** Every file under <root>/fixtures, relative to root. */
function written(root: string): string[] {
  const dir = join(root, "fixtures");
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1)).sort();
}
const recordingFiles = (root: string) => written(root).filter((path) => path.startsWith("fixtures/recordings/"));
const index = (root: string) => JSON.parse(readFileSync(join(root, "fixtures/beta-intake-index.json"), "utf8")) as { version: 1; files: { installId: string; fileId: string; month: string; paths: string[] }[] };
const manifestKeys = (bucket: MemoryBucket) => bucket.keys("files/").filter((key) => key.endsWith("/manifest.json"));
const manifestAt = (bucket: MemoryBucket, key: string) => JSON.parse(bucket.text(key) ?? "") as BetaManifest;

/** One install uploads the committed phone-console recording as codes-scan; returns its server keys. */
async function uploaded(w: ReturnType<typeof world>, base = 0, month?: { value: string }) {
  const outbox = w.phone(base, month);
  await outbox.decide(true);
  expect(await outbox.queue("codes-scan", MINE, PHONE)).toBe("Queued for beta upload.");
  await outbox.drain();
  const keys = manifestKeys(w.bucket).filter((key) => !known.has(key));
  expect(keys).toHaveLength(1);
  known.add(keys[0]);
  const prefix = keys[0].slice(0, -"manifest.json".length);
  return { outbox, manifestKey: keys[0], part0: `${prefix}part-000.jsonl`, manifest: manifestAt(w.bucket, keys[0]) };
}
const known = new Set<string>();
afterEach(() => { known.clear(); });

describe("Stage C2 full chain", () => {
  it("outbox -> client -> Worker -> intake -> redact_vin.py: both files land, replay, carry no serial; Delete my data removes them", async () => {
    const w = world();
    const outbox = w.phone(0);
    await outbox.decide(true);
    const plain = await finishRun("codes", PHONE, HEADING, new FakeTargets());
    const outcome = await finishRun("codes", PHONE, HEADING, new FakeTargets(), (jsonl) => outbox.queue("codes-scan", MINE, jsonl));
    expect(outcome.status).toBe(`${plain.status} Queued for beta upload.`);
    expect(await outbox.queue("capture", CHECKED, syntheticCapture())).toBe("Queued for beta upload.");
    await outbox.drain();
    expect(manifestKeys(w.bucket)).toHaveLength(2);

    const root = tempRepo();
    const log: string[] = [];
    const first = await runIntake(deps(w, root, log, { redact: uvRedact(root) }));
    expect(first.refused).toEqual([]);
    expect(first.added).toHaveLength(2);
    const codes = first.added.find((path) => path.includes("-codes-scan-")) ?? "";
    expect(codes).toMatch(/^fixtures\/recordings\/chevrolet-equinox-ev-2024-beta-[0-9a-f]{8}\/2026-10-codes-scan-[0-9a-f]{8}\.jsonl$/);
    const capture = first.added.find((path) => path.includes("-capture-")) ?? "";
    expect(capture).toMatch(/^fixtures\/recordings\/chevrolet-equinox-ev-2024-beta-[0-9a-f]{8}\/2026-10-capture-[0-9a-f]{8}\.jsonl$/);
    const redacted = (path: string) => path.replace(/\.jsonl$/, ".redacted.jsonl");
    for (const path of first.added) {
      expect(existsSync(join(root, path))).toBe(true);
      expect(existsSync(join(root, redacted(path)))).toBe(true);
    }
    // The redacted copy replays green into the same codes report as the committed input.
    const copy = parseRecording(readFileSync(join(root, redacted(codes)), "latin1"));
    await replayRecording(copy);
    expect(await codesReportFromRecording(copy)).toEqual(await codesReportFromRecording(parseRecording(PHONE)));
    // No written file holds the synthetic serial, in ASCII or hex.
    const hexSerial = Buffer.from(SERIAL, "latin1").toString("hex");
    const all = written(root);
    expect(all).toHaveLength(5);
    for (const path of all) {
      const text = readFileSync(join(root, path), "latin1");
      for (const form of [SERIAL, hexSerial, hexSerial.toUpperCase()]) expect(text.includes(form), path).toBe(false);
    }
    const listed = index(root).files;
    expect(listed.map((entry) => entry.paths[0]).sort()).toEqual([...first.added].sort());
    expect(listed.every((entry) => entry.paths.length === 2 && entry.paths[1] === redacted(entry.paths[0]))).toBe(true);

    expect(await outbox.deleteMyData()).toBe("Your beta data was deleted.");
    expect(w.bucket.keys("files/")).toEqual([]);
    const second = await runIntake(deps(w, root, log, { redact: uvRedact(root) }));
    expect(second.deleted.sort()).toEqual(first.added.flatMap((path) => [path, redacted(path)]).sort());
    expect(recordingFiles(root)).toEqual([]);
    expect(index(root).files).toEqual([]);
    writeFileSync(ARTIFACT, `${log.join("\n")}\n`);
  }, 60_000);
});

describe("Stage C2 intake failure modes", () => {
  it("I1: a part altered to hold an unmasked F18C payload changes on re-scrub: refused, not written, left on the server", async () => {
    const w = world();
    const { manifestKey, part0, manifest } = await uploaded(w);
    const text = w.bucket.text(part0) ?? "";
    const rows = text.split("\n").slice(0, -1);
    const provenance = rows.pop() ?? "";
    const t = /^\{"t": ([^,]+),/.exec(provenance)?.[1] ?? "";
    rows.push(`{"t": ${t}, "dir": "tx", "data": "22F18C\\r"}`, `{"t": ${t}, "dir": "rx", "data": "18DAF1170762F18C31323334\\r\\r>"}`, provenance);
    const altered = `${rows.join("\n")}\n`;
    await w.bucket.put(part0, altered);
    await w.bucket.put(manifestKey, JSON.stringify({ ...manifest, parts: [{ bytes: altered.length, lines: rows.length }] }));
    const root = tempRepo();
    const log: string[] = [];
    const result = await runIntake(deps(w, root, log));
    expect(result.added).toEqual([]);
    expect(result.refused).toHaveLength(1);
    expect(log.join("\n")).toMatch(/re-scrub/);
    expect(recordingFiles(root)).toEqual([]);
    expect(w.bucket.text(part0)).toBe(altered);
  });

  it("I1 (repair 1): a part whose body the scrubber refuses (a tx line with an extra key) is refused, not written", async () => {
    const w = world();
    const { manifestKey, part0, manifest } = await uploaded(w);
    const rows = (w.bucket.text(part0) ?? "").split("\n").slice(0, -1);
    const provenance = rows.pop() ?? "";
    const t = /^\{"t": ([^,]+),/.exec(provenance)?.[1] ?? "";
    rows.push(`{"t": ${t}, "dir": "tx", "data": "0902\\r", "vin": "x"}`, provenance);
    const altered = `${rows.join("\n")}\n`;
    await w.bucket.put(part0, altered);
    await w.bucket.put(manifestKey, JSON.stringify({ ...manifest, parts: [{ bytes: altered.length, lines: rows.length }] }));
    const root = tempRepo();
    const result = await runIntake(deps(w, root, []));
    expect(result.added).toEqual([]);
    expect(result.refused).toHaveLength(1);
    expect(recordingFiles(root)).toEqual([]);
  });

  it("I2: an existing local path is not overwritten (wx)", async () => {
    const w = world();
    const { manifest } = await uploaded(w);
    const root = tempRepo();
    const p = manifest.provenance;
    const path = `fixtures/recordings/${p.catalogId}-beta-${p.vehicleKey.slice(0, 8)}/${p.month}-${p.kind}-${p.fileId.slice(0, 8)}.jsonl`;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), "keep");
    const result = await runIntake(deps(w, root, []));
    expect(result.added).toEqual([]);
    expect(result.refused).toHaveLength(1);
    expect(readFileSync(join(root, path), "utf8")).toBe("keep");
    expect(recordingFiles(root)).toEqual([path]);
    // Repair 1: the refused file's index entry is dropped, so a later run never deletes a file intake did not write.
    expect((await runIntake(deps(w, root, []))).refused).toHaveLength(1);
    expect(readFileSync(join(root, path), "utf8")).toBe("keep");
  });

  describe("I3: a manifest or provenance line that fails zod, or disagrees with the other, is not written", () => {
    const cases: [string, (m: BetaManifest, part: string) => { manifest: unknown; part: string }][] = [
      ["manifest fails zod (extra top-level key)", (m, part) => ({ manifest: { ...m, note: "x" }, part })],
      // Both copies name the other file, so only the key check can catch it.
      ["manifest and provenance line name another fileId than the key", (m, part) => ({
        manifest: { ...m, provenance: { ...m.provenance, fileId: OTHER } }, part: part.replace(m.provenance.fileId, OTHER),
      })],
      ["manifest disagrees with the provenance line", (m, part) => ({ manifest: { ...m, provenance: { ...m.provenance, month: "2026-09" } }, part })],
      ["provenance line fails zod", (m, part) => ({ manifest: m, part: part.replace('"synthetic": false', '"synthetic": 12345') })],
    ];
    it.each(cases)("%s", async (_, alter) => {
      const w = world();
      const { manifestKey, part0, manifest } = await uploaded(w);
      const changed = alter(manifest, w.bucket.text(part0) ?? "");
      expect(changed.part.length).toBe(manifest.parts[0].bytes);
      await w.bucket.put(part0, changed.part);
      await w.bucket.put(manifestKey, JSON.stringify(changed.manifest));
      const root = tempRepo();
      const result = await runIntake(deps(w, root, []));
      expect(result.added).toEqual([]);
      expect(result.refused).toHaveLength(1);
      expect(recordingFiles(root)).toEqual([]);
    });

    // Repair 2: valid JSON that is not {t: number} is refused, not thrown out of runIntake.
    const lastLines: [string, (rows: string[]) => string[]][] = [
      ["last line is the number 5", (rows) => [...rows, "5"]],
      ['last line is {"t":"x"}', (rows) => [...rows.slice(0, -1), '{"t":"x"}']],
    ];
    it.each(lastLines)("%s", async (_, alter) => {
      const w = world();
      const { manifestKey, part0, manifest } = await uploaded(w);
      const rows = alter((w.bucket.text(part0) ?? "").split("\n").slice(0, -1));
      const altered = `${rows.join("\n")}\n`;
      await w.bucket.put(part0, altered);
      await w.bucket.put(manifestKey, JSON.stringify({ ...manifest, parts: [{ bytes: altered.length, lines: rows.length }] }));
      const root = tempRepo();
      const result = await runIntake(deps(w, root, []));
      expect(result.added).toEqual([]);
      expect(result.refused).toHaveLength(1);
      expect(recordingFiles(root)).toEqual([]);
    });
  });

  describe("I4:a missing part, or a size or line-count mismatch, is not written", () => {
    const cases: [string, (w: ReturnType<typeof world>, keys: Awaited<ReturnType<typeof uploaded>>) => Promise<unknown>][] = [
      ["missing part", (w, { part0 }) => w.bucket.delete(part0)],
      ["size mismatch", (w, { manifestKey, manifest }) => w.bucket.put(manifestKey, JSON.stringify({ ...manifest, parts: [{ ...manifest.parts[0], bytes: manifest.parts[0].bytes + 1 }] }))],
      ["line-count mismatch", (w, { manifestKey, manifest }) => w.bucket.put(manifestKey, JSON.stringify({ ...manifest, parts: [{ ...manifest.parts[0], lines: manifest.parts[0].lines + 1 }] }))],
    ];
    it.each(cases)("%s", async (_, alter) => {
      const w = world();
      await alter(w, await uploaded(w));
      const root = tempRepo();
      const result = await runIntake(deps(w, root, []));
      expect(result.added).toEqual([]);
      expect(result.refused).toHaveLength(1);
      expect(recordingFiles(root)).toEqual([]);
    });
  });

  it("I5: a tombstoned tester's local files are deleted; another tester's stay", async () => {
    const w = world();
    const a = await uploaded(w, 0);
    const b = await uploaded(w, 0x100);
    const root = tempRepo();
    const first = await runIntake(deps(w, root, []));
    expect(first.added).toHaveLength(2);
    expect(await a.outbox.deleteMyData()).toBe("Your beta data was deleted.");
    const second = await runIntake(deps(w, root, []));
    const aPaths = first.added.filter((path) => path.includes(a.manifest.provenance.fileId.slice(0, 8)));
    expect(aPaths).toHaveLength(1);
    expect(second.deleted.sort()).toEqual([aPaths[0], aPaths[0].replace(/\.jsonl$/, ".redacted.jsonl")].sort());
    expect(index(root).files.map((entry) => entry.fileId)).toEqual([b.manifest.provenance.fileId]);
    expect(recordingFiles(root)).toHaveLength(2);
    expect(recordingFiles(root).every((path) => path.includes(b.manifest.provenance.fileId.slice(0, 8)))).toBe(true);
  });

  it("I6: files 24 or more months old at now are deleted (and never re-added); newer ones stay", async () => {
    const w = world();
    const month = { value: "2024-10" };
    const old = await uploaded(w, 0, month);
    month.value = "2024-11";
    const newer = await uploaded(w, 0x100, month);
    const root = tempRepo();
    const at = (iso: string) => deps(w, root, [], { now: new Date(iso) });
    expect((await runIntake(at("2026-09-30T23:59:59Z"))).added).toHaveLength(2);
    const second = await runIntake(at("2026-10-01T00:00:00Z"));
    expect(second.expired.every((path) => path.includes(old.manifest.provenance.fileId.slice(0, 8)))).toBe(true);
    expect(second.expired).toHaveLength(2);
    expect(second.added).toEqual([]);
    expect(index(root).files.map((entry) => entry.fileId)).toEqual([newer.manifest.provenance.fileId]);
    const third = await runIntake(at("2026-11-01T00:00:00Z"));
    expect(third.expired).toHaveLength(2);
    expect(third.added).toEqual([]);
    expect(recordingFiles(root)).toEqual([]);
  });

  it("I7: a second run downloads nothing already in the index", async () => {
    const w = world();
    await uploaded(w);
    const root = tempRepo();
    expect((await runIntake(deps(w, root, []))).added).toHaveLength(1);
    w.fetched.length = 0;
    const second = await runIntake(deps(w, root, []));
    expect(second).toEqual({ added: [], refused: [], deleted: [], expired: [] });
    expect(w.fetched.filter((path) => path.startsWith("/admin/objects/"))).toEqual([]);
  });

  it("I8 (ruling 3): a redact failure removes the written original, leaves it unindexed, and the next run retries", async () => {
    const w = world();
    await uploaded(w);
    const root = tempRepo();
    const result = await runIntake(deps(w, root, [], { redact: () => Promise.reject(new Error("exit 1")) }));
    expect(result.added).toEqual([]);
    expect(result.refused).toHaveLength(1);
    expect(recordingFiles(root)).toEqual([]);
    expect(existsSync(join(root, "fixtures/beta-intake-index.json")) ? index(root).files : []).toEqual([]);
    expect((await runIntake(deps(w, root, []))).added).toHaveLength(1);
  });

  /** A run killed while redact_vin.py writes: a partial .redacted.jsonl is left and the run never returns. */
  async function interrupted(w: ReturnType<typeof world>, root: string): Promise<void> {
    let reached = () => {};
    const inRedact = new Promise<void>((resolve) => { reached = resolve; });
    const killed = (path: string) => {
      writeFileSync(path.replace(/\.jsonl$/, ".redacted.jsonl"), '{"t": 0');
      reached();
      return new Promise<void>(() => undefined);
    };
    void runIntake(deps(w, root, [], { redact: killed }));
    await inRedact;
    expect(recordingFiles(root)).toHaveLength(2);
  }

  it("I9 (repair 1): a run killed during redact, then Delete my data: the next run deletes both files", async () => {
    const w = world();
    const { outbox } = await uploaded(w);
    const root = tempRepo();
    await interrupted(w, root);
    const left = recordingFiles(root);
    expect(await outbox.deleteMyData()).toBe("Your beta data was deleted.");
    const result = await runIntake(deps(w, root, []));
    expect(result.deleted.sort()).toEqual(left);
    expect(recordingFiles(root)).toEqual([]);
    expect(index(root).files).toEqual([]);
  });

  it("I9 (repair 1): the run after an interrupted one removes the leftovers and pulls the file again", async () => {
    const w = world();
    await uploaded(w);
    const root = tempRepo();
    await interrupted(w, root);
    const result = await runIntake(deps(w, root, []));
    expect(result.refused).toEqual([]);
    expect(result.added).toHaveLength(1);
    const path = result.added[0];
    expect(readFileSync(join(root, path.replace(/\.jsonl$/, ".redacted.jsonl")), "latin1")).toBe(readFileSync(join(root, path), "latin1"));
    expect(index(root).files).toEqual([expect.objectContaining({ paths: [path, path.replace(/\.jsonl$/, ".redacted.jsonl")] })]);
    expect(index(root).files[0]).not.toHaveProperty("pending");
  });

  it("I8 (repair 2): redact writes a partial .redacted.jsonl, then fails; retry, Delete my data, run: nothing is left", async () => {
    const w = world();
    const { outbox } = await uploaded(w);
    const root = tempRepo();
    const dies = (path: string) => {
      writeFileSync(path.replace(/\.jsonl$/, ".redacted.jsonl"), '{"t": 0', { flag: "wx" });
      return Promise.reject(new Error("redact_vin.py exited 1"));
    };
    const first = await runIntake(deps(w, root, [], { redact: dies }));
    expect(first.refused).toHaveLength(1);
    expect(recordingFiles(root)).toEqual([]);
    const second = await runIntake(deps(w, root, []));
    expect([second.added.length, second.refused.length]).toEqual([1, 0]);
    expect(await outbox.deleteMyData()).toBe("Your beta data was deleted.");
    expect((await runIntake(deps(w, root, []))).deleted).toHaveLength(2);
    expect(recordingFiles(root)).toEqual([]);
    expect(index(root).files).toEqual([]);
  });

  // Repair 2: a local file intake did not write survives a kill at any fs mutation of a run, and the run after it.
  // A second upload keeps the run busy, so there are save points on both sides of the occupied file.
  describe("I2 (repair 2): crash snapshots never remove a pre-existing original or .redacted.jsonl", () => {
    const occupied: [string, (path: string) => string][] = [
      ["original", (path) => path],
      [".redacted.jsonl", (path) => path.replace(/\.jsonl$/, ".redacted.jsonl")],
    ];
    it.each(occupied)("%s", async (_, pick) => {
      const w = world();
      const { manifest } = await uploaded(w, 0);
      await uploaded(w, 0x100);
      const p = manifest.provenance;
      const mine = pick(`fixtures/recordings/${p.catalogId}-beta-${p.vehicleKey.slice(0, 8)}/${p.month}-${p.kind}-${p.fileId.slice(0, 8)}.jsonl`);
      const root = tempRepo();
      mkdirSync(dirname(join(root, mine)), { recursive: true });
      writeFileSync(join(root, mine), "NOT INTAKE'S");
      const snapshots: string[] = [];
      hook.after = () => {
        const copy = mkdtempSync(join(tmpdir(), "t2.9-c2-snap-"));
        roots.push(copy);
        cpSync(join(root, "fixtures"), join(copy, "fixtures"), { recursive: true });
        snapshots.push(copy);
      };
      // A redact that writes its output in two steps, so a snapshot can land on a partial file.
      const twoStep = (path: string) => {
        const out = path.replace(/\.jsonl$/, ".redacted.jsonl");
        writeFileSync(out, readFileSync(path, "latin1").slice(0, 50), { flag: "wx" });
        writeFileSync(out, readFileSync(path));
        return Promise.resolve();
      };
      hook.on = true;
      await runIntake(deps(w, root, [], { redact: twoStep }));
      hook.on = false;
      expect(snapshots.length).toBeGreaterThan(2);
      for (const snapshot of [...snapshots, root]) {
        await runIntake(deps(w, snapshot, []));
        expect(existsSync(join(snapshot, mine)) ? readFileSync(join(snapshot, mine), "utf8") : "removed", snapshot).toBe("NOT INTAKE'S");
      }
    });
  });

  it("paging: manifests on later /admin/manifests pages are pulled too", async () => {
    const w = world();
    await uploaded(w, 0);
    await uploaded(w, 0x100);
    w.bucket.limit = 1;
    const root = tempRepo();
    expect((await runIntake(deps(w, root, []))).added).toHaveLength(2);
    expect(w.fetched.filter((path) => path === "/admin/manifests").length).toBeGreaterThan(1);
  });

  it("log: no line holds a full installId (added, refused, deleted)", async () => {
    const w = world();
    const a = await uploaded(w, 0);
    const b = await uploaded(w, 0x100);
    await w.bucket.put(b.manifestKey, JSON.stringify({ ...b.manifest, parts: [{ ...b.manifest.parts[0], bytes: b.manifest.parts[0].bytes + 1 }] }));
    const root = tempRepo();
    const log: string[] = [];
    const first = await runIntake(deps(w, root, log));
    expect([first.added.length, first.refused.length]).toEqual([1, 1]);
    expect(await a.outbox.deleteMyData()).toBe("Your beta data was deleted.");
    expect((await runIntake(deps(w, root, log))).deleted).toHaveLength(2);
    const installIds = [a.manifestKey, b.manifestKey].map((key) => key.split("/")[1]);
    for (const id of installIds) expect(log.filter((line) => line.includes(id))).toEqual([]);
  });
});
