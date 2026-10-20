import type { RunFile, SaveTargets } from "../src/runFiles.js";

const DATE = "2026-09-25";

export class FakeTargets implements SaveTargets {
  readonly log: string[] = [];
  readonly kept = new Map<string, string>();
  readonly folderFiles = new Map<string, string>();
  folderRejects?: Error;
  writeThrowsFor?: string;
  readonly writeError = new Error("permission revoked");
  shareRejectsFor?: string;
  readonly shareError = new Error("share already pending");
  keepThrowsFor?: string;
  readonly keepError = new Error("disk full");
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
