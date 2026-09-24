import { describe, expect, it } from "vitest";
import type { Frame } from "../src/elm/isotp.js";
import { decodeDtc, decodeDtcList } from "../src/obd/dtc.js";

function frame(...bytes: number[]): Frame {
  return { header: "7E8", ecu: "7E8", data: Uint8Array.from(bytes) };
}

describe("decodeDtc", () => {
  it.each([
    [0x3f, 0xff, "P3FFF"],
    [0xff, 0xff, "U3FFF"],
    [0x00, 0x00, "P0000"],
  ])("%i %i -> %s", (a, b, code) => {
    expect(decodeDtc(a, b)).toBe(code);
  });
});

describe("decodeDtcList, synthetic", () => {
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
