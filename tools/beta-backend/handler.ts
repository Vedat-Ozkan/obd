// Beta upload Worker's request handler (ADR-019): docs/specs/T2.9-beta-data-upload.md §Stage C1 HTTP contract, plus the
// orchestrator's C1-b route DELETE /v1/files/<fileId>, D1's 410 and C1b's 204 deletes (docs/task-runs/T2.9.md). The R2
// binding is typed locally (no @cloudflare/workers-types). It logs nothing: no IP, secret, token or body ever reaches a log
// or a response.
// D5: worker.ts is the entry module and exports only the fetch handler, since workerd treats every named export of the
// main module as an entrypoint.
import { z } from "zod";
import { betaManifestSchema, CONSENT_VERSIONS, PART_MAX_BYTES } from "../../packages/obd-core/src/recording/provenance.js";

export interface BucketObject { key: string; size: number; uploaded: Date }
/** The R2Bucket subset used here. */
export interface BucketLike {
  put(key: string, value: string | ArrayBuffer): Promise<unknown>;
  get(key: string): Promise<(BucketObject & { body: ReadableStream }) | null>;
  head(key: string): Promise<BucketObject | null>;
  list(options: { prefix: string; startAfter?: string; cursor?: string }): Promise<{ objects: BucketObject[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<unknown>;
}
export interface Env { BETA_BUCKET: BucketLike; ADMIN_TOKEN: string }

export const REGISTRATIONS_PER_DAY = 20;
export const INSTALL_DAILY_BYTES = 500 * 1024 * 1024;
export const GLOBAL_MAX_BYTES = 60 * 1024 ** 3;   // ≈ $0.75/month ceiling at the recalled R2 price

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const isId = (value: string) => new RegExp(`^${UUID_V4}$`).test(value);
const PART_INDEX = /^(\d|[1-5]\d|6[0-3])$/;
// The phone's secret is two UUID v4s joined (spec §Provenance and keys).
const registerSchema = z.strictObject({
  installId: z.string().regex(new RegExp(`^${UUID_V4}$`)),
  secret: z.string().regex(new RegExp(`^(${UUID_V4}){2}$`)),
  consentVersion: z.enum(CONSENT_VERSIONS),
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** Fixed reasons only: nothing from the request is echoed. */
const fail = (status: number, reason: string) => json({ error: reason }, status);
const day = (date: Date) => date.toISOString().slice(0, 10);
const month = (date: Date) => date.toISOString().slice(0, 7);

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
/** Constant time over two equal-length digests. */
function sameDigest(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}
const fromHex = (text: string) => new Uint8Array((text.match(/../g) ?? []).map((pair) => parseInt(pair, 16)));

async function listAll(bucket: BucketLike, prefix: string): Promise<BucketObject[]> {
  const all: BucketObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, ...(cursor === undefined ? {} : { cursor }) });
    all.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return all;
}

async function deleteAll(bucket: BucketLike, prefix: string): Promise<void> {
  const keys = (await listAll(bucket, prefix)).map((object) => object.key);
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
}

function bearer(request: Request): string | undefined {
  const match = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
  return match?.[1];
}

interface Install { installId: string; known: boolean }

/** `Bearer <installId>:<secret>`. undefined = 401. `known: false` = no install record (the delete routes only). */
async function tester(request: Request, bucket: BucketLike): Promise<Install | undefined> {
  const match = new RegExp(`^(${UUID_V4}):(.+)$`).exec(bearer(request) ?? "");
  if (!match) return undefined;
  const [, installId, secret] = match;
  const record = await bucket.get(`installs/${installId}.json`);
  if (!record) return { installId, known: false };
  const stored = z.object({ secretSha256: z.string().regex(/^[0-9a-f]{64}$/) }).parse(JSON.parse(await new Response(record.body).text()));
  return sameDigest(await sha256(secret), fromHex(stored.secretSha256)) ? { installId, known: true } : undefined;
}

async function admin(request: Request, env: Env): Promise<boolean> {
  const token = bearer(request);
  if (!env.ADMIN_TOKEN || token === undefined) return false;
  return sameDigest(await sha256(token), await sha256(env.ADMIN_TOKEN));
}

async function register(request: Request, bucket: BucketLike, now: Date): Promise<Response> {
  let body: unknown;
  try { body = JSON.parse(await request.text()); } catch { return fail(400, "bad body"); }
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return fail(400, "bad body");
  const { installId, secret, consentVersion } = parsed.data;
  // A deleted install stays deleted: its tombstone tells intake to drop everything under that installId. 410 tells the
  // phone to wipe (D1); 409 means a live record, whose secret may differ.
  if (await bucket.head(`tombstones/${installId}.json`)) return fail(410, "install deleted");
  if (await bucket.head(`installs/${installId}.json`)) return fail(409, "install exists");
  // R4: an install deleted today still counts, by its tombstone's upload day, so deletes free no registration slot.
  const today = [...await listAll(bucket, "installs/"), ...await listAll(bucket, "tombstones/")].filter((object) => day(object.uploaded) === day(now));
  if (today.length >= REGISTRATIONS_PER_DAY) return fail(429, "too many registrations today");
  await bucket.put(`installs/${installId}.json`, JSON.stringify({ secretSha256: hex(await sha256(secret)), consentVersion, month: month(now) }));
  return new Response(null, { status: 201 });
}

async function putPart(request: Request, bucket: BucketLike, installId: string, fileId: string, index: number, now: Date): Promise<Response> {
  const declared = request.headers.get("Content-Length");
  if (declared === null) return fail(411, "Content-Length required");
  if (!/^\d+$/.test(declared)) return fail(400, "bad Content-Length");
  const length = Number(declared);
  if (length > PART_MAX_BYTES) return fail(413, "part too large");
  const key = `files/${installId}/${fileId}/part-${String(index).padStart(3, "0")}.jsonl`;
  // A re-sent part replaces the stored one, so the old copy does not count against the quotas.
  const others = (objects: BucketObject[]) => objects.filter((object) => object.key !== key);
  const mine = others(await listAll(bucket, `files/${installId}/`)).filter((object) => day(object.uploaded) === day(now));
  if (mine.reduce((sum, object) => sum + object.size, 0) + length > INSTALL_DAILY_BYTES) return fail(429, "daily upload quota reached");
  const all = others(await listAll(bucket, "files/"));
  if (all.reduce((sum, object) => sum + object.size, 0) + length > GLOBAL_MAX_BYTES) return fail(507, "storage full");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== length) return fail(400, "body length differs from Content-Length");
  await bucket.put(key, bytes);
  return new Response(null, { status: 204 });
}

async function putManifest(request: Request, bucket: BucketLike, installId: string, fileId: string): Promise<Response> {
  let body: unknown;
  try { body = JSON.parse(await request.text()); } catch { return fail(400, "bad manifest"); }
  const parsed = betaManifestSchema.safeParse(body);
  if (!parsed.success || parsed.data.provenance.fileId !== fileId) return fail(400, "bad manifest");
  for (const [index, part] of parsed.data.parts.entries()) {
    const stored = await bucket.head(`files/${installId}/${fileId}/part-${String(index).padStart(3, "0")}.jsonl`);
    if (stored?.size !== part.bytes) return fail(409, "a listed part is missing or its size differs");
  }
  await bucket.put(`files/${installId}/${fileId}/manifest.json`, JSON.stringify(parsed.data));
  return new Response(null, { status: 204 });
}

async function deleteInstall(bucket: BucketLike, install: Install, now: Date): Promise<Response> {
  // C1b: no record = deleted (tombstoned) or never registered, so nothing is held; 204 and nothing is written. A 401 then
  // only means a live record holds another secret.
  if (!install.known) return new Response(null, { status: 204 });
  // Files first and the install record last, so an interrupted delete can be repeated with the same credentials.
  await deleteAll(bucket, `files/${install.installId}/`);
  await bucket.put(`tombstones/${install.installId}.json`, JSON.stringify({ month: month(now) }));
  await bucket.delete(`installs/${install.installId}.json`);
  return new Response(null, { status: 204 });
}

async function adminRoute(url: URL, bucket: BucketLike): Promise<Response> {
  if (url.pathname === "/admin/manifests") {
    const after = url.searchParams.get("after");
    const page = await bucket.list({ prefix: "files/", ...(after === null ? {} : { startAfter: after }) });
    const keys = page.objects.map((object) => object.key).filter((key) => key.endsWith("/manifest.json"));
    const last = page.objects.at(-1);
    return json(page.truncated && last ? { keys, next: last.key } : { keys });
  }
  if (url.pathname === "/admin/tombstones") {
    const installIds = (await listAll(bucket, "tombstones/")).map((object) => object.key.slice("tombstones/".length, -".json".length));
    return json({ installIds });
  }
  if (url.pathname.startsWith("/admin/objects/")) {
    const object = await bucket.get(url.pathname.slice("/admin/objects/".length));
    return object ? new Response(object.body, { status: 200 }) : fail(404, "not found");
  }
  return fail(404, "not found");
}

async function route(request: Request, env: Env, now: Date): Promise<Response> {
  const url = new URL(request.url);
  const bucket = env.BETA_BUCKET;
  const method = request.method;
  if (url.pathname.startsWith("/admin/")) {
    if (method !== "GET") return fail(405, "method not allowed");
    return (await admin(request, env)) ? adminRoute(url, bucket) : fail(401, "unauthorized");
  }
  if (url.pathname === "/v1/installs" && method === "POST") return register(request, bucket, now);
  if (url.pathname === "/v1/installs/me" && method === "DELETE") {
    const install = await tester(request, bucket);
    return install ? deleteInstall(bucket, install, now) : fail(401, "unauthorized");
  }
  const part = /^\/v1\/files\/([^/]+)\/parts\/([^/]+)$/.exec(url.pathname);
  const manifest = /^\/v1\/files\/([^/]+)\/manifest$/.exec(url.pathname);
  const file = /^\/v1\/files\/([^/]+)$/.exec(url.pathname);
  const match = (method === "PUT" && (part ?? manifest)) || (method === "DELETE" && file);
  if (!match) return fail(404, "not found");
  if (!isId(match[1]) || (part && !PART_INDEX.test(part[2]))) return fail(400, "bad id");
  const install = await tester(request, bucket);
  if (!install) return fail(401, "unauthorized");
  // C1b: a file delete for an install with no record is done, as for DELETE /v1/installs/me; nothing is written.
  if (!install.known) return method === "DELETE" ? new Response(null, { status: 204 }) : fail(401, "unauthorized");
  if (part) return putPart(request, bucket, install.installId, match[1], Number(part[2]), now);
  if (manifest) return putManifest(request, bucket, install.installId, match[1]);
  await deleteAll(bucket, `files/${install.installId}/${match[1]}/`);
  return new Response(null, { status: 204 });
}

export async function handleRequest(request: Request, env: Env, now: Date): Promise<Response> {
  try {
    return await route(request, env, now);
  } catch {
    // Deliberately not logged: an error may carry request data.
    return fail(500, "internal error");
  }
}
