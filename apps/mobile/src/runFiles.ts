import { codesReportMarkdown, type ReportHeading } from "./codesScan.js";

export interface RunFile {
  slug: "phone-console" | "codes-report";
  extension: ".jsonl" | ".md";
  mimeType: "application/x-ndjson" | "text/markdown";
  content: string;
}

/** The phone's storage. App.tsx implements it with expo-file-system and expo-sharing; tests use a fake. */
export interface SaveTargets {
  /** Writes a new file under the app's private documents directory, captures/<date>-<slug>[-N]<ext>, never
   *  overwriting. Returns the name used. Throws on failure. */
  keep(file: RunFile): string;
  /** The remembered capture folder, or the folder picker when none is remembered (the choice is remembered).
   *  Rejects when the picker is cancelled or the folder cannot be opened. */
  folder(): Promise<{ write(name: string, file: RunFile): void }>;
  /** Forgets the remembered folder, so the next run shows the picker again. */
  forgetFolder(): void;
  /** Opens the share sheet for the private copy `name`; resolves when the sheet closes. */
  share(name: string, file: RunFile): Promise<void>;
}

export interface RunOutcome {
  /** The report markdown, for display; only for a codes run that produced one. */
  report?: string;
  /** One sentence per file, plus a leading report sentence for a codes run without a report. */
  status: string;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** After a run's recording is frozen: keeps and delivers the recording, and for a codes run builds, keeps and
 *  delivers the report. Never throws. Every file ends in exactly one status sentence. */
export async function finishRun(kind: "recording" | "codes", jsonl: string, heading: ReportHeading, targets: SaveTargets): Promise<RunOutcome> {
  const files: RunFile[] = [];
  const names = new Map<RunFile, string>();
  const sentences = new Map<RunFile, string>();
  const keep = (file: RunFile) => {
    files.push(file);
    try { names.set(file, targets.keep(file)); }
    catch (error) { sentences.set(file, `NOT SAVED ${file.slug}${file.extension}: ${message(error)}.`); }
  };
  // Kept before the report is built, so a report failure can never cost the recording (the 2026-09-24 loss).
  keep({ slug: "phone-console", extension: ".jsonl", mimeType: "application/x-ndjson", content: jsonl });
  let lead: string | undefined;
  let report: string | undefined;
  if (kind === "codes") {
    try { report = await codesReportMarkdown(jsonl, heading); }
    catch (error) { lead = `Report error: ${message(error)}.`; }
    if (report !== undefined) keep({ slug: "codes-report", extension: ".md", mimeType: "text/markdown", content: report });
    else lead ??= "No module answered; no report.";
  }
  if (names.size > 0) {
    let folder: { write(name: string, file: RunFile): void } | undefined;
    let reason = "";
    try { folder = await targets.folder(); }
    catch (error) { reason = message(error); }
    for (const file of files) {
      const name = names.get(file);
      if (name === undefined) continue;
      if (folder) {
        try { folder.write(name, file); sentences.set(file, `Saved ${name} to the capture folder.`); continue; }
        catch (error) { reason = message(error); folder = undefined; targets.forgetFolder(); }
      }
      // One sheet at a time: expo-sharing rejects a share while another is pending.
      try { await targets.share(name, file); sentences.set(file, `Share sheet opened for ${name} (capture folder: ${reason}).`); }
      catch (error) { sentences.set(file, `NOT SAVED ${name}: ${message(error)}. A copy stays in app storage (captures/${name}).`); }
    }
  }
  const status = [lead, ...files.map((file) => sentences.get(file))].filter((sentence) => sentence !== undefined).join(" ");
  return report === undefined ? { status } : { report, status };
}
