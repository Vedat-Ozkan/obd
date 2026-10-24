import { describe, expect, it } from "vitest";
import type { RecordingLine } from "../recording/format.js";
import { latin1Decode, latin1Encode } from "../recording/format.js";
import { buildSimTable, SimulatedCommandError, SimulatedTransport } from "./simulated.js";

const tx = (data: string): RecordingLine => ({ t: 0, dir: "tx", data });
const rx = (data: string): RecordingLine => ({ t: 0, dir: "rx", data });
const exchange = (command: string, ...replies: string[]): RecordingLine[] => [tx(`${command}\r`), ...replies.map(rx)];
const synthetic = { path: "synthetic.jsonl", lines: [] as RecordingLine[] };
const build = (lines: RecordingLine[], maxPerKey = 64) => buildSimTable([{ path: "a.redacted.jsonl", lines }], synthetic, maxPerKey);

async function ask(transport: SimulatedTransport, command: string): Promise<string> {
  const got = new Promise<string>((resolve) => {
    const off = transport.onData((bytes) => { off(); resolve(latin1Decode(bytes)); });
  });
  await transport.write(latin1Encode(`${command}\r`));
  return got;
}

describe("simulated transport", () => {
  it("header-keyed: a reply recorded under one header is not returned under another", async () => {
    const table = build([...exchange("ATSH DACBF1", "OK\r\r>"), ...exchange("22 2AF5", "CB-REPLY\r\r>"), ...exchange("ATSH DA17F1", "OK\r\r>")]);
    const sim = new SimulatedTransport(table);
    await ask(sim, "ATSH DACBF1");
    expect(await ask(sim, "22 2AF5")).toBe("CB-REPLY\r\r>");
    await ask(sim, "ATSH DA17F1");
    await expect(sim.write(latin1Encode("22 2AF5\r"))).rejects.toBeInstanceOf(SimulatedCommandError);
    expect(sim.misses).toEqual(["DA17F1|22 2AF5"]);
  });

  it("unknown-fails-loudly: a key with no recording rejects and is listed", async () => {
    const sim = new SimulatedTransport(build(exchange("0100", "41 00\r\r>")));
    await expect(sim.write(latin1Encode("014D\r"))).rejects.toMatchObject({ name: "SimulatedCommandError", key: "|014D" });
    expect(sim.misses).toEqual(["|014D"]);
  });

  it("unredacted-refused: a source that is not .redacted.jsonl is rejected by the builder", () => {
    expect(() => buildSimTable([{ path: "2026-09-28-phone-console-2.jsonl", lines: [] }], synthetic, 4)).toThrow(/redacted/);
  });

  it("queue-cycles: distinct replies repeat in order and wrap without skipping", async () => {
    const sim = new SimulatedTransport(build([...exchange("2414", "A\r>"), ...exchange("2414", "B\r>"), ...exchange("2414", "C\r>")]));
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) seen.push(await ask(sim, "2414"));
    expect(seen).toEqual(["A\r>", "B\r>", "C\r>", "A\r>", "B\r>", "C\r>", "A\r>"]);
  });

  it("atsh-normalised: lower case and double spaces reach the same key", async () => {
    const sim = new SimulatedTransport(build([...exchange("ATSH DACBF1", "OK\r\r>"), ...exchange("22 2AF5", "X\r\r>")]));
    await ask(sim, "atsh  dacbf1");
    expect(await ask(sim, "22  2af5")).toBe("X\r\r>");
  });

  it("at-first-reply-only: an AT key does not mix echo-on and echo-off replies", async () => {
    const sim = new SimulatedTransport(build([...exchange("ATH1", "ATH1\rOK\r\r>"), ...exchange("ATH1", "OK\r\r>")]));
    expect(await ask(sim, "ATH1")).toBe("ATH1\rOK\r\r>");
    expect(await ask(sim, "ATH1")).toBe("ATH1\rOK\r\r>");
  });
});
