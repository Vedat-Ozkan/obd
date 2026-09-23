import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { latin1Decode, latin1Encode, parseRecording } from "../src/recording/format.js";
import { ReplayMismatchError, ReplayTransport } from "../src/transport/replay.js";

const fixturePath = fileURLToPath(new URL("../../../fixtures/synthetic/elm-framing.jsonl", import.meta.url));
const fixtureText = readFileSync(fixturePath, "latin1");

// docs/ARCHITECTURE.md "Recording format" example.
const architectureExample = [
  '{"t": 0.000, "dir": "tx", "data": "ATZ\\r"}',
  '{"t": 1.012, "dir": "rx", "data": "\\r\\rELM327 v1.5\\r\\r>"}',
  '{"t": 1.100, "dir": "meta", "car": "chrysler-200-2013", "dongle": "veepeak-obdcheck-ble", "note": "cold, ignition on engine off"}',
].join("\n");

describe("parseRecording", () => {
  it("accepts the ARCHITECTURE.md example", () => {
    const lines = parseRecording(architectureExample);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ t: 0, dir: "tx", data: "ATZ\r" });
    expect(lines[2]).toMatchObject({ dir: "meta", car: "chrysler-200-2013" });
  });

  it("accepts the synthetic fixture and tolerates the trailing newline", () => {
    expect(fixtureText.endsWith("\n")).toBe(true);
    const lines = parseRecording(fixtureText);
    expect(lines).toHaveLength(27);
    expect(lines[0]).toMatchObject({ dir: "meta", synthetic: true });
    expect(parseRecording(fixtureText.trimEnd())).toHaveLength(27);
  });

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
const txData = fixture.flatMap((l) => (l.dir === "tx" ? [l.data] : []));

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

  it("accepts every tx in file order and never delivers meta lines", async () => {
    const transport = new ReplayTransport(fixture);
    const chunks = collect(transport);
    for (const data of txData) await transport.write(latin1Encode(data));
    const rxData = fixture.flatMap((l) => (l.dir === "rx" ? [l.data] : []));
    expect(chunks).toEqual(rxData);
  });

  it("rejects a mismatched command with line, expected, actual; cursor unchanged", async () => {
    const transport = new ReplayTransport(fixture);
    await transport.write(latin1Encode("ATZ\r"));
    const err = await transport.write(latin1Encode("ATI\r")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReplayMismatchError);
    expect(err).toMatchObject({ line: 6, expected: "ATE0\r", actual: "ATI\r" });
    await expect(transport.write(latin1Encode("ATE0\r"))).resolves.toBeUndefined();
  });

  it("rejects a write after the last tx with expected undefined", async () => {
    const transport = new ReplayTransport(fixture);
    for (const data of txData) await transport.write(latin1Encode(data));
    const err = await transport.write(latin1Encode("ATZ\r")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReplayMismatchError);
    expect(err).toMatchObject({ line: 28, expected: undefined, actual: "ATZ\r" });
  });

  it("delivers the late chunk after a timeout meta line to the preceding tx (rule 5)", async () => {
    const transport = new ReplayTransport(fixture);
    const chunks = collect(transport);
    for (const data of txData) {
      chunks.length = 0;
      await transport.write(latin1Encode(data));
      if (data === "0140\r") expect(chunks).toEqual(["NO DATA\r\r>"]);
    }
  });

  it("unsubscribe stops delivery and close makes write reject", async () => {
    const transport = new ReplayTransport(fixture);
    const chunks: string[] = [];
    const unsubscribe = transport.onData((bytes) => chunks.push(latin1Decode(bytes)));
    unsubscribe();
    await transport.write(latin1Encode("ATZ\r"));
    expect(chunks).toEqual([]);
    await transport.close();
    await expect(transport.write(latin1Encode("ATE0\r"))).rejects.toThrow(/closed/);
  });
});
