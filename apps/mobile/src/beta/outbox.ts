import { betaManifestSchema, provenanceLine, type BetaManifest, type BetaProvenance, type UPLOAD_KINDS } from "obd-core/recording/provenance";
import { SCRUB_VERSION, UploadScrubber } from "obd-core/recording/scrub";
import type { GarageVehicle } from "../garage/flow.js";
import { CONSENT_VERSION } from "./consent.js";

// Beta upload outbox (ADR-019): docs/specs/T2.9-beta-data-upload.md §Flow, §Provenance and keys, §Interfaces "Stage B",
// Decisions 3 and 5. Consent state, scrub -> parts -> queue, drain with retry, stop, and Delete my data. Pure TS: files and
// backend are injected (Stage D: expo-file-system; Stage C1: the HTTPS client). Stage C1 adds the orchestrator's C1-a (401
// and register failures retry), C1-b (server copies of dropped files are deleted), C1-c, and repair round 2's D1-D3
// and C1b, and Stage D's carried items (docs/task-runs/T2.9.md).

export const PART_BYTES = 16 * 1024 * 1024;
export const BACKOFF_BASE_S = 60;
export const BACKOFF_MAX_S = 6 * 3600;
/** Stage D repair 1 (3): parts are written in chunks of about this size, not a line at a time, since each append is one
 *  file open/write/close on the phone. */
const FLUSH_BYTES = 1024 * 1024;

/** App-private storage. Stage D implements it with expo-file-system; tests use memory. */
export interface BetaFiles {
  readState(): Promise<string | undefined>;
  writeState(text: string): Promise<void>;                        // atomic replace (garage documentStore pattern)
  appendPart(fileId: string, index: number, text: string): void;  // creates beta-outbox/<fileId>/part-NNN.jsonl on first append
  readPartLines(fileId: string, index: number): AsyncIterable<string>;
  partPath(fileId: string, index: number): string;                // what BetaBackend.putPart streams
  removeFile(fileId: string): Promise<void>;                      // deletes every part; no error if absent
  fileIds(): Promise<string[]>;                                   // Stage D: every fileId with parts in beta-outbox/, for the orphan sweep
}

