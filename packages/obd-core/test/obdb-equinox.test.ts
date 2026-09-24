import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { replayRecording } from "../scripts/replay.js";
import type { Frame } from "../src/elm/isotp.js";
import { parseRecording } from "../src/recording/format.js";
import { decodeObdbMode22 } from "../src/vehicles/obdb/decode.js";
import { importObdbMode22 } from "../src/vehicles/obdb/import.js";

const root = new URL("../../../", import.meta.url);
const source = JSON.parse(readFileSync(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")) as unknown;
const signals = importObdbMode22(source);
const recording = (name: string) =>
  parseRecording(readFileSync(new URL(`fixtures/recordings/chevrolet-equinox-ev-2024/${name}`, root), "latin1"));

describe("OBDb Equinox recording replay", () => {
  for (const [name, voltages] of [
    ["2026-09-22-spike.redacted.jsonl", [3.9297, 3.9287, 3.9317]],
    ["2026-09-22-spike-2.redacted.jsonl", [3.9288, 3.9278, 3.9308]],
  ] as const) {
    it(`decodes answered Mode 22 signals in ${name}`, async () => {
      expect(signals).toHaveLength(6);
      expect(signals.every((signal) => signal.tier === "community")).toBe(true);
      const lines = recording(name);
      expect(lines[0]).toMatchObject({ dir: "meta", car: "chevrolet-equinox-ev-2024", note: "ready, park, dash SOC 70%, ambient 14 C" });
      const output = await replayRecording(lines, { signals });
      const text = output.join("\n");
      expect(text).toMatch(/22 33E5 -> nodata/);
      expect(text).not.toContain("EQUINOXEV_HVBAT_V ");
      for (const [id, value, unit, tier] of [
        ["EQUINOXEV_SOC_HD", 69.615, "percent", "verified"],
        ["EQUINOXEV_HVBAT_C_V_AVG", voltages[0], "volts", "community"],
        ["EQUINOXEV_HVBAT_C_V_MIN", voltages[1], "volts", "community"],
        ["EQUINOXEV_HVBAT_C_V_MAX", voltages[2], "volts", "community"],
        ["EQUINOXEV_SOC", 69.804, "percent", "verified"],
      ] as const) {
        const line = output.find((s) => s.includes(`decoded CB ${id} `));
        expect(line, id).toBeDefined();
        expect(line).toContain(`${unit} tier=${tier} ecu=CB`);
        const actual = Number(line?.split(`${id} `)[1]?.split(" ")[0]);
        expect(actual).toBeCloseTo(value, 3);
        if (tier === "verified") expect(Math.round(actual)).toBe(70);
      }
      expect(output.filter((s) => s.includes("tier=community"))).toHaveLength(3);
      expect(output.filter((s) => s.includes("tier=verified"))).toHaveLength(2);
    });
  }

  it("has no Mode 22 reading in the phone-console recording", async () => {
    const lines = recording("2026-09-24-phone-console.redacted.jsonl");
    expect(lines.some((line) => line.dir === "tx" && line.data.startsWith("22"))).toBe(false);
    const output = await replayRecording(lines, { signals });
    expect(output).toEqual(await replayRecording(lines));
    expect(output.some((line) => line.includes("tier="))).toBe(false);
  });
});

const valid = { commands: [{ hdr: "DACB", cmd: { "22": "2B43" }, signals: [{ id: "SOC", name: "SoC", fmt: { len: 8, div: 255, mul: 100, max: 100, unit: "percent" } }] }] };
const frame = (header: string, bytes: number[]): Frame => ({ header, ecu: header.slice(-2), data: Uint8Array.from(bytes) });

describe("bounded OBDb parser failures", () => {
  it.each([
    { hdr: "DACB", cmd: { "2E": "2B43" } },
    { hdr: "7E0", cmd: { "22": "2B43" } },
    { hdr: "DACB", cmd: { "22": "ZZZZ" } },
  ])("rejects unsupported command form %j", (bad) => {
    expect(() => importObdbMode22({ commands: [{ ...valid.commands[0], ...bad }] })).toThrow();
  });

  it("rejects invalid arithmetic, span, and scaled range", () => {
    for (const div of [0, Number.POSITIVE_INFINITY]) {
      expect(() => importObdbMode22({ commands: [{ ...valid.commands[0], signals: [{ ...valid.commands[0].signals[0], fmt: { len: 8, div, unit: "percent" } }] }] })).toThrow();
    }
    const tooLong = importObdbMode22({ commands: [{ ...valid.commands[0], signals: [{ id: "LONG", name: "Long", fmt: { len: 24, unit: "percent" } }] }] });
    expect(decodeObdbMode22("2B43", frame("18DAF1CB", [0x62, 0x2b, 0x43, 0xb2]), tooLong)).toMatchObject([{ ok: false, reason: "length" }]);
    const limited = importObdbMode22({ commands: [{ ...valid.commands[0], signals: [{ id: "LIMIT", name: "Limit", fmt: { len: 8, max: 50, unit: "percent" } }] }] });
    expect(decodeObdbMode22("2B43", frame("18DAF1CB", [0x62, 0x2b, 0x43, 0xb2]), limited)).toMatchObject([{ ok: false, reason: "format" }]);
  });

  it("rejects duplicate signal IDs", () => {
    const signal = valid.commands[0].signals[0];
    expect(() => importObdbMode22({ commands: [{ ...valid.commands[0], signals: [signal, signal] }] })).toThrow(/duplicate/i);
  });

  it("rejects wrong response module and DID echo", () => {
    const imported = importObdbMode22(valid);
    expect(decodeObdbMode22("2B43", frame("18DAF11D", [0x62, 0x2b, 0x43, 0xb2]), imported)).toMatchObject([{ ok: false, reason: "header" }]);
    expect(decodeObdbMode22("2B43", frame("18DAF1CB", [0x62, 0x2b, 0x44, 0xb2]), imported)).toMatchObject([{ ok: false, reason: "echo" }]);
  });
});
