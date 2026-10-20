import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SCRUB_RULES, scrubRecording } from "../src/recording/scrub.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const lineCount = (text: string) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

export function summarize(paths: readonly string[]): string {
  const rows = [
    `| file | lines in | lines out | ${SCRUB_RULES.join(" | ")} |`,
    `|---|---|---|${SCRUB_RULES.map(() => "---|").join("")}`,
  ];
  for (const path of paths) {
    const text = readFileSync(resolve(repoRoot, path), "utf8");
    const { text: out, report } = scrubRecording(text);
    const counts = SCRUB_RULES.map((r) => String(report.masked[r])).join(" | ");
    rows.push(`| \`${path}\` | ${String(lineCount(text))} | ${String(lineCount(out))} | ${counts} |`);
  }
  return rows.join("\n") + "\n";
}

function main(): number {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    process.stderr.write("usage: pnpm exec tsx packages/obd-core/scripts/beta-scrub.ts <recording.jsonl>...\n");
    return 2;
  }
  try {
    process.stdout.write(summarize(paths));
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
  process.exitCode = main();
}
