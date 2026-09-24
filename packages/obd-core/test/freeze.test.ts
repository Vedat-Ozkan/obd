import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { replayRecording } from "../scripts/replay.js";
import type { Frame } from "../src/elm/isotp.js";
import { decodeFreezeDtc, decodeFreezePid } from "../src/obd/freeze.js";
import { parseRecording } from "../src/recording/format.js";

// Mode 02 freeze frame: docs/specs/T0.5-standard-decoding.md Stage C; failure list in docs/task-runs/T0.5.md.
const recording = parseRecording(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl",
        import.meta.url,
      ),
    ),
    "latin1",
  ),
);

/** Output lines of the block whose header starts with `L<line> `. */
function block(out: string[], line: number): string[] {
  const start = out.findIndex((l) => l.startsWith(`L${String(line)} `));
  const end = out.findIndex((l, i) => i > start && !l.startsWith("  "));
  return out.slice(start, end);
}

function frame(...bytes: number[]): Frame {
  return { header: "7E8", ecu: "7E8", data: Uint8Array.from(bytes) };
}

describe("replayRecording, 2026-09-24-phone-console.redacted.jsonl", () => {
  it("decodes module 17's freeze frame 0 replies", async () => {
    const out = await replayRecording(recording);
    // L38: 18DAF117 42 00 00 40 08 00 03
    expect(block(out, 38).filter((l) => l.startsWith("  decoded "))).toEqual([
      "  decoded 17 freeze 0 supported 02 0D 1F 20",
    ]);
    // L42: 18DAF117 42 02 00 00 00 (no snapshot stored)
    expect(block(out, 42).filter((l) => l.startsWith("  decoded "))).toEqual(["  decoded 17 freeze 0 dtc none"]);
  });
});

describe("freeze frame failure modes, synthetic", () => {
  it("1: a stored DTC is decoded", () => {
    const r = decodeFreezeDtc(0, frame(0x42, 0x02, 0x00, 0x01, 0x33));
    expect(r).toEqual({ ok: true, ecu: "7E8", frameNo: 0, dtc: "P0133" });
  });

  it("2: a MODE01_PIDS value skips the frame-number byte", () => {
    const r = decodeFreezePid(0x42, 0, frame(0x42, 0x42, 0x00, 0x30, 0xd4));
    expect(r.ok && [r.id, r.value, r.unit, r.frameNo]).toEqual(["VPWR", 12.5, "V", 0]);
  });

  it("3: wrong length -> length", () => {
    const r = decodeFreezeDtc(0, frame(0x42, 0x02, 0x00, 0x00));
    expect(r.ok ? undefined : r.reason).toBe("length");
  });

  it("4: wrong frame number -> echo", () => {
    const r = decodeFreezeDtc(0, frame(0x42, 0x02, 0x01, 0x00, 0x00));
    expect(r.ok ? undefined : r.reason).toBe("echo");
  });
});
