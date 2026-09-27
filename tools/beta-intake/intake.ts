// `pnpm beta:intake` (ADR-019): docs/specs/T2.9-beta-data-upload.md §Stage C2, §Flow, Decisions 2 (24-month retention)
// and 13 (the provenance line is removed before the idempotence check); orchestrator rulings (2)–(4) in
// docs/task-runs/T2.9.md. Pulls complete beta files from the Worker's admin routes, re-checks them, writes gitignored
// local originals, runs redact_vin.py on each, and applies tombstones and retention. The log never holds file content,
// secrets, or a full installId.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { latin1Decode } from "../../packages/obd-core/src/recording/format.js";
import { betaManifestSchema, provenanceLine, type BetaManifest } from "../../packages/obd-core/src/recording/provenance.js";
import { scrubRecording } from "../../packages/obd-core/src/recording/scrub.js";

export interface IntakeDeps {
  fetch: typeof fetch; baseUrl: string; adminToken: string;
  repoRoot: string; now: Date;
  redact(path: string): Promise<void>;   // CLI: spawns `uv run tools/spike/redact_vin.py <path>`; exit ≠ 0 throws
  log(line: string): void;               // one line per action; never prints file content, secrets, or installIds in full
}
export interface IntakeResult { added: string[]; refused: string[]; deleted: string[]; expired: string[] }

const INDEX = "fixtures/beta-intake-index.json";
const RETENTION_MONTHS = 24;
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MANIFEST_KEY = new RegExp(`^files/(${UUID_V4})/(${UUID_V4})/manifest\\.json$`);

const indexSchema = z.strictObject({
  version: z.literal(1),
  files: z.array(z.strictObject({ installId: z.string(), fileId: z.string(), month: z.string(), paths: z.array(z.string()),
    // Saved before the original is written and cleared after redact, so an interrupted run's files are known.
    pending: z.literal(true).optional() })),
});
type Index = z.infer<typeof indexSchema>;

class Refused extends Error {}

/** The CLI's redact: `uv run tools/spike/redact_vin.py <path>` from repoRoot. Its output is not logged. */
export function uvRedact(repoRoot: string): (path: string) => Promise<void> {
  return (path) => new Promise((done, fail) => {
    const child = spawn("uv", ["run", "tools/spike/redact_vin.py", path], { cwd: repoRoot, stdio: "ignore" });
    child.on("error", fail);
    child.on("close", (code) => { if (code === 0) done(); else fail(new Error(`redact_vin.py exited ${String(code)}`)); });
  });
}

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const expired = (month: string, now: Date) => now.getUTCFullYear() * 12 + now.getUTCMonth() - monthIndex(month) >= RETENTION_MONTHS;

export async function runIntake(deps: IntakeDeps): Promise<IntakeResult> {
  const result: IntakeResult = { added: [], refused: [], deleted: [], expired: [] };
  const at = (path: string) => join(deps.repoRoot, path);
  const index: Index = existsSync(at(INDEX)) ? indexSchema.parse(JSON.parse(readFileSync(at(INDEX), "utf8"))) : { version: 1, files: [] };
  const save = () => {
    mkdirSync(dirname(at(INDEX)), { recursive: true });
    writeFileSync(at(`${INDEX}.tmp`), `${JSON.stringify(index, null, 2)}\n`);
    renameSync(at(`${INDEX}.tmp`), at(INDEX));
  };

  async function admin(path: string): Promise<Response> {
    const response = await deps.fetch(`${deps.baseUrl.replace(/\/+$/, "")}${path}`, { headers: { Authorization: `Bearer ${deps.adminToken}` } });
    if (response.status !== 200 && response.status !== 404) throw new Error(`the beta server answered ${String(response.status)} for an admin request`);
    return response;
  }
  async function object(key: string): Promise<Uint8Array> {
    const response = await admin(`/admin/objects/${key}`);
    if (response.status === 404) throw new Refused(`${key.split("/").at(-1) ?? ""} is missing`);
    return new Uint8Array(await response.arrayBuffer());
  }

  const drop = (entry: Index["files"][number]) => {
    index.files.splice(index.files.indexOf(entry), 1);
    save();
  };

  // Tombstones, retention and interrupted runs first, over what is already local. An interrupted entry's files are
  // removed and the file is pulled again below.
  const tombstones = new Set(z.object({ installIds: z.array(z.string()) }).parse(await (await admin("/admin/tombstones")).json()).installIds);
  for (const entry of [...index.files]) {
    const why = tombstones.has(entry.installId) ? "deleted" : expired(entry.month, deps.now) ? "expired" : entry.pending ? "interrupted" : undefined;
    if (why === undefined) continue;
    for (const path of entry.paths) {
      rmSync(at(path), { force: true });
      if (why === "interrupted") {
        deps.log(`removed ${path} (an earlier run was interrupted; pulled again)`);
        continue;
      }
      result[why].push(path);
      deps.log(`${why} ${path}${why === "deleted" ? " (tombstone)" : ""}`);
    }
    try { rmdirSync(dirname(at(entry.paths[0]))); } catch { /* not empty */ }
    drop(entry);
  }

  const keys: string[] = [];
  let after: string | undefined;
  do {
    const page = z.object({ keys: z.array(z.string()), next: z.string().optional() })
      .parse(await (await admin(`/admin/manifests${after === undefined ? "" : `?after=${encodeURIComponent(after)}`}`)).json());
    keys.push(...page.keys);
    after = page.next;
  } while (after !== undefined);

  for (const key of keys) {
    const match = MANIFEST_KEY.exec(key);
    const [installId, fileId] = match ? [match[1], match[2]] : ["?", "?"];
    const label = `${installId.slice(0, 8)}/${fileId.slice(0, 8)}`;
    if (tombstones.has(installId) || index.files.some((entry) => entry.installId === installId && entry.fileId === fileId)) continue;
    try {
      if (!match) throw new Refused("not a manifest key");
      const manifest = parseManifest(await object(key), fileId);
      if (expired(manifest.provenance.month, deps.now)) {
        deps.log(`skipped ${label}: past retention`);
        continue;
      }
      const bytes = await download(manifest, key.slice(0, -"manifest.json".length), object);
      checkContent(latin1Decode(bytes), manifest);
      const p = manifest.provenance;
      const path = `fixtures/recordings/${p.catalogId}-beta-${p.vehicleKey.slice(0, 8)}/${p.month}-${p.kind}-${p.fileId.slice(0, 8)}.jsonl`;
      const entry: Index["files"][number] = { installId, fileId, month: p.month, paths: [path, path.replace(/\.jsonl$/, ".redacted.jsonl")], pending: true };
      // Checked before the pending save, so an index entry only ever names paths intake created.
      if (entry.paths.some((local) => existsSync(at(local)))) throw new Refused("the local file exists; not overwritten");
      index.files.push(entry);
      save();
      mkdirSync(dirname(at(path)), { recursive: true });
      try {
        writeFileSync(at(path), bytes, { flag: "wx" });
      } catch {
        drop(entry);
        throw new Refused("the local file exists; not overwritten");
      }
      try {
        await deps.redact(at(path));
      } catch {
        // Ruling (3): both paths were free before this run, so remove both (a partial .redacted.jsonl too); the next run retries.
        for (const local of entry.paths) rmSync(at(local), { force: true });
        drop(entry);
        throw new Refused("redact_vin.py refused it");
      }
      delete entry.pending;
      save();
      result.added.push(path);
      deps.log(`added ${path} (+ .redacted.jsonl)`);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      result.refused.push(label);
      deps.log(`refused ${label}: ${error.message}`);
    }
  }
  deps.log(`intake: ${String(result.added.length)} added, ${String(result.refused.length)} refused, ${String(result.deleted.length)} deleted, ${String(result.expired.length)} expired`);
  return result;
}

