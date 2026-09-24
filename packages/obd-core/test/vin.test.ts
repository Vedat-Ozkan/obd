import { describe, expect, it } from "vitest";
import type { Frame } from "../src/elm/isotp.js";
import { decodeCalIds, decodeEcuName, decodeVin, vinCheckDigit } from "../src/obd/vin.js";
import { latin1Encode } from "../src/recording/format.js";

// VIN privacy (ADR-014, ADR-017): only synthetic VINs appear as literals here (the 49 CFR 565.15 Table VI sample,
// and variants of it).
function frame(...bytes: number[]): Frame {
  return { header: "7E8", ecu: "7E8", data: Uint8Array.from(bytes) };
}

const ascii = (s: string) => Array.from(latin1Encode(s));
const vinFrame = (vin: string, count = 1) => frame(0x49, 0x02, count, ...ascii(vin));
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? undefined : r.reason);

const CFR_SAMPLE = "1G4AH59H45G118341"; // 49 CFR 565.15(c) Table VI

describe("vinCheckDigit and decodeVin, synthetic", () => {
  it("position 9 changed -> check-digit-mismatch", () => {
    const r = decodeVin(vinFrame("1G4AH59H55G118341"));
    expect(r.ok && r.status).toBe("check-digit-mismatch");
  });

  it("remainder 10 -> X", () => {
    expect(vinCheckDigit("1G4AH59HX5G118344")).toBe("X");
    const r = decodeVin(vinFrame("1G4AH59HX5G118344"));
    expect(r.ok && r.status).toBe("valid");
  });

  it.each([
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

describe("decodeEcuName", () => {
  const name20 = (s: string) => [...ascii(s), ...Array<number>(20 - s.length).fill(0)];

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
