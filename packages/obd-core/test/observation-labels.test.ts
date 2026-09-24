import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { replayRecording } from "../scripts/replay.js";
import { parseRecording } from "../src/recording/format.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const real = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const pairs = [
  [`${real}2026-09-22-spike.redacted.jsonl`, `${real}2026-09-22-spike.replay-label.json`],
  [`${real}2026-09-22-spike-2.redacted.jsonl`, `${real}2026-09-22-spike-2.replay-label.json`],
  [`${real}2026-09-24-phone-console.redacted.jsonl`, `${real}2026-09-24-phone-console.replay-label.json`],
  ["fixtures/synthetic/elm-framing.jsonl", "fixtures/synthetic/elm-framing.replay-label.json"],
  ["fixtures/synthetic/session-branches.jsonl", "fixtures/synthetic/session-branches.replay-label.json"],
  ["fixtures/synthetic/standard-decoding.jsonl", "fixtures/synthetic/standard-decoding.replay-label.json"],
  ["fixtures/synthetic/codes-cleared.jsonl", "fixtures/synthetic/codes-cleared.replay-label.json"],
  ["fixtures/synthetic/codes-permanent.jsonl", "fixtures/synthetic/codes-permanent.replay-label.json"],
  ["fixtures/synthetic/codes-stored.jsonl", "fixtures/synthetic/codes-stored.replay-label.json"],
  ["fixtures/synthetic/codes-conflict.jsonl", "fixtures/synthetic/codes-conflict.replay-label.json"],
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

describe("protocol replay observation labels", () => {
  it("has exactly the ten companion labels", () => {
    const found = [real, "fixtures/synthetic/"].flatMap((dir) =>
      readdirSync(join(root, dir))
        .filter((name) => name.endsWith(".replay-label.json"))
        .map((name) => `${dir}${name}`),
    );
    expect(found.sort()).toEqual(pairs.map(([, label]) => label).sort());
  });

  for (const [recordingPath, labelPath] of pairs) {
    it(`replays ${recordingPath} against its observation label`, async () => {
      const bytes = readFileSync(join(root, recordingPath));
      const lines = parseRecording(bytes.toString("latin1"));
      const label: unknown = JSON.parse(readFileSync(join(root, labelPath), "utf8"));
      expect(isObject(label)).toBe(true);
      if (!isObject(label)) return;
      expect(Object.keys(label).sort()).toEqual(["kind", "recording", "recording_sha256", "synthetic", "observations", "summary", "notes"].sort());
      expect(label.kind).toBe("protocol-replay");
      expect(label.recording).toBe(recordingPath);
      expect(label.recording_sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(typeof label.synthetic).toBe("boolean");
      expect(label.synthetic).toBe(recordingPath.startsWith("fixtures/synthetic/"));
      expect(lines[0]?.dir).toBe("meta");
      if (lines[0]?.dir === "meta") expect(label.synthetic).toBe(lines[0].synthetic === true);
      expect(typeof label.notes).toBe("string");
      expect(typeof label.summary).toBe("string");
      expect(Array.isArray(label.observations)).toBe(true);
      if (!Array.isArray(label.observations)) return;
      expect(label.observations.length).toBeGreaterThan(0);

      const out = await replayRecording(lines);
      expect(out.at(-1) === label.summary, `${labelPath}: replay summary mismatch`).toBe(true);
      for (const [index, observation] of label.observations.entries()) {
        expect(isObject(observation), `${labelPath}: observation ${String(index)} has wrong type`).toBe(true);
        if (!isObject(observation)) continue;
        expect(Object.keys(observation).sort()).toEqual(["tx_line", "command", "outcome", "decoded"].sort());
        expect(Number.isInteger(observation.tx_line) && Number(observation.tx_line) > 0).toBe(true);
        expect(typeof observation.command).toBe("string");
        expect(typeof observation.outcome).toBe("string");
        expect(Array.isArray(observation.decoded)).toBe(true);
        if (typeof observation.tx_line !== "number" || typeof observation.command !== "string" || typeof observation.outcome !== "string" || !Array.isArray(observation.decoded)) continue;
        const tx = lines.at(observation.tx_line - 1);
        expect(tx?.dir === "tx", `${labelPath}: observation ${String(index)} has no recorded tx`).toBe(true);
        if (tx === undefined || tx.dir !== "tx") continue;
        expect(tx.data.endsWith("\r") && tx.data.slice(0, -1) === observation.command, `${labelPath}: command does not match tx`).toBe(true);
        const heading = `L${String(observation.tx_line)} ${observation.command} -> ${observation.outcome}`;
        const start = out.indexOf(heading);
        expect(start >= 0, `${labelPath}: observation ${String(index)} heading mismatch`).toBe(true);
        if (start < 0) continue;
        const end = out.findIndex((line, i) => i > start && !line.startsWith("  "));
        const block = out.slice(start + 1, end < 0 ? undefined : end);
        for (const decoded of observation.decoded) {
          expect(typeof decoded === "string" && decoded.startsWith("  decoded ")).toBe(true);
          if (typeof decoded !== "string") continue;
          expect(block.includes(decoded), `${labelPath}: observation ${String(index)} decoded line mismatch`).toBe(true);
        }
      }
    }, 30_000);
  }
});