function parseManifest(bytes: Uint8Array, fileId: string): BetaManifest {
  let json: unknown;
  try { json = JSON.parse(latin1Decode(bytes)); } catch { throw new Refused("the manifest is not JSON"); }
  const parsed = betaManifestSchema.safeParse(json);
  if (!parsed.success) throw new Refused("the manifest fails its schema");
  if (parsed.data.provenance.fileId !== fileId) throw new Refused("the manifest names another file");
  return parsed.data;
}

/** Every listed part, each with its manifest size and line count, line-aligned. */
async function download(manifest: BetaManifest, prefix: string, object: (key: string) => Promise<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (const [i, listed] of manifest.parts.entries()) {
    const bytes = await object(`${prefix}part-${String(i).padStart(3, "0")}.jsonl`);
    const lines = bytes.reduce((n, b) => n + (b === 0x0a ? 1 : 0), 0);
    if (bytes.length !== listed.bytes || lines !== listed.lines || bytes.at(-1) !== 0x0a) throw new Refused(`part ${String(i)} differs from the manifest`);
    parts.push(bytes);
  }
  const all = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  parts.reduce((offset, part) => { all.set(part, offset); return offset + part.length; }, 0);
  return all;
}

/** The last line is exactly the manifest's provenance line; the rest re-scrubs unchanged (Decision 13). */
function checkContent(text: string, manifest: BetaManifest): void {
  const cut = text.lastIndexOf("\n", text.length - 2) + 1;
  const body = text.slice(0, cut);
  const last = text.slice(cut, -1);
  let record: unknown;
  try { record = JSON.parse(last); } catch { throw new Refused("the provenance line is not JSON"); }
  const line = z.object({ t: z.number() }).safeParse(record);
  if (!line.success || provenanceLine(line.data.t, manifest.provenance) !== last) throw new Refused("the provenance line disagrees with the manifest");
  let same: boolean;
  try { same = scrubRecording(body).text === body; } catch { same = false; }
  if (!same) throw new Refused("re-scrub changes the file");
}

async function main(): Promise<number> {
  const baseUrl = process.env.BETA_URL;
  const adminToken = process.env.BETA_ADMIN_TOKEN;
  if (!baseUrl || !adminToken) {
    process.stderr.write("usage: BETA_URL and BETA_ADMIN_TOKEN in .env, then pnpm beta:intake\n");
    return 2;
  }
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  try {
    await runIntake({ fetch, baseUrl, adminToken, repoRoot, now: new Date(), redact: uvRedact(repoRoot), log: (line) => { process.stdout.write(`${line}\n`); } });
    return 0;
  } catch (error) {
    process.stderr.write(`intake stopped: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return 1;
  }
}

const entry = process.argv.at(1);
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = await main();
}
