import { betaManifestSchema, provenanceLine, type BetaManifest, type BetaProvenance, type UPLOAD_KINDS } from "obd-core/recording/provenance";
import { SCRUB_VERSION, UploadScrubber } from "obd-core/recording/scrub";
import type { GarageVehicle } from "../garage/flow.js";
import { CONSENT_VERSION } from "./consent.js";

// Beta upload outbox (ADR-019): docs/specs/T2.9-beta-data-upload.md §Flow, §Provenance and keys, §Interfaces "Stage B",
// Decisions 3 and 5. Consent state, scrub -> parts -> queue, drain with retry, stop, and Delete my data. Pure TS: files and
// backend are injected (Stage D: expo-file-system; Stage C1: the HTTPS client).

export const PART_BYTES = 16 * 1024 * 1024;
export const BACKOFF_BASE_S = 60;
export const BACKOFF_MAX_S = 6 * 3600;

/** App-private storage. Stage D implements it with expo-file-system; tests use memory. */
export interface BetaFiles {
  readState(): Promise<string | undefined>;
  writeState(text: string): Promise<void>;                        // atomic replace (garage documentStore pattern)
  appendPart(fileId: string, index: number, text: string): void;  // creates beta-outbox/<fileId>/part-NNN.jsonl on first append
  readPartLines(fileId: string, index: number): AsyncIterable<string>;
  partPath(fileId: string, index: number): string;                // what BetaBackend.putPart streams
  removeFile(fileId: string): Promise<void>;                      // deletes every part; no error if absent
}

export interface Auth { installId: string; secret: string }
/** Stage C1 implements it over HTTPS (client.ts). Rejects with BackendError. */
export interface BetaBackend {
  register(auth: Auth, consentVersion: string): Promise<void>;
  putPart(auth: Auth, fileId: string, index: number, path: string, bytes: number): Promise<void>;
  putManifest(auth: Auth, fileId: string, manifest: BetaManifest): Promise<void>;
  deleteAll(auth: Auth): Promise<void>;
}

export class BackendError extends Error {
  readonly status: number | "network";
  constructor(status: number | "network", message: string) {
    super(message);
    this.name = "BackendError";
    this.status = status;
  }
}

export interface BetaStatus {
  needsConsent: boolean;      // no decision yet, or decided under an older CONSENT_VERSION
  sharing: boolean;
  betaId?: string;            // testerKey, first 8 characters, shown in the Garage section
  queued: number;
  failed: number;
  deletePending: boolean;
  line: string;               // one plain sentence for the Garage section
}

type UploadKind = (typeof UPLOAD_KINDS)[number];
interface Retry { attempts: number; nextTry: number }
/** `sent` = parts already accepted by the backend, so a restarted app resumes at the next part. */
interface Item extends Retry { fileId: string; manifest: BetaManifest; sent: number }
interface State {
  version: 1;
  consent: { version: string; share: boolean } | null;
  auth: Auth | null;
  registered: boolean;
  testerKey: string | null;
  vehicleKeys: Record<string, string>;
  outbox: Item[];
  failed: number;
  /** Installs whose Delete my data is not yet confirmed by the backend. */
  deleting: (Auth & Retry)[];
}

const QUEUED = "Queued for beta upload.";
const UNREADABLE = "the beta sharing file (beta.json) is unreadable";
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isAuth = (value: unknown): value is Auth => record(value) && text(value.installId) && text(value.secret);
const isRetry = (value: unknown) => record(value) && count(value.attempts) && typeof value.nextTry === "number" && Number.isFinite(value.nextTry);

function validItem(value: unknown): value is Item {
  if (!record(value) || !isRetry(value) || !text(value.fileId) || !count(value.sent)) return false;
  const manifest = betaManifestSchema.safeParse(value.manifest);
  return manifest.success && manifest.data.provenance.fileId === value.fileId && value.sent <= manifest.data.parts.length;
}

