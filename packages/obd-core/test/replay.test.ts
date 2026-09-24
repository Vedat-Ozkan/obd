import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { latin1Decode, latin1Encode, parseRecording } from "../src/recording/format.js";
import { ReplayMismatchError, ReplayTransport } from "../src/transport/replay.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/synthetic/elm-framing.jsonl", import.meta.url));
const fixtureText = readFileSync(fixturePath, "latin1");

describe("parseRecording", () => {
  it("rejects invalid JSON with the 1-based line number", () => {
    expect(() => parseRecording('{"t": 0, "dir": "tx", "data": "ATZ\\r"}\nnot json')).toThrow(/^recording line 2:/);
  });

  it("rejects dir outside tx/rx/meta", () => {
    expect(() => parseRecording('{"t": 0, "dir": "xx", "data": "ATZ\\r"}')).toThrow(/^recording line 1:/);
  });

  it("rejects tx without data", () => {
    expect(() => parseRecording('{"t": 0, "dir": "meta"}\n{"t": 1, "dir": "tx"}')).toThrow(/^recording line 2:/);
  });

  it("rejects data containing a char code > 0xFF", () => {
    expect(() => parseRecording('{"t": 0, "dir": "rx", "data": "\\u0100"}')).toThrow(/^recording line 1:/);
  });
});

describe("latin1 codec", () => {
  it("round-trips all 256 byte values", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = latin1Decode(all);
    expect(text).toHaveLength(256);
    expect(latin1Encode(text)).toEqual(all);
  });

  it("latin1Encode throws on U+0100", () => {
    expect(() => latin1Encode("\u0100")).toThrow();
  });
});

const fixture = parseRecording(fixtureText);

function collect(transport: ReplayTransport): string[] {
  const chunks: string[] = [];
  transport.onData((bytes) => chunks.push(latin1Decode(bytes)));
  return chunks;
}

describe("ReplayTransport", () => {
  it("delivers the recorded chunks for ATZ, asynchronously, in order", async () => {
    const transport = new ReplayTransport(fixture);
    const chunks = collect(transport);
    const pending = transport.write(latin1Encode("ATZ\r"));
    expect(chunks).toEqual([]);
    await pending;
    expect(chunks).toEqual(["ATZ\r", "\r\rELM327 v1.5", "\r\r>"]);
  });

  it("rejects a mismatched command with line, expected, actual; cursor unchanged", async () => {
    const transport = new ReplayTransport(fixture);
    await transport.write(latin1Encode("ATZ\r"));
    const err = await transport.write(latin1Encode("ATI\r")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReplayMismatchError);
    expect(err).toMatchObject({ line: 6, expected: "ATE0\r", actual: "ATI\r" });
    await expect(transport.write(latin1Encode("ATE0\r"))).resolves.toBeUndefined();
  });
});
