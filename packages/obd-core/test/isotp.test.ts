import { describe, expect, it } from "vitest";
import { reassemble } from "../src/elm/isotp.js";

const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
const summary = (lines: string[]) => {
  const r = reassemble(lines);
  return {
    frames: r.frames.map((f) => `${f.ecu}: ${hex(f.data)}`),
    dropped: r.dropped.map((d) => `${d.reason} ${d.header}`),
    text: r.text,
  };
};

describe("reassemble", () => {
  // Synthetic. §Multi-frame responses: sequence 0-F wrapping, 12-bit FF length
  it("8. sequence wraps F -> 0", () => {
    const seqs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1];
    const lines = ["7E8107D010203040506", ...seqs.map((s) => `7E82${s.toString(16).toUpperCase()}AAAAAAAAAAAAAA`)];
    const r = reassemble(lines);
    expect(r.dropped).toEqual([]);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0].data).toHaveLength(125);
    expect(Array.from(r.frames[0].data.slice(0, 7))).toEqual([1, 2, 3, 4, 5, 6, 0xaa]);
  });

  // Synthetic. §Multi-frame responses (CF sequence)
  it("9. wrong sequence drops the message; a later CF has no first frame", () => {
    const lines = ["7E81014490201314334", "7E82153594E54484554", "7E823494356494E3030", "7E822494356494E3030"];
    const r = reassemble(lines);
    expect(r.frames).toEqual([]);
    expect(r.dropped).toEqual([
      { header: "7E8", reason: "sequence", line: lines[0] },
      { header: "7E8", reason: "sequence", line: lines[2] },
      { header: "7E8", reason: "no-first-frame", line: lines[3] },
    ]);
  });

  // Synthetic. §Multi-frame responses (FF)
  it("10. a second first frame drops the message in progress as incomplete", () => {
    const lines = ["7E81014490201314334", "7E81014490201314334", "7E82153594E54484554", "7E822494356494E3030"];
    const r = reassemble(lines);
    expect(r.dropped).toEqual([{ header: "7E8", reason: "incomplete", line: lines[0] }]);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0].data).toHaveLength(20);
  });

  // Synthetic. §Multi-frame responses (PCI nibbles 0/1/2/3)
  it("11. malformed single frames, flow control, unknown PCI", () => {
    expect(summary(["7E800410080"]).dropped).toEqual(["malformed 7E8"]);
    expect(summary(["7E8074100"]).dropped).toEqual(["malformed 7E8"]);
    expect(summary(["7E830000000"]).dropped).toEqual(["flow-control 7E8"]);
    expect(summary(["7E840000000"]).dropped).toEqual(["malformed 7E8"]);
    expect(summary(["7E800410080"]).frames).toEqual([]);
  });

  // §Multi-frame responses example (ATS1 spacing)
  it("13. spaced and unspaced lines parse the same", () => {
    const spaced = reassemble(["7E8 10 14 49 02 01 31 43 34"]);
    const packed = reassemble(["7E81014490201314334"]);
    expect(spaced).toEqual({ ...packed, dropped: [{ ...packed.dropped[0], line: "7E8 10 14 49 02 01 31 43 34" }] });
    expect(spaced.dropped[0]).toMatchObject({ header: "7E8", reason: "incomplete" });
  });
});
