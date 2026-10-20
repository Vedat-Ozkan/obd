import { codesReportMarkdown, type ReportHeading } from "./codesScan.js";

export interface RunFile {
  slug: "phone-console" | "codes-report";
  extension: ".jsonl" | ".md";
  mimeType: "application/x-ndjson" | "text/markdown";
  content: string;
}

export interface SaveTargets {
  keep(file: RunFile): string;
  folder(): Promise<{ write(name: string, file: RunFile): void }>;
  forgetFolder(): void;
  share(name: string, file: RunFile): Promise<void>;
}

export interface RunOutcome {
  report?: string;
  status: string;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export async function finishRun(kind: "recording" | "codes", jsonl: string, heading: ReportHeading, targets: SaveTargets,
  upload?: (jsonl: string) => Promise<string | undefined>): Promise<RunOutcome> {
  const files: RunFile[] = [];
  const names = new Map<RunFile, string>();
  const sentences = new Map<RunFile, string>();
  const keep = (file: RunFile) => {
    files.push(file);
    try { names.set(file, targets.keep(file)); }
    catch (error) { sentences.set(file, `NOT SAVED ${file.slug}${file.extension}: ${message(error)}.`); }
  };
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
      try { await targets.share(name, file); sentences.set(file, `Share sheet opened for ${name} (capture folder: ${reason}).`); }
      catch (error) { sentences.set(file, `NOT SAVED ${name}: ${message(error)}. A copy stays in app storage (captures/${name}).`); }
    }
  }
  let beta: string | undefined;
  if (upload) {
    try { beta = await upload(jsonl); }
    catch (error) { beta = `Not queued for beta upload: ${message(error)}.`; }
  }
  const status = [lead, ...files.map((file) => sentences.get(file)), beta].filter((sentence) => sentence !== undefined).join(" ");
  return report === undefined ? { status } : { report, status };
}