/** By hand, in the style of garage/flow.ts parseState. undefined = unreadable: never overwritten, nothing uploads. */
function parseState(raw: string): State | undefined {
  let data: unknown;
  try { data = JSON.parse(raw) as unknown; } catch { return undefined; }
  if (!record(data) || data.version !== 1) return undefined;
  const { consent, auth, testerKey, vehicleKeys, outbox, deleting } = data;
  const valid = (consent === null || (record(consent) && text(consent.version) && typeof consent.share === "boolean"))
    && (auth === null || isAuth(auth)) && typeof data.registered === "boolean" && (testerKey === null || text(testerKey))
    && record(vehicleKeys) && Object.values(vehicleKeys).every(text) && Array.isArray(outbox) && outbox.every(validItem)
    && count(data.failed) && Array.isArray(deleting) && deleting.every((d) => isAuth(d) && isRetry(d));
  return valid ? data as unknown as State : undefined;
}

const empty = (): State => ({ version: 1, consent: null, auth: null, registered: false, testerKey: null, vehicleKeys: {}, outbox: [], failed: 0, deleting: [] });
const sharing = (state: State) => state.consent?.share === true && state.consent.version === CONSENT_VERSION && state.auth !== null;
const backoffS = (attempts: number) => Math.min(BACKOFF_BASE_S * 2 ** (attempts - 1), BACKOFF_MAX_S);
/** Network errors, 429 and 5xx retry; anything else the backend rejects (400, 409, 413, …) will not change on retry. */
const retryable = (error: unknown) => !(error instanceof BackendError) || error.status === "network" || error.status === 429 || error.status >= 500;
const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

function statusLine(state: State): string {
  if (state.deleting.length > 0) return "Deleting your uploaded beta data; it retries until the server confirms.";
  if (state.consent === null) return "Beta data sharing is off; no choice made yet.";
  if (state.consent.version !== CONSENT_VERSION) return "Beta data sharing is paused until you review the updated consent.";
  if (!sharing(state)) return "Beta data sharing is off.";
  const failed = state.failed > 0 ? ` ${plural(state.failed, "file")} could not be uploaded.` : "";
  return `Beta data sharing is on; ${state.outbox.length === 0 ? "nothing" : plural(state.outbox.length, "file")} waiting to upload.${failed}`;
}

