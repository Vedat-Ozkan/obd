// `node --import tsx packages/obd-core/scripts/codes-report.ts <recording…>`: Node-only CLI, kept outside src/ so
// obd-core/src stays pure. Contract: docs/specs/T0.7-codes-report.md "Stage B2: scripts/codes-report.ts".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ElmSessionError, Elm327Session } from "../src/elm/session.js";
import { parseRecording, type RecordingLine } from "../src/recording/format.js";
import { buildCodesReport, type CodesExchange, type CodesReport } from "../src/report/codes.js";
import { renderCodesReport } from "../src/report/render.js";
import { ReplayTransport } from "../src/transport/replay.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Replays every tx through Elm327Session.send (retry false, timeoutMs 500; a timeout adds no exchange) and builds the report. */
export async function codesReportFromRecording(lines: readonly RecordingLine[]): Promise<CodesReport> {
  const session = new Elm327Session(new ReplayTransport(lines));
  const exchanges: CodesExchange[] = [];
  for (const line of lines) {
    if (line.dir !== "tx") continue;
    const command = line.data.endsWith("\r") ? line.data.slice(0, -1) : line.data;
    try {
      exchanges.push({ command, response: await session.send(command, { retry: false, timeoutMs: 500 }) });
    } catch (e) {
      if (!(e instanceof ElmSessionError && e.kind === "timeout")) throw e;
    }
  }
  await session.close();
  return buildCodesReport(exchanges);
}

/** For each repo-relative path: "<!-- <path> -->\n" + renderCodesReport(report), blocks joined by "\n". Used by the CLI and the test. */
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
    // Parse errors and ReplayMismatchError both land here.
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
