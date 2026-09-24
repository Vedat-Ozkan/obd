import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ElmLineReader, parseElmResponse } from "../src/elm/reader.js";
import type { RecordingLine } from "../src/recording/format.js";
import { latin1Encode, parseRecording } from "../src/recording/format.js";
import { ReplayTransport } from "../src/transport/replay.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function listJsonl(dir: string, suffix = ".jsonl"): string[] {
  const abs = join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(suffix))
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

// Known recorder defect, keyed by file SHA-256 -> 1-based tx line whose '>' was recorded on the line just
// before it (discover.py wrote tx after the BLE write returned; fixed in T2.3b). Only this line of this exact file.
const EARLY_PROMPT: Readonly<Record<string, number>> = {
  "520fc8fba7dd2453474a8471c22dd50dfb946c360cbde46d5d3f1a648e92cc53": 49776, // chevrolet-equinox-ev-2024/2026-09-23-discovery.jsonl
};

async function replay(lines: RecordingLine[], earlyPrompt?: number): Promise<void> {
  const transport = new ReplayTransport(lines);
  const reader = new ElmLineReader();
  const completed: string[] = [];
  let reached = false;
  transport.onData((bytes) => completed.push(...reader.push(bytes)));
  for (const [i, line] of lines.entries()) {
    if (line.dir !== "tx") continue;
    completed.length = 0;
    await transport.write(latin1Encode(line.data));
    await flush();
    if (i + 1 === earlyPrompt) {
      const before = i > 0 ? lines[i - 1] : undefined;
      expect(before?.dir === "rx" && before.data.includes(">"), `line ${String(i)} is not an rx with '>'`).toBe(true);
      expect(completed.length).toBe(0);
      reached = true;
      continue;
    }
    if (timedOut(lines, i)) continue;
    expect(completed.length, `no '>' after ${JSON.stringify(line.data)} (line ${String(i + 1)})`).toBeGreaterThan(0);
    const cmd = line.data.endsWith("\r") ? line.data.slice(0, -1) : line.data;
    for (const raw of completed) expect(parseElmResponse(raw, cmd).status.kind).toBeTypeOf("string");
  }
  if (earlyPrompt !== undefined) expect(reached, `early-prompt tx line ${String(earlyPrompt)} not reached`).toBe(true);
}

function replayTest(file: string): void {
  // Timeout: discovery recordings hold ~18k tx lines at ~1.15 ms per tx, well above vitest's 5 s default.
  it(`replays ${relative(repoRoot, file)}`, async () => {
    const bytes = readFileSync(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    await replay(parseRecording(bytes.toString("latin1")), EARLY_PROMPT[hash]);
  }, 120_000);
}

describe("fixtures/synthetic", () => {
  for (const file of listJsonl("fixtures/synthetic")) replayTest(file);
});

describe("fixtures/recordings", () => {
  const files = listJsonl("fixtures/recordings", ".redacted.jsonl");
  it("has committed redacted recordings", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) replayTest(file);
});

describe("replay early-prompt exemption (in-memory, synthetic)", () => {
  // tx 4 (ATRV) has its reply recorded on line 3, before the tx: the T2.3b recorder defect.
  const defect: RecordingLine[] = [
    { t: 0, dir: "tx", data: "ATE0\r" },
    { t: 0.01, dir: "rx", data: "OK\r\r>" },
    { t: 0.02, dir: "rx", data: "13.6V\r\r>" },
    { t: 0.02, dir: "tx", data: "ATRV\r" },
    { t: 0.03, dir: "tx", data: "ATH1\r" },
    { t: 0.04, dir: "rx", data: "OK\r\r>" },
  ];
  const correct: RecordingLine[] = [defect[0], defect[1], defect[3], defect[2], defect[4], defect[5]];

  it("fails without the exemption", async () => {
    await expect(replay(defect)).rejects.toThrow(`no '>' after "ATRV\\r" (line 4)`);
  });
  it("passes with the exemption at that line", async () => {
    await replay(defect, 4);
  });
  it("fails at a line without the defect's shape, and when the exempt line is never reached", async () => {
    await expect(replay(defect, 1)).rejects.toThrow("line 0 is not an rx with '>'");
    await replay(correct);
    await expect(replay(correct, 99)).rejects.toThrow("early-prompt tx line 99 not reached");
  });
});
