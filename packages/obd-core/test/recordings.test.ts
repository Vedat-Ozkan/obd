import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ElmLineReader, parseElmResponse } from "../src/elm/reader.js";
import { latin1Encode, parseRecording } from "../src/recording/format.js";
import { ReplayTransport } from "../src/transport/replay.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function listJsonl(dir: string): string[] {
  const abs = join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".jsonl"))
    .map((p) => join(abs, p))
    .sort();
}

// Does a `timeout waiting for '>'` meta line sit between lines[from] and the next tx?
// (docs/specs/T0.2-hardware-spike.md `--timeout` behavior; the late '>' may then arrive after the next tx.)
function timedOut(lines: ReturnType<typeof parseRecording>, from: number): boolean {
  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.dir === "tx") return false;
    if (line.dir === "meta" && typeof line.note === "string" && line.note.startsWith("timeout waiting for '>'")) return true;
  }
  return false;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function replayTest(file: string): void {
  it(`replays ${relative(repoRoot, file)}`, async () => {
    const lines = parseRecording(readFileSync(file, "latin1"));
    const transport = new ReplayTransport(lines);
    const reader = new ElmLineReader();
    const completed: string[] = [];
    transport.onData((bytes) => completed.push(...reader.push(bytes)));
    for (const [i, line] of lines.entries()) {
      if (line.dir !== "tx") continue;
      completed.length = 0;
      await transport.write(latin1Encode(line.data));
      await flush();
      if (timedOut(lines, i)) continue;
      expect(completed.length, `no '>' after ${JSON.stringify(line.data)} (line ${String(i + 1)})`).toBeGreaterThan(0);
      const cmd = line.data.endsWith("\r") ? line.data.slice(0, -1) : line.data;
      for (const raw of completed) expect(parseElmResponse(raw, cmd).status.kind).toBeTypeOf("string");
    }
  });
}

describe("fixtures/synthetic", () => {
  for (const file of listJsonl("fixtures/synthetic")) replayTest(file);
});

describe("fixtures/recordings", () => {
  const files = listJsonl("fixtures/recordings");
  if (files.length === 0) {
    it.skip("NOT RUN: fixtures/recordings/ has no .jsonl files (T0.2 hardware half pending)", () => {});
  }
  for (const file of files) replayTest(file);
});
