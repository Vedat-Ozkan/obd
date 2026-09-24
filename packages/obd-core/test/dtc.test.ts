import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reassemble, type Frame } from "../src/elm/isotp.js";
import { parseElmResponse } from "../src/elm/reader.js";
import { decodeDtc, decodeDtcList, type DtcMode } from "../src/obd/dtc.js";
import { parseRecording } from "../src/recording/format.js";

// Spike cases read frames from the tracked redacted recordings by tx line number (X-2026-09-23-vin-redaction).
const equinox = "../../../fixtures/recordings/chevrolet-equinox-ev-2024/";

function load(name: string) {
  return parseRecording(readFileSync(fileURLToPath(new URL(equinox + name, import.meta.url)), "latin1"));
}

/** Reassembled frames of the response to the tx on 1-based line `txLine`. */
function framesAt(rec: ReturnType<typeof load>, txLine: number): Frame[] {
  const tx = rec[txLine - 1];
  if (tx.dir !== "tx") throw new Error(`line ${String(txLine)} is not tx`);
  let text = "";
  for (const line of rec.slice(txLine)) {
    if (line.dir === "tx") break;
    if (line.dir === "rx") text += line.data;
  }
  return reassemble(parseElmResponse(text.split(">")[0], tx.data.slice(0, -1)).lines).frames;
}

function frame(...bytes: number[]): Frame {
  return { header: "7E8", ecu: "7E8", data: Uint8Array.from(bytes) };
}

describe("decodeDtc", () => {
  it.each([
    [0x01, 0x33, "P0133"],
    [0xc1, 0x58, "U0158"], // Wiki §Service 03 example
    [0x92, 0x34, "B1234"],
    [0x42, 0x40, "C0240"],
    [0x3f, 0xff, "P3FFF"],
    [0xff, 0xff, "U3FFF"],
    [0x00, 0x00, "P0000"],
  ])("%i %i -> %s", (a, b, code) => {
    expect(decodeDtc(a, b)).toBe(code);
  });
});

describe("decodeDtcList on the spike recordings", () => {
  // tx lines 106/115/122 (03, 07, 0A) in both files.
  const lines: readonly [DtcMode, number][] = [
    [0x03, 106],
    [0x07, 115],
    [0x0a, 122],
  ];
  for (const name of ["2026-09-22-spike.redacted.jsonl", "2026-09-22-spike-2.redacted.jsonl"]) {
    const rec = load(name);
    it.each(lines)(`${name}: mode %i`, (mode, txLine) => {
      const out: Record<string, unknown> = {};
      for (const f of framesAt(rec, txLine)) {
        const r = decodeDtcList(mode, f);
        out[f.ecu] = r.ok ? r.dtcs : { reason: r.reason, code: r.code };
      }
      const negative = { reason: "negative", code: 0x11 };
      expect(out).toEqual(
        mode === 0x0a
          ? { "45": [], "40": [], "28": [], "17": negative, CB: negative }
          : { "45": [], "40": [], "28": [], "17": [], CB: [] },
      );
    });
  }
});

describe("decodeDtcList, synthetic", () => {
  it("decodes three DTCs", () => {
    expect(decodeDtcList(0x03, frame(0x43, 0x03, 0x01, 0x33, 0xc1, 0x58, 0x92, 0x34))).toEqual({
      ok: true,
      ecu: "7E8",
      mode: 0x03,
      dtcs: ["P0133", "U0158", "B1234"],
    });
  });

  it("skips a 00 00 padding pair", () => {
    const r = decodeDtcList(0x03, frame(0x43, 0x02, 0x01, 0x33, 0x00, 0x00));
    expect(r.ok && r.dtcs).toEqual(["P0133"]);
  });

  it.each([
    ["count 2 with one pair", 0x03, [0x43, 0x02, 0x01, 0x33], "length"],
    ["no count byte", 0x03, [0x43], "length"],
    ["47 00 as mode 03", 0x03, [0x47, 0x00], "echo"],
  ] as const)("%s -> %s", (_, mode, bytes, reason) => {
    const r = decodeDtcList(mode, frame(...bytes));
    expect(r.ok ? undefined : r.reason).toBe(reason);
  });
});
