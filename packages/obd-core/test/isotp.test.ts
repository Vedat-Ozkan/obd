import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reassemble } from "../src/elm/isotp.js";
import { parseElmResponse } from "../src/elm/reader.js";
import { parseRecording } from "../src/recording/format.js";

// Spike cases read their lines from the tracked redacted recordings (by tx line number) instead of
// copying them inline, so no VIN bytes appear in this file.
const equinox = "../../../fixtures/recordings/chevrolet-equinox-ev-2024/";
const spike = load("2026-09-22-spike.redacted.jsonl");
const spike2 = load("2026-09-22-spike-2.redacted.jsonl");

function load(name: string) {
  return parseRecording(readFileSync(fileURLToPath(new URL(equinox + name, import.meta.url)), "latin1"));
}

/** Content lines of the response to the tx on 1-based line `txLine`. */
function responseLines(rec: ReturnType<typeof load>, txLine: number): string[] {
  const tx = rec[txLine - 1];
  if (tx.dir !== "tx") throw new Error(`line ${String(txLine)} is not tx`);
  let text = "";
  for (const line of rec.slice(txLine)) {
    if (line.dir === "tx") break;
    if (line.dir === "rx") text += line.data;
  }
  return parseElmResponse(text.split(">")[0], tx.data.slice(0, -1)).lines;
}

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
  // §Multi-frame responses (11-bit 7E8); body = Equinox ECU 45 0100 reply (spike line 32)
  it("1. 11-bit single frame", () => {
    const r = reassemble(["7E806410080000001"]);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0]).toEqual({ header: "7E8", ecu: "7E8", data: Uint8Array.from([0x41, 0x00, 0x80, 0x00, 0x00, 0x01]) });
    expect("negative" in r.frames[0]).toBe(false);
    expect(r.dropped).toEqual([]);
  });

  // spike lines 153-154 (22 27C6)
  it("2. 29-bit single frame", () => {
    const r = reassemble(["18DAF1CB056227C6B236"]);
    expect(r.frames).toEqual([{ header: "18DAF1CB", ecu: "CB", data: Uint8Array.from([0x62, 0x27, 0xc6, 0xb2, 0x36]) }]);
  });

  // spike lines 72-83: interleaved FF/CF from 17 and 28, length 0x14
  it("3. spike 0902: two interleaved 20-byte messages", () => {
    const lines = responseLines(spike, 72);
    expect(lines).toHaveLength(6);
    const r = reassemble(lines);
    expect(r.frames.map((f) => f.ecu)).toEqual(["17", "28"]);
    for (const f of r.frames) {
      expect(f.data).toHaveLength(20);
      expect(Array.from(f.data.slice(0, 3))).toEqual([0x49, 0x02, 0x01]);
    }
    expect(r.frames[0].data).toEqual(r.frames[1].data);
    expect(r.dropped).toEqual([]);
  });

  // spike lines 162-171: length 0x1D, 34 bytes received, padding trimmed
  it("4. spike 22 2B43: 29 bytes, padding dropped", () => {
    const r = reassemble(responseLines(spike, 162));
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0].ecu).toBe("CB");
    expect(r.frames[0].data).toHaveLength(29);
    expect(r.dropped).toEqual([]);
  });

  // spike lines 84-105, spike-2 lines 84-105: functional 090A cut by BUFFER FULL (line removed by T0.3)
  it.each([
    ["spike", spike, ["malformed 18D", "incomplete 18DAF117", "incomplete 18DAF140", "incomplete 18DAF128", "incomplete 18DAF1CB"]],
    ["spike-2", spike2, ["malformed 18D", "incomplete 18DAF1CB", "incomplete 18DAF140", "incomplete 18DAF128", "incomplete 18DAF117"]],
  ])("5. %s 090A: one complete message, the rest dropped", (_, rec, dropped) => {
    const lines = responseLines(rec, 84);
    expect(lines).not.toContain("BUFFER FULL");
    const r = reassemble(lines);
    expect(r.frames.map((f) => f.ecu)).toEqual(["45"]);
    expect(r.frames[0].data).toHaveLength(23);
    expect(r.dropped.map((d) => `${d.reason} ${d.header}`)).toEqual(dropped);
  });

  // spike line 107 (18DAF1CB23...), spike-2 line 107 (18DAF11723...): stray CF leaking into the 03 reply
  it.each([
    ["spike", spike, "18DAF1CB", ["45", "17", "40", "28", "CB"]],
    ["spike-2", spike2, "18DAF117", ["45", "40", "17", "28", "CB"]],
  ])("6. %s 03: stray consecutive frame dropped", (_, rec, strayHeader, ecus) => {
    const lines = responseLines(rec, 106);
    const r = reassemble(lines);
    expect(r.dropped).toEqual([{ header: strayHeader, reason: "no-first-frame", line: lines[0] }]);
    expect(r.frames.map((f) => f.ecu)).toEqual(ecus);
    for (const f of r.frames) expect(Array.from(f.data)).toEqual([0x43, 0x00]);
  });

  // spike lines 122-128: 03 7F 0A 11 from 17 and CB
  it("7. spike 0A: per-ECU negative responses", () => {
    const r = reassemble(responseLines(spike, 122));
    const negatives = Object.fromEntries(r.frames.map((f) => [f.ecu, f.negative]));
    expect(negatives).toEqual({
      "45": undefined,
      "17": { service: 0x0a, code: 0x11 },
      "40": undefined,
      "28": undefined,
      CB: { service: 0x0a, code: 0x11 },
    });
  });

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

  // spike line 21 (A0), line 23 (12.7V), line 8 (ELM327 v1.5); a 9-byte data line is not a CAN frame
  it("12. non-frame lines are text", () => {
    const lines = ["A0", "12.7V", "ELM327 v1.5", "7E8064100800000010203"];
    expect(summary(lines)).toEqual({ frames: [], dropped: [], text: lines });
  });

  // §Multi-frame responses example (ATS1 spacing)
  it("13. spaced and unspaced lines parse the same", () => {
    const spaced = reassemble(["7E8 10 14 49 02 01 31 43 34"]);
    const packed = reassemble(["7E81014490201314334"]);
    expect(spaced).toEqual({ ...packed, dropped: [{ ...packed.dropped[0], line: "7E8 10 14 49 02 01 31 43 34" }] });
    expect(spaced.dropped[0]).toMatchObject({ header: "7E8", reason: "incomplete" });
  });
});