function linesOf(input: string): string[] {
  const lines = input.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function createBetaOutbox(deps: {
  files: BetaFiles;
  backend: BetaBackend;
  newId(): string;            // UUID v4 (Stage D: expo-modules-core uuid.v4)
  nowS(): number;             // for backoff
  month(): string;            // "YYYY-MM", phone local
  appVersion: string;
  /** Tests only: a smaller part size so small files split. */
  partBytes?: number;
}) {
  const { files, backend } = deps;
  const partBytes = deps.partBytes ?? PART_BYTES;
  let loaded: Promise<State | undefined> | undefined;
  const load = () => (loaded ??= files.readState().then((raw) => (raw === undefined ? empty() : parseState(raw)), () => undefined));
  let saving: Promise<void> = Promise.resolve();
  /** Writes are serialized, each with the state as it was when save was called. */
  const save = (state: State): Promise<void> => {
    const snapshot = JSON.stringify(state);
    const next = saving.then(() => files.writeState(snapshot));
    saving = next.catch(() => undefined);
    return next;
  };
  const discard = async (state: State, items: readonly Item[]) => {
    state.outbox = state.outbox.filter((item) => !items.includes(item));
    await save(state);
    for (const item of items) await files.removeFile(item.fileId);
  };

  /** Pass 1 into line-aligned parts plus the provenance line, then pass 2 over the stored parts. Throws ScrubRefusal. */
  async function scrubToParts(fileId: string, input: string | AsyncIterable<string>, provenance: (t: number, scrub: BetaProvenance["scrub"]) => BetaProvenance): Promise<BetaManifest> {
    const scrubber = new UploadScrubber();
    const parts: BetaManifest["parts"] = [];
    let chunk = "";
    let last: string | undefined;
    const flush = () => {
      if (chunk !== "") files.appendPart(fileId, parts.length - 1, chunk);
      chunk = "";
    };
    // Scrubbed lines are Python json.dumps form, which is ASCII only, so a line's length is its byte count.
    const add = (lines: readonly string[]) => {
      for (const line of lines) {
        const bytes = line.length + 1;
        const part = parts.at(-1);
        if (part === undefined || (part.bytes > 0 && part.bytes + bytes > partBytes)) {
          flush();
          parts.push({ bytes, lines: 1 });
        } else {
          part.bytes += bytes;
          part.lines++;
        }
        chunk += `${line}\n`;
        last = line;
      }
      flush();
    };
    for await (const line of typeof input === "string" ? linesOf(input) : input) add(scrubber.push(line));
    const { lines, report } = scrubber.end();
    add(lines);
    if (last === undefined) throw new Error("the recording is empty");
    const t = (JSON.parse(last) as { t: number }).t;
    const recordingLines = parts.reduce((sum, part) => sum + part.lines, 0);
    const final = provenance(t, report.masked);
    add([provenanceLine(t, final)]);
    let seen = 0;
    for (let i = 0; i < parts.length; i++) {
      for await (const line of files.readPartLines(fileId, i)) if (seen++ < recordingLines) scrubber.verify(line);
    }
    scrubber.verifyEnd();
    return betaManifestSchema.parse({ provenance: final, parts });
  }

  /** "stop" ends this drain (retry later, or the item was discarded meanwhile). */
  async function upload(state: State, auth: Auth, item: Item): Promise<"next" | "stop"> {
    try {
      if (!state.registered) {
        // 409 = this installId already exists: an earlier register succeeded but its state write was lost.
        try { await backend.register(auth, CONSENT_VERSION); }
        catch (error) { if (!(error instanceof BackendError && error.status === 409)) throw error; }
        if (state.auth !== auth) return "stop";
        state.registered = true;
        await save(state);
      }
      for (let i = item.sent; i < item.manifest.parts.length; i++) {
        await backend.putPart(auth, item.fileId, i, files.partPath(item.fileId, i), item.manifest.parts[i].bytes);
        if (!state.outbox.includes(item)) return "stop";
        item.sent = i + 1;
        await save(state);
      }
      await backend.putManifest(auth, item.fileId, item.manifest);
      if (state.outbox.includes(item)) await discard(state, [item]);
      return "next";
    } catch (error) {
      if (!state.outbox.includes(item)) return "stop";
      if (retryable(error)) {
        item.attempts++;
        item.nextTry = deps.nowS() + backoffS(item.attempts);
        await save(state);
        return "stop";
      }
      state.failed++;
      await discard(state, [item]);
      return "next";
    }
  }

  async function run(): Promise<void> {
    const state = await load();
    if (!state) return;
    for (const pending of [...state.deleting]) {
      if (pending.nextTry > deps.nowS()) continue;
      try {
        await backend.deleteAll(pending);
        state.deleting = state.deleting.filter((d) => d !== pending);
        // The consent is wiped once the server confirms, unless the tester has opted in again meanwhile.
        if (state.deleting.length === 0 && state.auth === null) state.consent = null;
      } catch {
        pending.attempts++;
        pending.nextTry = deps.nowS() + backoffS(pending.attempts);
      }
      await save(state);
    }
    for (const item of [...state.outbox]) {
      const auth = state.auth;
      if (!sharing(state) || auth === null) return;
      if (!state.outbox.includes(item) || item.nextTry > deps.nowS()) continue;
      if (await upload(state, auth, item) === "stop") return;
    }
  }

  let running: Promise<void> | undefined;
  /** Counts switch-offs, so a file scrubbed across a stop is dropped even if sharing is back on when the scrub ends. */
  let stops = 0;
  const drain = (): Promise<void> => (running ??= run().catch(() => undefined).finally(() => { running = undefined; }));

  return {
    async status(): Promise<BetaStatus> {
      const state = await load();
      if (!state) return { needsConsent: false, sharing: false, queued: 0, failed: 0, deletePending: false, line: `Beta data sharing is off: ${UNREADABLE}; nothing uploads.` };
      return {
        needsConsent: state.consent === null || state.consent.version !== CONSENT_VERSION,
        sharing: sharing(state),
        ...(state.testerKey === null ? {} : { betaId: state.testerKey.slice(0, 8) }),
        queued: state.outbox.length,
        failed: state.failed,
        deletePending: state.deleting.length > 0,
        line: statusLine(state),
      };
    },

    /** The consent screen's Continue, and the Garage switch. Off: empties the queue unsent. */
    async decide(share: boolean): Promise<void> {
      const state = await load();
      if (!state) throw new Error(`Not changed: ${UNREADABLE}.`);
      state.consent = { version: CONSENT_VERSION, share };
      if (share && state.auth === null) {
        state.auth = { installId: deps.newId(), secret: `${deps.newId()}${deps.newId()}` };
        state.testerKey = deps.newId();
        state.registered = false;
      }
      if (share) await save(state);
      else {
        stops++;
        await discard(state, state.outbox);
      }
    },

    /** Never rejects. undefined when not sharing or consent outdated. `checked` entries queue like `mine` (Decision 3); the ownership tag rides in provenance, not in this filter. */
    async queue(kind: UploadKind, entry: GarageVehicle, lines: string | AsyncIterable<string>): Promise<string | undefined> {
      const fileId = deps.newId();
      try {
        const state = await load();
        if (!state) return `Not queued for beta upload: ${UNREADABLE}.`;
        const testerKey = state.testerKey;
        const epoch = stops;
        if (!sharing(state) || testerKey === null) return undefined;
        const vehicleKey = (state.vehicleKeys[entry.id] ??= deps.newId());
        const manifest = await scrubToParts(fileId, lines, (t, scrub) => ({
          schema: 1, fileId, kind, consentVersion: CONSENT_VERSION, appVersion: deps.appVersion, scrubVersion: SCRUB_VERSION,
          month: deps.month(), catalogId: entry.catalogId, ownership: entry.ownership, testerKey, vehicleKey, synthetic: false, scrub,
        }));
        // Sharing may have been switched off (even if back on since), or the data deleted, while the file was scrubbed.
        if (!sharing(state) || state.testerKey !== testerKey || stops !== epoch) {
          await files.removeFile(fileId);
          return undefined;
        }
        state.outbox.push({ fileId, manifest, sent: 0, attempts: 0, nextTry: 0 });
        await save(state);
        return QUEUED;
      } catch (error) {
        await files.removeFile(fileId).catch(() => undefined);
        return `Not queued for beta upload: ${message(error)}.`;
      }
    },

    /** Never rejects. One drain at a time; a second call while one runs returns the same promise. */
    drain,

    /** Never rejects. Returns one status sentence. */
    async deleteMyData(): Promise<string> {
      try {
        const state = await load();
        if (!state) return `Not deleted: ${UNREADABLE}.`;
        if (state.auth !== null && state.registered) state.deleting.push({ ...state.auth, attempts: 0, nextTry: 0 });
        state.auth = null;
        state.testerKey = null;
        state.registered = false;
        state.vehicleKeys = {};
        state.failed = 0;
        state.consent = state.deleting.length > 0 ? { version: CONSENT_VERSION, share: false } : null;
        await discard(state, state.outbox);
        await drain();
        // A drain already running may have passed its delete step before this request.
        if (state.deleting.some((pending) => pending.attempts === 0)) await drain();
        return state.deleting.length > 0 ? "Delete requested; it retries until the server confirms." : "Your beta data was deleted.";
      } catch (error) {
        return `Delete my data failed: ${message(error)}.`;
      }
    },
  };
}
