import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRecording } from "../src/recording/format.js";
import { renderCodesReport } from "../src/report/render.js";
import { codesReportFromRecording } from "../src/report/replay.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export { codesReportFromRecording };

export async function renderRecordings(paths: readonly string[]): Promise<string> {
  const blocks: string[] = [];
  for (const path of paths) {
    const report = await codesReportFromRecording(parseRecording(readFileSync(resolve(repoRoot, path), "latin1")));
    blocks.push(`<!-- ${path} -->\n` + renderCodesReport(report));
  }
  return blocks.join("\n");
}

async function main(): Promise<number> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    process.stderr.write("usage: pnpm codes-report <recording.jsonl>...\n");
    return 2;
  }
  try {
    process.stdout.write(await renderRecordings(paths));
    return 0;
  } catch (e) {
    if (e instanceof Error) {
      process.stderr.write(`${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

const entry = process.argv.at(1);
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = await main();
}
