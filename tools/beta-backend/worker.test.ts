// T2.9 Stage C1: docs/specs/T2.9-beta-data-upload.md Verification "Stage C1", W1–W11 (failure modes listed in
// docs/task-runs/T2.9.md before any code), plus the orchestrator's C1-b route DELETE /v1/files/<fileId>. In process:
// handleRequest over an in-memory bucket with a fixed clock.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryBucket } from "../../apps/mobile/test/fakeBeta.js";
import { SCRUB_RULES, SCRUB_VERSION } from "../../packages/obd-core/src/recording/scrub.js";
import { PART_MAX_BYTES, type BetaManifest } from "../../packages/obd-core/src/recording/provenance.js";
import { GLOBAL_MAX_BYTES, handleRequest, INSTALL_DAILY_BYTES, REGISTRATIONS_PER_DAY } from "./handler.js";

const NOW = new Date("2026-10-03T12:00:00Z");
const NEXT_DAY = new Date("2026-10-04T00:00:01Z");
const IP = "203.0.113.7";
const ADMIN = "test-admin-token-not-a-real-secret";
const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const A = id(1);
const B = id(2);
const SECRET_A = `${id(101)}${id(102)}`;
const SECRET_B = `${id(103)}${id(104)}`;
const F1 = id(11);
const F2 = id(12);
const bearer = (installId: string, secret: string) => `Bearer ${installId}:${secret}`;

