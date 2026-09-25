// In-memory SaveTargets for docs/specs/T0.9b-one-and-done-captures.md Verification: an ordered call log, the folder's
// files, and switchable failures.
import type { RunFile, SaveTargets } from "../src/runFiles.js";

const DATE = "2026-09-25";

export class FakeTargets implements SaveTargets {
  readonly log: string[] = [];
  readonly kept = new Map<string, string>();
  readonly folderFiles = new Map<string, string>();
  folderRejects?: Error;
  /** A file name; its folder write throws `writeError`. */
  writeThrowsFor?: string;
  writeError = new Error("permission revoked");
  /** A file name; its share rejects `shareError`. */
  shareRejectsFor?: string;
  shareError = new Error("share already pending");
  /** A slug; its keep throws `keepError`. */
  keepThrowsFor?: string;
  keepError = new Error("disk full");
  /** When set, each share stays open until the test calls the resolver pushed here. */
  heldShares?: (() => void)[];

  keep(file: RunFile): string {
    if (file.slug === this.keepThrowsFor) throw this.keepError;
    let name = `${DATE}-${file.slug}${file.extension}`;
    for (let suffix = 2; this.kept.has(name); suffix++) name = `${DATE}-${file.slug}-${String(suffix)}${file.extension}`;
    this.kept.set(name, file.content);
    this.log.push(`keep:${name}`);
    return name;
  }

  folder(): Promise<{ write(name: string, file: RunFile): void }> {
    this.log.push("folder");
    if (this.folderRejects) return Promise.reject(this.folderRejects);
    return Promise.resolve({
      write: (name: string, file: RunFile) => {
        this.log.push(`write:${name}`);
        if (name === this.writeThrowsFor) throw this.writeError;
        this.folderFiles.set(name, file.content);
      },
    });
  }

  forgetFolder(): void {
    this.log.push("forget");
  }

  share(name: string): Promise<void> {
    this.log.push(`share:${name}`);
    if (name === this.shareRejectsFor) return Promise.reject(this.shareError);
    const held = this.heldShares;
    if (!held) return Promise.resolve();
    return new Promise<void>((resolve) => { held.push(resolve); });
  }
}
