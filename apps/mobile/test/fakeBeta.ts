// In-memory BetaFiles and BetaBackend for docs/specs/T2.9-beta-data-upload.md Verification "Stage B": an ordered call
// log, what the backend received, and switchable failures.
import type { BetaManifest } from "obd-core/recording/provenance";
import { BackendError, type Auth, type BetaBackend, type BetaFiles } from "../src/beta/outbox.js";

export class MemoryBetaFiles implements BetaFiles {
  state: string | undefined;
  stateWrites = 0;
  readonly parts = new Map<string, string[]>();

  readState(): Promise<string | undefined> {
    return Promise.resolve(this.state);
  }

  writeState(text: string): Promise<void> {
    this.stateWrites++;
    this.state = text;
    return Promise.resolve();
  }

  appendPart(fileId: string, index: number, text: string): void {
    const parts = this.parts.get(fileId) ?? [];
    parts[index] = (parts[index] ?? "") + text;
    this.parts.set(fileId, parts);
  }

  async *readPartLines(fileId: string, index: number): AsyncIterable<string> {
    await Promise.resolve();
    const lines = (this.parts.get(fileId)?.[index] ?? "").split("\n");
    if (lines.at(-1) === "") lines.pop();
    yield* lines;
  }

  partPath(fileId: string, index: number): string {
    return `beta-outbox/${fileId}/part-${String(index).padStart(3, "0")}.jsonl`;
  }

  removeFile(fileId: string): Promise<void> {
    this.parts.delete(fileId);
    return Promise.resolve();
  }

  /** The text at a partPath, as the phone's UploadTask would stream it. */
  read(path: string): string {
    const match = /^beta-outbox\/(.+)\/part-(\d{3})\.jsonl$/.exec(path);
    const text = match ? this.parts.get(match[1])?.[Number(match[2])] : undefined;
    if (text === undefined) throw new Error(`no part at ${path}`);
    return text;
  }
}

type Call = "register" | "putPart" | "putManifest" | "deleteAll";

export class FakeBetaBackend implements BetaBackend {
  readonly log: string[] = [];
  /** fileId -> part index -> the bytes received. */
  readonly received = new Map<string, string[]>();
  readonly manifests = new Map<string, BetaManifest>();
  readonly installs = new Set<string>();
  /** Returns the error a call rejects with, or undefined to succeed. */
  fail?: (call: Call, index?: number) => BackendError | undefined;
  /** When set, each call waits for the test to resolve it. */
  held?: (() => void)[];

  constructor(private readonly files: MemoryBetaFiles) {}

  register(auth: Auth, consentVersion: string): Promise<void> {
    return this.call("register", `register:${auth.installId}:${consentVersion}`, undefined, () => { this.installs.add(auth.installId); });
  }

  putPart(auth: Auth, fileId: string, index: number, path: string, bytes: number): Promise<void> {
    // Read when the call starts: an upload in flight already has its bytes, even if the part is deleted meanwhile.
    let text: string | Error;
    try { text = this.files.read(path); } catch (error) { text = error as Error; }
    return this.call("putPart", `part:${fileId}:${String(index)}`, index, () => {
      if (text instanceof Error) throw text;
      if (text.length !== bytes) throw new Error(`part ${String(index)} is ${String(text.length)} bytes, told ${String(bytes)}`);
      const parts = this.received.get(fileId) ?? [];
      parts[index] = text;
      this.received.set(fileId, parts);
    }, auth);
  }

  putManifest(auth: Auth, fileId: string, manifest: BetaManifest): Promise<void> {
    return this.call("putManifest", `manifest:${fileId}`, undefined, () => { this.manifests.set(fileId, manifest); }, auth);
  }

  deleteAll(auth: Auth): Promise<void> {
    return this.call("deleteAll", `delete:${auth.installId}`, undefined, () => {
      this.installs.delete(auth.installId);
      this.received.clear();
      this.manifests.clear();
    }, auth);
  }

  /** The uploaded file: its parts joined in order. */
  uploaded(fileId: string): string {
    return (this.received.get(fileId) ?? []).join("");
  }

  private async call(call: Call, entry: string, index: number | undefined, effect: () => void, auth?: Auth): Promise<void> {
    this.log.push(entry);
    if (this.held) await new Promise<void>((resolve) => { this.held?.push(resolve); });
    const error = this.fail?.(call, index);
    if (error) throw error;
    if (auth && call !== "deleteAll" && !this.installs.has(auth.installId)) throw new BackendError(401, "unknown install");
    effect();
  }
}