function server(clock = { now: NOW }, adminToken = ADMIN) {
  const bucket = new MemoryBucket(() => clock.now);
  const env = { BETA_BUCKET: bucket, ADMIN_TOKEN: adminToken };
  const bodies: string[] = [];
  async function send(method: string, path: string, options: { auth?: string; body?: string; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { "CF-Connecting-IP": IP, ...options.headers };
    if (options.auth !== undefined) headers.Authorization = options.auth;
    const request = new Request(`https://beta.test${path}`, { method, headers, ...(options.body === undefined ? {} : { body: options.body }) });
    const response = await handleRequest(request, env, clock.now);
    const text = await response.text();
    bodies.push(text);
    return { status: response.status, text };
  }
  const register = (installId: string, secret: string, consentVersion = "beta-1") =>
    send("POST", "/v1/installs", { body: JSON.stringify({ installId, secret, consentVersion }) });
  const part = (auth: string | undefined, fileId: string, n: number | string, body: string, length: string | null = String(body.length)) =>
    send("PUT", `/v1/files/${fileId}/parts/${String(n)}`, { ...(auth === undefined ? {} : { auth }), body, headers: length === null ? {} : { "Content-Length": length } });
  const manifest = (auth: string | undefined, fileId: string, value: unknown) =>
    send("PUT", `/v1/files/${fileId}/manifest`, { ...(auth === undefined ? {} : { auth }), body: typeof value === "string" ? value : JSON.stringify(value) });
  return { bucket, clock, bodies, send, register, part, manifest };
}

function manifestFor(fileId: string, parts: BetaManifest["parts"]): BetaManifest {
  return {
    provenance: {
      schema: 1, fileId, kind: "capture", consentVersion: "beta-1", appVersion: "1.0.0", scrubVersion: SCRUB_VERSION,
      month: "2026-10", catalogId: "chevrolet-equinox-ev-2024", ownership: "mine", testerKey: id(21), vehicleKey: id(22),
      synthetic: false, scrub: Object.fromEntries(SCRUB_RULES.map((rule) => [rule, 0])) as BetaManifest["provenance"]["scrub"],
    },
    parts,
  };
}

const LINE = '{"t": 0, "dir": "tx", "data": "0100\\r"}\n';

describe("Worker failure modes", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("W1: a missing, malformed or wrong tester credential gets 401 on every tester route and writes nothing", async () => {
    const s = server();
    expect((await s.register(A, SECRET_A)).status).toBe(201);
    const before = s.bucket.keys();
    // C1b: an installId with no record (B here) is not in this list; its deletes answer 204 (W12).
    const wrong = [undefined, "", "Bearer", `Bearer ${A}`, `Bearer ${A}:`, bearer(A, SECRET_B), `Basic ${A}:${SECRET_A}`, `Bearer ${ADMIN}`];
    for (const auth of wrong) {
      const headers = auth === undefined ? {} : { auth };
      expect((await s.part(auth, F1, 0, LINE)).status).toBe(401);
      expect((await s.manifest(auth, F1, manifestFor(F1, [{ bytes: LINE.length, lines: 1 }]))).status).toBe(401);
      expect((await s.send("DELETE", `/v1/files/${F1}`, headers)).status).toBe(401);
      expect((await s.send("DELETE", "/v1/installs/me", headers)).status).toBe(401);
    }
    expect(s.bucket.keys()).toEqual(before);
    expect((await s.part(bearer(A, SECRET_A), F1, 0, LINE)).status).toBe(204);
  });

  it("W2: a second registration of the same installId gets 409 and keeps the first secret", async () => {
    const s = server();
    expect((await s.register(A, SECRET_A)).status).toBe(201);
    const record = s.bucket.text(`installs/${A}.json`);
    expect(JSON.parse(record ?? "{}")).toEqual({ secretSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown, consentVersion: "beta-1", month: "2026-10" });
    expect((await s.register(A, SECRET_B)).status).toBe(409);
    expect(s.bucket.text(`installs/${A}.json`)).toBe(record);
    expect((await s.part(bearer(A, SECRET_B), F1, 0, LINE)).status).toBe(401);
    expect((await s.part(bearer(A, SECRET_A), F1, 0, LINE)).status).toBe(204);
  });

  it("W2 (ruling a, D1): registering a tombstoned installId gets 410 and leaves the tombstone unchanged", async () => {
    const s = server();
    await s.register(A, SECRET_A);
    await s.send("DELETE", "/v1/installs/me", { auth: bearer(A, SECRET_A) });
    const tombstone = s.bucket.objects.get(`tombstones/${A}.json`);
    s.clock.now = NEXT_DAY;
    expect((await s.register(A, SECRET_B)).status).toBe(410);
    expect((await s.register(A, SECRET_A)).status).toBe(410);
    expect(s.bucket.keys().filter((key) => key.includes(A))).toEqual([`tombstones/${A}.json`]);
    expect(s.bucket.objects.get(`tombstones/${A}.json`)).toBe(tombstone);
    expect((await s.part(bearer(A, SECRET_B), F1, 0, LINE)).status).toBe(401);
  });

  it("W3: a part needs Content-Length (411), at most PART_MAX_BYTES (413), and a body of that length (400)", async () => {
    const s = server();
    await s.register(A, SECRET_A);
    const auth = bearer(A, SECRET_A);
    expect((await s.part(auth, F1, 0, LINE, null)).status).toBe(411);
    expect((await s.part(auth, F1, 0, LINE, String(PART_MAX_BYTES + 1))).status).toBe(413);
    expect((await s.part(auth, F1, 0, LINE, "12x")).status).toBe(400);
    expect((await s.part(auth, F1, 0, LINE, String(LINE.length - 1))).status).toBe(400);
    expect(s.bucket.keys("files/")).toEqual([]);
    expect((await s.part(auth, F1, 0, LINE)).status).toBe(204);
    expect(s.bucket.text(`files/${A}/${F1}/part-000.jsonl`)).toBe(LINE);
  });

  it("W4: the per-install daily byte quota gives 429 and resets the next UTC day", async () => {
    const s = server();
    await s.register(A, SECRET_A);
    await s.register(B, SECRET_B);
    const auth = bearer(A, SECRET_A);
    s.bucket.seed(`files/${A}/${F2}/part-000.jsonl`, INSTALL_DAILY_BYTES - 10, NOW);
    s.bucket.seed(`files/${A}/${F2}/part-001.jsonl`, 5_000, new Date("2026-10-02T23:59:59Z"));
    s.bucket.seed(`files/${B}/${F2}/part-000.jsonl`, 5_000, NOW);
    expect((await s.part(auth, F1, 0, "x".repeat(11))).status).toBe(429);
    expect(s.bucket.keys(`files/${A}/${F1}/`)).toEqual([]);
    expect((await s.part(auth, F1, 0, "x".repeat(10))).status).toBe(204);
    // Re-sending the same part replaces it, so its old size does not count twice.
    expect((await s.part(auth, F1, 0, "y".repeat(10))).status).toBe(204);
    expect((await s.part(auth, F1, 1, "x")).status).toBe(429);
    s.clock.now = NEXT_DAY;
    expect((await s.part(auth, F1, 1, "x")).status).toBe(204);
  });

  it("W5: the global byte cap gives 507 and writes nothing", async () => {
    const s = server();
    await s.register(A, SECRET_A);
    s.bucket.seed(`files/${B}/${F2}/part-000.jsonl`, GLOBAL_MAX_BYTES - 10, new Date("2026-01-01T00:00:00Z"));
    const auth = bearer(A, SECRET_A);
    expect((await s.part(auth, F1, 0, "x".repeat(11))).status).toBe(507);
    expect(s.bucket.keys(`files/${A}/`)).toEqual([]);
    expect((await s.part(auth, F1, 0, "x".repeat(10))).status).toBe(204);
  });

  it("W6: a manifest failing zod or naming another fileId gets 400; one listing a missing or wrong-size part gets 409", async () => {
    const s = server();
    await s.register(A, SECRET_A);
    const auth = bearer(A, SECRET_A);
    await s.part(auth, F1, 0, LINE);
    await s.part(auth, F1, 1, LINE + LINE);
    const good = manifestFor(F1, [{ bytes: LINE.length, lines: 1 }, { bytes: 2 * LINE.length, lines: 2 }]);
    expect((await s.manifest(auth, F1, "{not json")).status).toBe(400);
    expect((await s.manifest(auth, F1, { ...good, vin: "x" })).status).toBe(400);
    expect((await s.manifest(auth, F1, { ...good, provenance: { ...good.provenance, month: "2026-10-03" } })).status).toBe(400);
    expect((await s.manifest(auth, F1, { ...good, provenance: { ...good.provenance, fileId: F2 } })).status).toBe(400);
    expect((await s.manifest(auth, F1, { ...good, parts: [...good.parts, { bytes: 1, lines: 1 }] })).status).toBe(409);
    expect((await s.manifest(auth, F1, { ...good, parts: [good.parts[0], { bytes: 2 * LINE.length + 1, lines: 2 }] })).status).toBe(409);
    expect(s.bucket.keys(`files/${A}/${F1}/manifest`)).toEqual([]);
    expect((await s.manifest(auth, F1, good)).status).toBe(204);
    expect(JSON.parse(s.bucket.text(`files/${A}/${F1}/manifest.json`) ?? "")).toEqual(good);
  });

  it("W7: DELETE /v1/installs/me removes every file and the install record and writes a tombstone; old secret 401, repeat 204", async () => {
    const s = server();
    s.bucket.limit = 2;
    await s.register(A, SECRET_A);
    await s.register(B, SECRET_B);
    const auth = bearer(A, SECRET_A);
    for (let n = 0; n < 3; n++) await s.part(auth, F1, n, LINE);
    await s.manifest(auth, F1, manifestFor(F1, [0, 1, 2].map(() => ({ bytes: LINE.length, lines: 1 }))));
    await s.part(auth, F2, 0, LINE);
    await s.part(bearer(B, SECRET_B), F1, 0, LINE);
    const others = s.bucket.keys().filter((key) => !key.includes(A));
    expect((await s.send("DELETE", "/v1/installs/me", { auth })).status).toBe(204);
    expect(s.bucket.keys().filter((key) => key.includes(A))).toEqual([`tombstones/${A}.json`]);
    expect(JSON.parse(s.bucket.text(`tombstones/${A}.json`) ?? "")).toEqual({ month: "2026-10" });
    expect(s.bucket.keys().filter((key) => !key.includes(A))).toEqual(others);
    expect((await s.part(auth, F1, 0, LINE)).status).toBe(401);
    expect((await s.send("DELETE", "/v1/installs/me", { auth })).status).toBe(204);
    expect((await s.send("DELETE", "/v1/installs/me", { auth: bearer(A, SECRET_B) })).status).toBe(204);
    expect(s.bucket.keys().filter((key) => key.includes(A))).toEqual([`tombstones/${A}.json`]);
  });

  it("W7 (C1-b): DELETE /v1/files/<fileId> removes only that file of that install, and answers 204 when nothing is there", async () => {
    const s = server();
    s.bucket.limit = 2;
    await s.register(A, SECRET_A);
    await s.register(B, SECRET_B);
    for (let n = 0; n < 3; n++) await s.part(bearer(A, SECRET_A), F1, n, LINE);
    await s.part(bearer(A, SECRET_A), F2, 0, LINE);
    await s.part(bearer(B, SECRET_B), F1, 0, LINE);
    expect((await s.send("DELETE", `/v1/files/${F1}`, { auth: bearer(A, SECRET_A) })).status).toBe(204);
    expect(s.bucket.keys("files/")).toEqual([`files/${A}/${F2}/part-000.jsonl`, `files/${B}/${F1}/part-000.jsonl`]);
    expect((await s.send("DELETE", `/v1/files/${F1}`, { auth: bearer(A, SECRET_A) })).status).toBe(204);
    expect(s.bucket.keys(`installs/${A}`)).toHaveLength(1);
  });

  it("W12 (C1b): the deletes of an installId with no record, unknown or tombstoned, answer 204 and write nothing; a live record with another secret still gets 401", async () => {
    const s = server();
    await s.register(A, SECRET_A);
    await s.part(bearer(A, SECRET_A), F1, 0, LINE);
    await s.register(B, SECRET_B);
    await s.send("DELETE", "/v1/installs/me", { auth: bearer(B, SECRET_B) });
    // Objects under an installId with no record cannot arise from the routes; seeded, they show nothing is removed.
    const C = id(3);
    s.bucket.seed(`files/${C}/${F1}/part-000.jsonl`, LINE.length, NOW);
    const before = [...s.bucket.objects.entries()];
    for (const auth of [bearer(C, SECRET_A), bearer(B, SECRET_B), bearer(B, SECRET_A)]) {
      expect((await s.send("DELETE", "/v1/installs/me", { auth })).status).toBe(204);
      expect((await s.send("DELETE", `/v1/files/${F1}`, { auth })).status).toBe(204);
      expect((await s.part(auth, F2, 0, LINE)).status).toBe(401);
      expect((await s.manifest(auth, F2, manifestFor(F2, [{ bytes: LINE.length, lines: 1 }]))).status).toBe(401);
    }
    expect((await s.send("DELETE", "/v1/installs/me", { auth: bearer(A, SECRET_B) })).status).toBe(401);
    expect((await s.send("DELETE", `/v1/files/${F1}`, { auth: bearer(A, SECRET_B) })).status).toBe(401);
    expect([...s.bucket.objects.entries()]).toEqual(before);
    expect(s.bucket.keys(`tombstones/${C}`)).toEqual([]);
  });

  it("W8: admin routes need the admin token; no token, a wrong one, a tester credential or an unset token get 401", async () => {
    const s = server();
    await s.register(A, SECRET_A);
    const auth = bearer(A, SECRET_A);
    await s.part(auth, F1, 0, LINE);
    await s.manifest(auth, F1, manifestFor(F1, [{ bytes: LINE.length, lines: 1 }]));
    await s.register(B, SECRET_B);
    await s.send("DELETE", "/v1/installs/me", { auth: bearer(B, SECRET_B) });
    const routes = ["/admin/manifests", `/admin/objects/files/${A}/${F1}/part-000.jsonl`, "/admin/tombstones"];
    for (const path of routes) {
      for (const bad of [undefined, `Bearer ${ADMIN}x`, `Bearer ${ADMIN.slice(0, -1)}`, ADMIN, auth]) {
        expect((await s.send("GET", path, bad === undefined ? {} : { auth: bad })).status).toBe(401);
      }
    }
    const unset = server({ now: NOW }, "");
    expect((await unset.send("GET", "/admin/tombstones", { auth: "Bearer " })).status).toBe(401);
    const admin = `Bearer ${ADMIN}`;
    const manifests = await s.send("GET", "/admin/manifests", { auth: admin });
    expect(manifests.status).toBe(200);
    expect(JSON.parse(manifests.text)).toEqual({ keys: [`files/${A}/${F1}/manifest.json`] });
    const object = await s.send("GET", routes[1], { auth: admin });
    expect(object).toEqual({ status: 200, text: LINE });
    expect((await s.send("GET", `/admin/objects/files/${A}/${F2}/part-000.jsonl`, { auth: admin })).status).toBe(404);
    expect(JSON.parse((await s.send("GET", "/admin/tombstones", { auth: admin })).text)).toEqual({ installIds: [B] });
  });

  it("W8: /admin/manifests pages with after= and next", async () => {
    const s = server();
    s.bucket.limit = 2;
    await s.register(A, SECRET_A);
    const auth = bearer(A, SECRET_A);
    for (const fileId of [F1, F2]) {
      await s.part(auth, fileId, 0, LINE);
      await s.manifest(auth, fileId, manifestFor(fileId, [{ bytes: LINE.length, lines: 1 }]));
    }
    const keys: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const { text } = await s.send("GET", `/admin/manifests${after === undefined ? "" : `?after=${encodeURIComponent(after)}`}`, { auth: `Bearer ${ADMIN}` });
      const body = JSON.parse(text) as { keys: string[]; next?: string };
      keys.push(...body.keys);
      if (body.next === undefined) break;
      after = body.next;
    }
    expect(keys).toEqual([`files/${A}/${F1}/manifest.json`, `files/${A}/${F2}/manifest.json`]);
  });

  it("W9: a non-UUID-v4 id or a part index outside 0-63 gets 400", async () => {
    const s = server();
    await s.register(A, SECRET_A);
    const auth = bearer(A, SECRET_A);
    for (const fileId of ["..%2F..%2Finstalls", "..%2F", F1.toUpperCase(), "00000001-0000-1000-8000-000000000000", `${F1}x`, "x"]) {
      expect((await s.part(auth, fileId, 0, LINE)).status).toBe(400);
      expect((await s.manifest(auth, fileId, manifestFor(F1, [{ bytes: LINE.length, lines: 1 }]))).status).toBe(400);
      expect((await s.send("DELETE", `/v1/files/${fileId}`, { auth })).status).toBe(400);
    }
    for (const n of ["64", "-1", "07", "1e1", "..%2F0"]) expect((await s.part(auth, F1, n, LINE)).status).toBe(400);
    expect((await s.part(auth, F1, 63, LINE)).status).toBe(204);
    for (const body of [
      { installId: "..%2F", secret: SECRET_A, consentVersion: "beta-1" },
      { installId: B, secret: "short", consentVersion: "beta-1" },
      { installId: B, secret: SECRET_B, consentVersion: "beta-0" },
      { installId: B, secret: SECRET_B, consentVersion: "beta-1", vin: "x" },
    ]) expect((await s.send("POST", "/v1/installs", { body: JSON.stringify(body) })).status).toBe(400);
    expect((await s.send("POST", "/v1/installs", { body: "{" })).status).toBe(400);
    expect(s.bucket.keys()).toEqual([`files/${A}/${F1}/part-063.jsonl`, `installs/${A}.json`]);
  });

  it("W10: more than REGISTRATIONS_PER_DAY registrations in one UTC day get 429; the next day is open again", async () => {
    const s = server();
    for (let n = 0; n < REGISTRATIONS_PER_DAY; n++) expect((await s.register(id(1000 + n), SECRET_A)).status).toBe(201);
    expect((await s.register(id(2000), SECRET_A)).status).toBe(429);
    expect(s.bucket.keys(`installs/${id(2000)}`)).toEqual([]);
    s.clock.now = NEXT_DAY;
    expect((await s.register(id(2000), SECRET_A)).status).toBe(201);
  });

  it("W10 (R4): installs deleted the same day still count toward REGISTRATIONS_PER_DAY, by their tombstone's upload day", async () => {
    const s = server();
    for (let n = 0; n < REGISTRATIONS_PER_DAY; n++) {
      expect((await s.register(id(1000 + n), SECRET_A)).status).toBe(201);
      if (n % 2 === 0) expect((await s.send("DELETE", "/v1/installs/me", { auth: bearer(id(1000 + n), SECRET_A) })).status).toBe(204);
    }
    expect(s.bucket.keys("installs/")).toHaveLength(REGISTRATIONS_PER_DAY / 2);
    expect((await s.register(id(2000), SECRET_A)).status).toBe(429);
    expect(s.bucket.keys(`installs/${id(2000)}`)).toEqual([]);
    s.clock.now = NEXT_DAY;
    expect((await s.register(id(2000), SECRET_A)).status).toBe(201);
  });

  it("W11: no response body and no console call holds a secret, the admin token or the client IP", async () => {
    const logged: unknown[] = [];
    for (const method of ["log", "info", "warn", "error", "debug", "trace"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(...args); });
    }
    const s = server();
    await s.register(A, SECRET_A);
    await s.register(A, SECRET_A);
    const auth = bearer(A, SECRET_A);
    await s.part(auth, F1, 0, LINE);
    await s.part(bearer(A, SECRET_B), F1, 0, LINE);
    await s.part(auth, F1, 0, LINE, null);
    await s.manifest(auth, F1, { secret: SECRET_A });
    await s.manifest(auth, F1, manifestFor(F1, [{ bytes: LINE.length, lines: 1 }]));
    await s.send("GET", "/admin/manifests", { auth: `Bearer ${ADMIN}` });
    await s.send("GET", "/admin/tombstones", { auth });
    await s.send("DELETE", `/v1/files/${F1}`, { auth });
    await s.send("DELETE", "/v1/installs/me", { auth });
    await s.send("GET", "/nowhere");
    // An internal failure answers 500 without echoing the error.
    s.bucket.head = () => Promise.reject(new Error(`boom ${SECRET_A} ${IP}`));
    expect((await s.register(B, SECRET_B)).status).toBe(500);
    const seen = [...s.bodies, ...logged.map((value) => (value instanceof Error ? `${value.message} ${value.stack ?? ""}` : String(value)))].join("\n");
    for (const hidden of [SECRET_A, SECRET_B, ADMIN, IP]) expect(seen).not.toContain(hidden);
    expect(s.bodies.length).toBeGreaterThan(10);
  });
});
