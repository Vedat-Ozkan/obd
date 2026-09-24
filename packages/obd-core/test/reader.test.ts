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
  // §Responses rows 1 and 3
  it("2. SEARCHING... followed by UNABLE TO CONNECT", () => {
    const r = parse("SEARCHING...\rUNABLE TO CONNECT\r\r");
    expect(r.status).toEqual({ kind: "error", error: { kind: "unable-to-connect", line: "UNABLE TO CONNECT" } });
    expect(r.searching).toBe(true);
    expect(r.lines).toEqual([]);
  });

  // §Responses row 5
  it("6. BUS INIT: ...ERROR", () => {
    expect(parse("BUS INIT: ...ERROR\r\r").status).toEqual({
      kind: "error",
      error: { kind: "bus-init-error", line: "BUS INIT: ...ERROR" },
    });
  });

  // §Responses row 9
  it("10. LV RESET", () => {
    expect(parse("LV RESET\r\r").status).toEqual({ kind: "error", error: { kind: "lv-reset", line: "LV RESET" } });
  });

  // §Responses row 11 (`ERR94` etc.; ERR + two digits per spec Risks)
  it("12. ERR94 is err-code; ERRX is data", () => {
    expect(parse("ERR94\r\r").status).toEqual({ kind: "error", error: { kind: "err-code", line: "ERR94" } });
    const r = parse("ERRX\r\r");
    expect(r.status).toEqual({ kind: "data" });
    expect(r.lines).toEqual(["ERRX"]);
  });

  // §Framing (lines end with \r\n under ATL1)
  it("15. ATL1 endings", () => {
    const r = parse("OK\r\n\r\n");
    expect(r.status).toEqual({ kind: "ok" });
    expect(r.lines).toEqual([]);
  });
});

describe("ElmLineReader", () => {
  // §Framing
  it("18. two prompts in one chunk; trailing text stays buffered", () => {
    const reader = new ElmLineReader();
    const raws = reader.push(latin1Encode("OK\r\r>NO DATA\r\r>ELM"));
    expect(raws).toEqual(["OK\r\r", "NO DATA\r\r"]);
    expect(parse(raws[0]).status).toEqual({ kind: "ok" });
    expect(parse(raws[1]).status).toEqual({ kind: "nodata" });
    const completed = reader.push(latin1Encode("327 v1.5\r\r>"));
    expect(completed).toEqual(["ELM327 v1.5\r\r"]);
    expect(parse(completed[0]).status).toEqual({ kind: "data" });
  });

  it("19. reset() discards the buffered partial", () => {
    const reader = new ElmLineReader();
    expect(reader.push(latin1Encode("SEARCH"))).toEqual([]);
    reader.reset();
    const raws = reader.push(latin1Encode("OK\r\r>"));
    expect(raws).toEqual(["OK\r\r"]);
    expect(parse(raws[0]).status).toEqual({ kind: "ok" });
  });
});