export interface Auth { installId: string; secret: string }
/** Stage C1 implements it over HTTPS (client.ts). Rejects with BackendError. */
export interface BetaBackend {
  register(auth: Auth, consentVersion: string): Promise<void>;
  putPart(auth: Auth, fileId: string, index: number, path: string, bytes: number): Promise<void>;
  putManifest(auth: Auth, fileId: string, manifest: BetaManifest): Promise<void>;
  deleteAll(auth: Auth): Promise<void>;
  /** C1-b: deletes one file's server copy; resolves when nothing is there. */
  deleteFile(auth: Auth, fileId: string): Promise<void>;
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
/** `sent` = parts already accepted by the backend, so a restarted app resumes at the next part. `attempted` (D2) = the
 *  highest part index ever sent, whose answer may have been lost; absent = no part sent yet. */
interface Item extends Retry { fileId: string; manifest: BetaManifest; sent: number; attempted?: number }
interface State {
  version: 1;
  consent: { version: string; share: boolean } | null;
  auth: Auth | null;
  registered: boolean;
  /** D3: a register was sent for this auth, even if its answer was lost. */
  registerAttempted: boolean;
  /** D1: the server answered 401 and nothing was accepted since; a re-register answered 409 then pauses uploads. C1b: any
   *  later success of this install's credentials clears it, and so does a 409 with nothing queued. */
  recheck: boolean;
  testerKey: string | null;
  vehicleKeys: Record<string, string>;
  outbox: Item[];
  failed: number;
  /** Server deletes not yet confirmed: an install's Delete my data (with the Beta ID it showed), or (with fileId) one
   *  dropped file's parts. */
  deleting: (Auth & Retry & { fileId?: string; betaId?: string })[];
  /** Stage D: the server answered 410 and everything was wiped here; shown until the next choice, across restarts. */
  serverDeleted: boolean;
}

const QUEUED = "Queued for beta upload.";
const SERVER_DELETED = "Your beta data was deleted on the server. Sharing is off.";
const UNREADABLE = "the beta sharing file (beta.json) is unreadable";
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isAuth = (value: unknown): value is Auth => record(value) && text(value.installId) && text(value.secret);
const isRetry = (value: unknown) => record(value) && count(value.attempts) && typeof value.nextTry === "number" && Number.isFinite(value.nextTry);

function validItem(value: unknown): value is Item {
  if (!record(value) || !isRetry(value) || !text(value.fileId) || !count(value.sent) || !(value.attempted === undefined || count(value.attempted))) return false;
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
    && (auth === null || isAuth(auth)) && typeof data.registered === "boolean" && typeof data.registerAttempted === "boolean"
    && typeof data.recheck === "boolean" && (testerKey === null || text(testerKey))
    && record(vehicleKeys) && Object.values(vehicleKeys).every(text) && Array.isArray(outbox) && outbox.every(validItem)
    && count(data.failed) && Array.isArray(deleting) && typeof data.serverDeleted === "boolean"
    && deleting.every((d) => isAuth(d) && isRetry(d) && (!("fileId" in d) || text(d.fileId)) && (!("betaId" in d) || text(d.betaId)));
  return valid ? data as unknown as State : undefined;
}

const empty = (): State => ({
  version: 1, consent: null, auth: null, registered: false, registerAttempted: false, recheck: false, testerKey: null, vehicleKeys: {}, outbox: [], failed: 0, deleting: [], serverDeleted: false,
});
const sharing = (state: State) => state.consent?.share === true && state.consent.version === CONSENT_VERSION && state.auth !== null;
const backoffS = (attempts: number) => Math.min(BACKOFF_BASE_S * 2 ** (attempts - 1), BACKOFF_MAX_S);
/** C1-a: only 400, 409 and 413 on a part or manifest will not change on retry; everything else backs off. */
const permanent = (error: unknown) => error instanceof BackendError && (error.status === 400 || error.status === 409 || error.status === 413);
/** A Delete my data (not a single file's delete) is waiting for the server. */
const deletingAll = (state: State) => state.deleting.some((pending) => pending.fileId === undefined);
/** The Beta IDs those requests showed. */
const deletingIds = (state: State) => state.deleting.flatMap((pending) => (pending.fileId === undefined && pending.betaId !== undefined ? [pending.betaId] : []));
const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

function statusLine(state: State): string {
  // Stage D: the pending delete keeps its Beta ID (the tester's reference if it never completes) and never hides the
  // line of an identity opted in since.
  const ids = deletingIds(state);
  const deleting = deletingAll(state)
    ? `Deleting your uploaded beta data${ids.length === 0 ? "" : ` (Beta ID ${ids.join(", ")})`}; it retries until the server confirms.`
    : undefined;
  if (sharing(state)) {
    const failed = state.failed > 0 ? ` ${plural(state.failed, "file")} could not be uploaded.` : "";
    const line = state.recheck && state.registered
      ? `Uploads paused. Beta ID ${state.testerKey?.slice(0, 8) ?? ""}.`
      : `Beta data sharing is on; ${state.outbox.length === 0 ? "nothing" : plural(state.outbox.length, "file")} waiting to upload.${failed}`;
    return deleting === undefined ? line : `${line} ${deleting}`;
  }
  if (deleting !== undefined) return deleting;
  if (state.consent === null) return state.serverDeleted ? SERVER_DELETED : "Beta data sharing is off; no choice made yet.";
  if (state.consent.version !== CONSENT_VERSION) return "Beta data sharing is paused until you review the updated consent.";
  return "Beta data sharing is off.";
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
  /** The item whose parts are being sent, so a stop knows a part may still land on the server. */
  let current: Item | undefined;
  /** `onServer` items get a server delete queued (C1-b), with the install's current credentials. */
  const discard = async (state: State, items: readonly Item[], onServer: (item: Item) => boolean = () => false) => {
    state.outbox = state.outbox.filter((item) => !items.includes(item));
    const auth = state.auth;
    if (auth !== null) for (const item of items.filter(onServer)) state.deleting.push({ ...auth, fileId: item.fileId, attempts: 0, nextTry: 0 });
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
        if (chunk.length >= FLUSH_BYTES) flush();
      }
    };
    for await (const line of typeof input === "string" ? linesOf(input) : input) add(scrubber.push(line));
    const { lines, report } = scrubber.end();
    add(lines);
    if (last === undefined) throw new Error("the recording is empty");
    const t = (JSON.parse(last) as { t: number }).t;
    const recordingLines = parts.reduce((sum, part) => sum + part.lines, 0);
    const final = provenance(t, report.masked);
    add([provenanceLine(t, final)]);
    flush();
    let seen = 0;
    for (let i = 0; i < parts.length; i++) {
      for await (const line of files.readPartLines(fileId, i)) if (seen++ < recordingLines) scrubber.verify(line);
    }
    scrubber.verifyEnd();
    return betaManifestSchema.parse({ provenance: final, parts });
  }

  const retryLater = async (state: State, item: Item) => {
    item.attempts++;
    item.nextTry = deps.nowS() + backoffS(item.attempts);
    await save(state);
  };

  /** D1: register answered 410, so the server deleted this install and holds nothing more; wipe locally as a confirmed
   *  Delete my data. */
  const deletedOnServer = async (state: State, installId: string) => {
    state.deleting = state.deleting.filter((pending) => pending.installId !== installId);
    state.consent = null;
    state.auth = null;
    state.testerKey = null;
    state.registered = false;
    state.vehicleKeys = {};
    state.failed = 0;
    state.serverDeleted = true;
    await discard(state, state.outbox);
  };

  /** "stop" ends this drain (retry later, or the item was discarded meanwhile). */
  async function upload(state: State, auth: Auth, item: Item): Promise<"next" | "stop"> {
    // R1: checked before every part and the manifest, since a stop or delete may run during any await.
    const unchanged = () => state.outbox.includes(item) && sharing(state) && state.auth === auth;
    // Set before register, so a stop from here on queues the file's server delete (C1-b).
    current = item;
    try {
      if (!state.registered) {
        if (!state.registerAttempted) {
          // D3: saved before the request, so Delete my data sends the install delete even if the answer is lost.
          state.registerAttempted = true;
          await save(state);
        }
        // C1b: a stop or Delete my data during that save sends no register.
        if (!unchanged()) return "stop";
        const answer = await backend.register(auth, CONSENT_VERSION).then(() => 201, (error: unknown) => (error instanceof BackendError ? error.status : undefined));
        // C1-c, D3: Delete my data ran while this register was in flight and has queued the install delete itself.
        if (state.auth !== auth) return "stop";
        if (answer === 410) {
          await deletedOnServer(state, auth.installId);
          return "stop";
        }
        // 409 = the installId exists. On a first register, an earlier one succeeded but its state write was lost. After a
        // 401 (D1), a live record holds another secret, or the 401 did not come from the Worker: pause and back off.
        if (answer === 201 || answer === 409) {
          state.registered = true;
          if (answer === 201) state.recheck = false;
          if (state.recheck) {
            if (state.outbox.includes(item)) await retryLater(state, item);
            else {
              // C1b: the paused file is gone, so the pause ends; a file queued meanwhile finds out on its own attempt.
              state.recheck = false;
              await save(state);
            }
            return "stop";
          }
          await save(state);
        } else {
          // C1-a: a failed register (400 included) never discards files.
          if (state.outbox.includes(item)) await retryLater(state, item);
          return "stop";
        }
      }
      for (let i = item.sent; i < item.manifest.parts.length; i++) {
        if (i > (item.attempted ?? -1)) {
          // D2: saved before the request, so a stop or a permanent failure deletes a part whose answer was lost.
          item.attempted = i;
          await save(state);
        }
        if (!unchanged()) return "stop";
        await backend.putPart(auth, item.fileId, i, files.partPath(item.fileId, i), item.manifest.parts[i].bytes);
        if (!state.outbox.includes(item)) return "stop";
        item.sent = i + 1;
        state.recheck = false;
        await save(state);
      }
      if (!unchanged()) return "stop";
      await backend.putManifest(auth, item.fileId, item.manifest);
      if (state.outbox.includes(item)) await discard(state, [item]);
      return "next";
    } catch (error) {
      if (!state.outbox.includes(item)) return "stop";
      if (error instanceof BackendError && error.status === 401 && state.auth === auth) {
        // C1-a, D1: the server does not accept these credentials. Register the same installId and secret again on the
        // next drain (201, 409 or 410 tells why) and send every file from part 0, since none of its earlier parts can be
        // assumed to be there.
        state.registered = false;
        state.recheck = true;
        for (const queued of state.outbox) queued.sent = 0;
      }
      if (!permanent(error)) {
        await retryLater(state, item);
        return "stop";
      }
      state.failed++;
      // D2: any part sent may be on the server, even one whose answer was lost.
      await discard(state, [item], (dropped) => dropped.attempted !== undefined);
      return "next";
    } finally {
      current = undefined;
    }
  }

  async function run(): Promise<void> {
    const state = await load();
    if (!state) return;
    // Stage D: parts beta.json does not list (an app killed between writing a file's parts and saving it, or a failed
    // removeFile). A file still being scrubbed is not listed yet and is kept.
    for (const fileId of await files.fileIds().catch(() => [])) {
      if (!scrubbing.has(fileId) && !state.outbox.some((item) => item.fileId === fileId)) await files.removeFile(fileId).catch(() => undefined);
    }
    for (const pending of [...state.deleting]) {
      if (pending.nextTry > deps.nowS()) continue;
      let done = true;
      try {
        await (pending.fileId === undefined ? backend.deleteAll(pending) : backend.deleteFile(pending, pending.fileId));
      } catch {
        // C1b: only a 2xx is done. The Worker answers 204 for an install it holds nothing of, so a 401 means a live record
        // holds another secret, or it came from something in front of the Worker: retry like an upload.
        done = false;
      }
      if (done) {
        state.deleting = state.deleting.filter((d) => d !== pending);
        // C1b: the install's credentials were accepted, so a pause from an earlier 401 is over.
        if (state.auth?.installId === pending.installId) state.recheck = false;
        // The consent is wiped once the server confirms, unless the tester has opted in again meanwhile.
        if (state.deleting.length === 0 && state.auth === null) state.consent = null;
      } else {
        pending.attempts++;
        pending.nextTry = deps.nowS() + backoffS(pending.attempts);
      }
      await save(state);
    }
    // Stage D repair 1 (2): the outbox is read again after every file, so a file queued during this drain is sent by it.
    // Each "next" removed its file, so this ends.
    for (;;) {
      const auth = state.auth;
      const item = state.outbox.find((queued) => queued.nextTry <= deps.nowS());
      if (!sharing(state) || auth === null || item === undefined) return;
      if (await upload(state, auth, item) === "stop") return;
    }
  }

  let running: Promise<void> | undefined;
  /** fileIds whose parts queue() is writing; the orphan sweep keeps them. */
  const scrubbing = new Set<string>();
  /** Counts switch-offs, so a file scrubbed across a stop is dropped even if sharing is back on when the scrub ends. */
  let stops = 0;
  /** Stage D repair 1: drain() calls so far. One made while a run is in flight, which may be past its last outbox check,
   *  runs it once more. */
  let requests = 0;
  const drain = (): Promise<void> => {
    requests++;
    if (running) return running;
    running = (async () => {
      try {
        let served: number;
        do {
          served = requests;
          await run().catch(() => undefined);
        } while (requests !== served);
      } finally { running = undefined; }
    })();
    return running;
  };

  return {
    async status(): Promise<BetaStatus> {
      const state = await load();
      if (!state) return { needsConsent: false, sharing: false, queued: 0, failed: 0, deletePending: false, line: `Beta data sharing is off: ${UNREADABLE}; nothing uploads.` };
      const betaId = state.testerKey?.slice(0, 8) ?? deletingIds(state).at(0);
      return {
        needsConsent: state.consent === null || state.consent.version !== CONSENT_VERSION,
        sharing: sharing(state),
        ...(betaId === undefined ? {} : { betaId }),
        queued: state.outbox.length,
        failed: state.failed,
        deletePending: deletingAll(state),
        line: statusLine(state),
      };
    },

    /** The consent screen's Continue, and the Garage switch. Off: empties the queue unsent. */
    async decide(share: boolean): Promise<void> {
      const state = await load();
      if (!state) throw new Error(`Not changed: ${UNREADABLE}.`);
      state.consent = { version: CONSENT_VERSION, share };
      state.serverDeleted = false;
      if (share && state.auth === null) {
        state.auth = { installId: deps.newId(), secret: `${deps.newId()}${deps.newId()}` };
        state.testerKey = deps.newId();
        state.registered = false;
        state.registerAttempted = false;
        state.recheck = false;
      }
      if (share) await save(state);
      else {
        stops++;
        // C1-b, D2: any part sent (its answer may be lost), or a file whose upload is running, is deleted on the server too.
        await discard(state, state.outbox, (item) => item.attempted !== undefined || item === current);
      }
    },

    /** Never rejects. undefined when not sharing or consent outdated. `checked` entries queue like `mine` (Decision 3); the ownership tag rides in provenance, not in this filter. */
    async queue(kind: UploadKind, entry: GarageVehicle, lines: string | AsyncIterable<string>): Promise<string | undefined> {
      const fileId = deps.newId();
      scrubbing.add(fileId);
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
      } finally {
        scrubbing.delete(fileId);
      }
    },

    /** Never rejects. One drain at a time; a second call while one runs returns the same promise. */
    drain,

    /** Never rejects. Returns one status sentence. */
    async deleteMyData(): Promise<string> {
      try {
        const state = await load();
        if (!state) return `Not deleted: ${UNREADABLE}.`;
        if (state.auth !== null) {
          const { installId } = state.auth;
          // The install's delete covers its pending file deletes. D3: sent once any register was sent.
          state.deleting = state.deleting.filter((pending) => pending.installId !== installId);
          if (state.registerAttempted) state.deleting.push({ ...state.auth, ...(state.testerKey === null ? {} : { betaId: state.testerKey.slice(0, 8) }), attempts: 0, nextTry: 0 });
        }
        state.auth = null;
        state.testerKey = null;
        state.registered = false;
        state.vehicleKeys = {};
        state.failed = 0;
        state.consent = deletingAll(state) ? { version: CONSENT_VERSION, share: false } : null;
        await discard(state, state.outbox);
        await drain();
        // A drain already running may have passed its delete step before this request.
        if (state.deleting.some((pending) => pending.attempts === 0)) await drain();
        return deletingAll(state) ? "Delete requested; it retries until the server confirms." : "Your beta data was deleted.";
      } catch (error) {
        return `Delete my data failed: ${message(error)}.`;
      }
    },
  };
}
