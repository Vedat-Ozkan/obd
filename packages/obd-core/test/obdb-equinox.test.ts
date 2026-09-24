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
      const output = await replayRecording(recording(name), { signals });
      const text = output.join("\n");
      expect(text).toMatch(/22 33E5 -> nodata/);
      expect(text).not.toContain("EQUINOXEV_HVBAT_V ");
      expect(text).not.toContain("tier=verified");
      for (const [id, value, unit] of [
        ["EQUINOXEV_SOC_HD", 69.615, "percent"],
        ["EQUINOXEV_HVBAT_C_V_AVG", voltages[0], "volts"],
        ["EQUINOXEV_HVBAT_C_V_MIN", voltages[1], "volts"],
        ["EQUINOXEV_HVBAT_C_V_MAX", voltages[2], "volts"],
        ["EQUINOXEV_SOC", 69.804, "percent"],
      ] as const) {
        const line = output.find((s) => s.includes(`decoded CB ${id} `));
        expect(line, id).toBeDefined();
        expect(line).toContain(`${unit} tier=community ecu=CB`);
        const actual = Number(line?.split(`${id} `)[1]?.split(" ")[0]);
        expect(actual).toBeCloseTo(value, 3);
      }
      expect(output.filter((s) => s.includes("tier=community"))).toHaveLength(5);
    });
  }

  it("preserves replay output for an unrelated synthetic recording", async () => {
    const lines = parseRecording(readFileSync(new URL("fixtures/synthetic/standard-decoding.jsonl", root), "latin1"));
    expect(await replayRecording(lines, { signals })).toEqual(await replayRecording(lines));
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
