import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replayRecording } from "../scripts/replay.js";
import { latin1Decode, latin1Encode, parseRecording } from "../src/recording/format.js";

// `decoded` lines of pnpm replay: docs/specs/T0.5-standard-decoding.md "scripts/replay.ts".
function load(rel: string) {
  return parseRecording(readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "latin1"));
}

const equinox = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const spike = load(`${equinox}2026-09-22-spike.redacted.jsonl`);
const spike2 = load(`${equinox}2026-09-22-spike-2.redacted.jsonl`);
const standard = load("fixtures/synthetic/standard-decoding.jsonl");
const branches = load("fixtures/synthetic/session-branches.jsonl");

/** Output lines of the block whose header starts with `L<line> `. */
function block(out: string[], line: number): string[] {
  const start = out.findIndex((l) => l.startsWith(`L${String(line)} `));
  const end = out.findIndex((l, i) => i > start && !l.startsWith("  "));
  return out.slice(start, end);
}

const decoded = (lines: string[]) => lines.filter((l) => l.startsWith("  decoded "));

// T0.4 expectNoVin approach (test/session.test.ts): no 4-byte run of a synthetic VIN, in ASCII, packed or spaced hex.
function expectNoVin(out: string[], vin: string): void {
  const bytes = Array.from(latin1Encode(vin));
  const hex = (run: number[]) => run.map((b) => b.toString(16).padStart(2, "0").toUpperCase());
  const joined = out.join("\n");
  for (let i = 0; i + 4 <= bytes.length; i++) {
    const run = bytes.slice(i, i + 4);
    expect(joined).not.toContain(hex(run).join(" "));
    expect(joined).not.toContain(hex(run).join(""));
    expect(joined).not.toContain(latin1Decode(Uint8Array.from(run)));
  }
}

describe("replayRecording decoded lines, spike", () => {
  it("decodes what the Equinox answered", async () => {
    const out = await replayRecording(spike);
    expect(out).toContain("  decoded 17 supported 01 0D 1C 1F 20");
    expect(out).toContain("  decoded 28 supported 21 2C 2D 2E 2F 30 31 32 33 3C 3D 40");
    const readiness = "readiness pid=01 mil=off dtcs=0 ignition=spark components=complete";
    expect(decoded(block(out, 62)).filter((l) => l.endsWith(` ${readiness}`))).toHaveLength(5);
    expect(block(out, 62)).toContain(`  decoded 45 ${readiness}`);
    expect(out).toContain("  decoded 17 vin status=masked");
    expect(out).toContain("  decoded 28 vin status=masked");
    expect(out).toContain("  decoded 45 ecu-name GWM-Gateway");
    expect(block(out, 106)).toContain("  decoded CB dtcs none");
    expect(block(out, 122)).toContain("  decoded 17 negative code=11");
    const mode22 = out.filter((l) => /^L\d+ 22 /.test(l)).map((l) => Number(/^L(\d+)/.exec(l)?.[1]));
    expect(mode22).toHaveLength(4);
    for (const line of mode22) expect(decoded(block(out, line))).toEqual([]);
    expect(out.at(-1)).toMatch(/^summary: /);
  });

  it("spike-2 has the same decoded lines for 0101 and 0902", async () => {
    const [a, b] = await Promise.all([replayRecording(spike), replayRecording(spike2)]);
    for (const line of [62, 72]) {
      const lines = decoded(block(a, line));
      expect(lines.length).toBeGreaterThan(0);
      expect(decoded(block(b, line)).sort()).toEqual(lines.sort());
    }
  });
});

describe("replayRecording decoded lines, synthetic", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fixtures/synthetic/standard-decoding.jsonl", async () => {
    const out = await replayRecording(standard);
    for (const line of [
      "  decoded 7E8 readiness pid=01 mil=on dtcs=3 ignition=spark misfire=complete fuel=incomplete components=complete catalyst=complete evap=incomplete o2Sensor=complete o2Heater=complete",
      "  decoded 7E9 readiness pid=01 mil=off dtcs=0 ignition=compression noxScr=complete boostPressure=complete egrVvt=incomplete",
      "  decoded 7E8 OBDSUP 1 (OBD II)",
      "  decoded 7E8 CLR_DIST 1000 km",
      "  decoded 7E8 BAT_SOC 69.804 percent",
      "  decoded 7E8 ODO 10000 km",
      "  decoded 7E8 invalid echo",
      "  decoded 7E8 dtcs P0133 U0158 B1234",
      "  decoded 7E8 dtcs C0240",
      "  decoded 7E9 negative code=11",
      "  decoded 7E8 vin status=valid",
      "  decoded 7E8 cal-ids SYNTHCAL0001 SYNTHCAL0002",
    ]) {
      expect(out).toContain(line);
    }
    expectNoVin(out, "1G4AH59H45G118341"); // 49 CFR 565.15 Table VI sample, the fixture's VIN
  });

  it("fixtures/synthetic/session-branches.jsonl", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = replayRecording(branches);
    await vi.advanceTimersByTimeAsync(2000);
    const out = await pending;
    expect(out).toContain("  decoded 7E8 vin invalid format");
    expect(out).toContain("  decoded 7E8 supported 01 20");
    expectNoVin(out, "1C4SYNTHETICVIN00");
  });
});
