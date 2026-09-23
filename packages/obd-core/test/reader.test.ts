import { describe, expect, it } from "vitest";
import { latin1Encode } from "../src/recording/format.js";
import { ElmLineReader, parseElmResponse } from "../src/elm/reader.js";

// Every byte string below is taken from docs/ELM327.md; the section is cited per test.
// Each case also asserts `raw` is the untouched input (Verification item 21).
function parse(raw: string, cmd?: string) {
  const r = parseElmResponse(raw, cmd);
  expect(r.raw).toBe(raw);
  return r;
}

describe("parseElmResponse", () => {
  // §Responses row 1 (SEARCHING... then data), §Multi-frame responses (the data line)
  it("1. SEARCHING... followed by a data line", () => {
    const r = parse("SEARCHING...\r7E8 10 14 49 02 01 31 43 34\r\r");
    expect(r.status).toEqual({ kind: "data" });
    expect(r.searching).toBe(true);
    expect(r.lines).toEqual(["7E8 10 14 49 02 01 31 43 34"]);
  });

  // §Responses rows 1 and 3
  it("2. SEARCHING... followed by UNABLE TO CONNECT", () => {
    const r = parse("SEARCHING...\rUNABLE TO CONNECT\r\r");
    expect(r.status).toEqual({ kind: "error", error: { kind: "unable-to-connect", line: "UNABLE TO CONNECT" } });
    expect(r.searching).toBe(true);
    expect(r.lines).toEqual([]);
  });

  // §Responses row 2
  it("3. NO DATA", () => {
    const r = parse("NO DATA\r\r");
    expect(r.status).toEqual({ kind: "nodata" });
    expect(r.lines).toEqual([]);
  });

  // §Responses row 3
  it("4. UNABLE TO CONNECT", () => {
    expect(parse("UNABLE TO CONNECT\r\r").status).toEqual({
      kind: "error",
      error: { kind: "unable-to-connect", line: "UNABLE TO CONNECT" },
    });
  });

  // §Responses row 4
  it("5. CAN ERROR", () => {
    expect(parse("CAN ERROR\r\r").status).toEqual({ kind: "error", error: { kind: "can-error", line: "CAN ERROR" } });
  });

  // §Responses row 5
  it("6. BUS INIT: ...ERROR", () => {
    expect(parse("BUS INIT: ...ERROR\r\r").status).toEqual({
      kind: "error",
      error: { kind: "bus-init-error", line: "BUS INIT: ...ERROR" },
    });
  });

  // §Responses row 6 (response truncated; partial data precedes it), §Multi-frame responses
  it("7. BUFFER FULL keeps the partial data line", () => {
    const r = parse("7E8 10 14 49 02 01 31 43 34\rBUFFER FULL\r\r");
    expect(r.status).toEqual({ kind: "error", error: { kind: "buffer-full", line: "BUFFER FULL" } });
    expect(r.lines).toEqual(["7E8 10 14 49 02 01 31 43 34"]);
  });

  // §Responses row 7
  it("8. STOPPED", () => {
    expect(parse("STOPPED\r\r").status).toEqual({ kind: "error", error: { kind: "stopped", line: "STOPPED" } });
  });

  // §Responses row 8
  it("9. ? (unrecognized AT command)", () => {
    expect(parse("?\r\r").status).toEqual({ kind: "error", error: { kind: "unknown-command", line: "?" } });
  });

  // §Responses row 9
  it("10. LV RESET", () => {
    expect(parse("LV RESET\r\r").status).toEqual({ kind: "error", error: { kind: "lv-reset", line: "LV RESET" } });
  });

  // §Responses row 10
  it("11. DATA ERROR and <DATA ERROR", () => {
    expect(parse("DATA ERROR\r\r").status).toEqual({ kind: "error", error: { kind: "data-error", line: "DATA ERROR" } });
    expect(parse("<DATA ERROR\r\r").status).toEqual({ kind: "error", error: { kind: "data-error", line: "<DATA ERROR" } });
  });

  // §Responses row 11 (`ERR94` etc.; ERR + two digits per spec Risks)
  it("12. ERR94 is err-code; ERRX is data", () => {
    expect(parse("ERR94\r\r").status).toEqual({ kind: "error", error: { kind: "err-code", line: "ERR94" } });
    const r = parse("ERRX\r\r");
    expect(r.status).toEqual({ kind: "data" });
    expect(r.lines).toEqual(["ERRX"]);
  });

  // §Responses row 12
  it("13. OK", () => {
    const r = parse("OK\r\r");
    expect(r.status).toEqual({ kind: "ok" });
    expect(r.lines).toEqual([]);
  });

  // §Framing (echo unless ATE0), §Init sequence (ATZ prints "ELM327 v1.5")
  it("14. echo on: the leading line equal to cmd is dropped", () => {
    const withCmd = parse("ATZ\r\r\rELM327 v1.5\r\r", "ATZ");
    expect(withCmd.status).toEqual({ kind: "data" });
    expect(withCmd.lines).toEqual(["ELM327 v1.5"]);
    expect(parse("ATZ\r\r\rELM327 v1.5\r\r").lines).toEqual(["ATZ", "ELM327 v1.5"]);
  });

  // §Framing (lines end with \r\n under ATL1)
  it("15. ATL1 endings", () => {
    const r = parse("OK\r\n\r\n");
    expect(r.status).toEqual({ kind: "ok" });
    expect(r.lines).toEqual([]);
  });
});

