import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reassemble, type Frame } from "../src/elm/isotp.js";
import { parseElmResponse } from "../src/elm/reader.js";
import { decodeCalIds, decodeEcuName, decodeVin, vinCheckDigit } from "../src/obd/vin.js";
import { latin1Encode, parseRecording } from "../src/recording/format.js";

// VIN privacy (ADR-014, ADR-017): only synthetic VINs appear as literals here (the 49 CFR 565.15 Table VI sample,
// variants of it, and fixtures/synthetic/session-branches.jsonl's 1C4SYNTHETICVIN00). Recorded VINs: structure only.
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

const ascii = (s: string) => Array.from(latin1Encode(s));
const vinFrame = (vin: string, count = 1) => frame(0x49, 0x02, count, ...ascii(vin));
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? undefined : r.reason);

const CFR_SAMPLE = "1G4AH59H45G118341"; // 49 CFR 565.15(c) Table VI

describe("vinCheckDigit and decodeVin, synthetic", () => {
  it("CFR sample: check digit 4, decodes valid", () => {
    expect(vinCheckDigit(CFR_SAMPLE)).toBe("4");
    expect(decodeVin(vinFrame(CFR_SAMPLE))).toEqual({ ok: true, ecu: "7E8", vin: CFR_SAMPLE, status: "valid" });
  });

  it("position 9 changed -> check-digit-mismatch", () => {
    const r = decodeVin(vinFrame("1G4AH59H55G118341"));
    expect(r.ok && r.status).toBe("check-digit-mismatch");
  });

  it("remainder 10 -> X", () => {
    expect(vinCheckDigit("1G4AH59HX5G118344")).toBe("X");
    const r = decodeVin(vinFrame("1G4AH59HX5G118344"));
    expect(r.ok && r.status).toBe("valid");
  });

  it("serial 000000 -> masked", () => {
    const r = decodeVin(vinFrame("1G4AH59H45G000000"));
    expect(r.ok && r.status).toBe("masked");
  });

  it.each([
    ["contains I", vinFrame("1C4SYNTHETICVIN00"), "format"],
    ["lowercase", vinFrame("1G4AH59H45g118341"), "format"],
    ["count byte 02", vinFrame(CFR_SAMPLE, 2), "format"],
    ["19-byte payload", frame(0x49, 0x02, 0x01, ...ascii(CFR_SAMPLE.slice(0, 16))), "length"],
  ])("%s -> %s", (_, f, expected) => {
    expect(reason(decodeVin(f))).toBe(expected);
  });

  it("16 characters -> undefined", () => {
    expect(vinCheckDigit("1G4AH59H45G11834")).toBeUndefined();
  });
});

describe("decodeVin on the spike recordings", () => {
  // tx line 72 (0902) in both files.
  it.each(["2026-09-22-spike.redacted.jsonl", "2026-09-22-spike-2.redacted.jsonl"])("%s", (name) => {
    const results = framesAt(load(name), 72).map(decodeVin);
    expect(results.map((r) => r.ecu)).toEqual(["17", "28"]);
    const vins: string[] = [];
    for (const r of results) {
      if (!r.ok) throw new Error(`ECU ${r.ecu}: ${r.reason}`);
      expect(r.status).toBe("masked");
      expect(r.vin).toHaveLength(17);
      expect(r.vin.slice(11)).toBe("000000");
      vins.push(r.vin);
    }
    expect(vins[0] === vins[1]).toBe(true);
  });
});

describe("decodeEcuName", () => {
  const name20 = (s: string) => [...ascii(s), ...Array<number>(20 - s.length).fill(0)];

  it("spike 090A from module 45", () => {
    // tx line 84 (090A) in the spike file; the response ends BUFFER FULL but module 45's message is complete.
    const f = framesAt(load("2026-09-22-spike.redacted.jsonl"), 84).find((x) => x.ecu === "45");
    expect(f && decodeEcuName(f)).toEqual({ ok: true, ecu: "45", name: "GWM-Gateway" });
  });

  it.each([
    ["count 02", frame(0x49, 0x0a, 0x02, ...name20("SYNTH-ECU")), "format"],
    ["22 bytes", frame(0x49, 0x0a, 0x01, ...name20("SYNTH-ECU").slice(0, 19)), "length"],
    ["0x07 inside the name", frame(0x49, 0x0a, 0x01, ...name20("SYNTH\x07ECU")), "format"],
  ])("%s -> %s", (_, f, expected) => {
    expect(reason(decodeEcuName(f))).toBe(expected);
  });
});

describe("decodeCalIds", () => {
  const block = (s: string) => [...ascii(s), ...Array<number>(16 - s.length).fill(0)];

  it("two NUL-padded IDs", () => {
    const r = decodeCalIds(frame(0x49, 0x04, 0x02, ...block("SYNTHCAL0001"), ...block("SYNTHCAL0002")));
    expect(r).toEqual({ ok: true, ecu: "7E8", calIds: ["SYNTHCAL0001", "SYNTHCAL0002"] });
  });

  it("count 0 -> []", () => {
    const r = decodeCalIds(frame(0x49, 0x04, 0x00));
    expect(r.ok && r.calIds).toEqual([]);
  });

  it.each([
    ["count 2 with one block", frame(0x49, 0x04, 0x02, ...block("SYNTHCAL0001")), "length"],
    ["0x01 in a block", frame(0x49, 0x04, 0x01, ...block("SYNTH\x01CAL")), "format"],
  ])("%s -> %s", (_, f, expected) => {
    expect(reason(decodeCalIds(f))).toBe(expected);
  });
});