describe("ElmLineReader", () => {
  // §Framing (a response is complete when '>' arrives)
  it("16. prompt only yields an empty data response", () => {
    const reader = new ElmLineReader();
    const raws = reader.push(latin1Encode("\r>"));
    expect(raws).toEqual(["\r"]);
    const r = parseElmResponse(raws[0]);
    expect(r.status).toEqual({ kind: "data" });
    expect(r.lines).toEqual([]);
  });

  // §Framing ("any number of chunks"; never parse on newline alone)
  it("17. chunking: a status token split mid-word completes only at '>'", () => {
    const reader = new ElmLineReader();
    expect(reader.push(latin1Encode("SEARCH"))).toEqual([]);
    expect(reader.push(latin1Encode("ING...\rNO DATA\r"))).toEqual([]);
    const raws = reader.push(latin1Encode("\r>"));
    expect(raws).toEqual(["SEARCHING...\rNO DATA\r\r"]);
    const r = parseElmResponse(raws[0]);
    expect(r.status).toEqual({ kind: "nodata" });
    expect(r.searching).toBe(true);
  });

  // §Framing
  it("18. two prompts in one chunk; trailing text stays buffered", () => {
    const reader = new ElmLineReader();
    const raws = reader.push(latin1Encode("OK\r\r>NO DATA\r\r>ELM"));
    expect(raws).toEqual(["OK\r\r", "NO DATA\r\r"]);
    expect(parseElmResponse(raws[0]).status).toEqual({ kind: "ok" });
    expect(parseElmResponse(raws[1]).status).toEqual({ kind: "nodata" });
    expect(reader.push(latin1Encode("327 v1.5\r\r>"))).toEqual(["ELM327 v1.5\r\r"]);
  });

  it("19. reset() discards the buffered partial", () => {
    const reader = new ElmLineReader();
    expect(reader.push(latin1Encode("SEARCH"))).toEqual([]);
    reader.reset();
    expect(reader.push(latin1Encode("OK\r\r>"))).toEqual(["OK\r\r"]);
  });

  // §Clone quirks (garbage bytes after ATZ); latin1 decoding is exact
  it("20. garbage bytes >= 0x80 survive as a data response", () => {
    const reader = new ElmLineReader();
    const raws = reader.push(Uint8Array.from([0xff, 0xfe, 0x00, 0x0d, 0x3e]));
    expect(raws).toHaveLength(1);
    expect(raws[0]).toHaveLength(4);
    expect(raws[0]).toContain("ÿ");
    expect(raws[0]).toBe("ÿþ\u0000\r");
    expect(parseElmResponse(raws[0]).status).toEqual({ kind: "data" });
  });
});
