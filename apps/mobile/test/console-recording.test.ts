/* eslint-disable @typescript-eslint/require-await */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElmLineReader } from "obd-core/elm";
import { latin1Decode, latin1Encode, parseRecording } from "obd-core/recording";
// obd-core exports only transport types, the reader, and the recording format; the replay transport is read from source.
import { ReplayTransport } from "../../../packages/obd-core/src/transport/replay.js";
import type { Transport } from "obd-core/transport";
import { ALLOWED_AT_COMMANDS, ConsoleSession, normalizeReadOnlyCommand, READ_ONLY_SERVICES } from "../src/console.js";
import { RecordingBuffer } from "../src/recording.js";

class FakeTransport implements Transport {
  readonly writes: string[] = [];
  private callbacks = new Set<(bytes: Uint8Array) => void>();
  fail?: Error;
  onWrite?: () => void;
  startsIdle = true;
  async write(bytes: Uint8Array): Promise<void> { this.onWrite?.(); this.writes.push(latin1Decode(bytes)); if (this.fail) throw this.fail; }
  onData(callback: (bytes: Uint8Array) => void): () => void { this.callbacks.add(callback); return () => { this.callbacks.delete(callback); }; }
  async close(): Promise<void> { /* nothing to release */ }
  data(text: string): void { this.callbacks.forEach((callback) => { callback(latin1Encode(text)); }); }
}
// Verbatim rx chunks after tx "0100\r": fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl lines 25-41.
const EQUINOX_0100_RX = ["SEAR", "CH", "I", "NG", ".", "..", "\r", "18DAF14506410080", "000001\r18DAF1CB0", "6410080000001\r18", "DAF1400641008000", "0001\r18DAF128064", "100BFFFF997\r18DA", "F117064100800800", "13\r", "\r", ">"];
const EQUINOX_0100_RESPONSE = EQUINOX_0100_RX.join("").slice(0, -1);
const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "Ready", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };

afterEach(() => { vi.useRealTimers(); });

describe("normalizeReadOnlyCommand", () => {
  it("normalizes every allowed service and all nine AT commands", () => {
    expect(ALLOWED_AT_COMMANDS).toEqual(["ATZ", "ATI", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATDPN", "ATRV"]);
    expect(READ_ONLY_SERVICES).toEqual(["01", "02", "03", "07", "09", "0A", "22"]);
    for (const command of [...ALLOWED_AT_COMMANDS, ...READ_ONLY_SERVICES, ...READ_ONLY_SERVICES.map((service) => `${service}00`)]) {
      expect(normalizeReadOnlyCommand(`  ${command.toLowerCase()}  `)).toBe(command);
    }
    expect(normalizeReadOnlyCommand(" 01   00 ")).toBe("0100");
    expect(normalizeReadOnlyCommand("22 33e5")).toBe("2233E5");
  });

  const rejected = ["", "   ", "ATMA", "ATSP7", "ATST 32", "AT Z", "ATZ0", "ATSH DA1DF1", "04", "0400", "2E", "2E1234", "2F00", "31", "3101", "10 03", "08", "0800", "0600", "0", "010", "01\r00", "01\n00", "01\t00", "01é", "0100\u0000", "ZZ"];
  it.each(rejected)("rejects %j", (command) => { expect(() => normalizeReadOnlyCommand(command)).toThrow(); });

  it("rejects before any transport write", async () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    for (const command of rejected) await expect(session.send(command)).rejects.toThrow();
    expect(transport.writes).toEqual([]); expect(recording.lines()).toHaveLength(1);
  });
});

describe("ConsoleSession", () => {
  it("records tx before the write, keeps rx chunks separate, and resolves only at '>'", async () => {
    const now = vi.fn().mockReturnValueOnce(10).mockReturnValue(10.1234);
    const recording = new RecordingBuffer(now); recording.start(meta);
    const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    let atWrite: unknown; transport.onWrite = () => { atWrite = recording.lines().at(-1); };
    const sent = session.send("0100");
    expect(atWrite).toEqual({ t: 0.123, dir: "tx", data: "0100\r" }); expect(transport.writes).toEqual(["0100\r"]);
    await expect(session.send("0100")).rejects.toThrow("busy"); expect(transport.writes).toHaveLength(1);
    for (const chunk of EQUINOX_0100_RX.slice(0, -1)) transport.data(chunk);
    await expect(Promise.race([sent.then(() => "done"), new Promise((resolve) => setTimeout(() => { resolve("pending"); }, 5))])).resolves.toBe("pending");
    transport.data(">"); expect(await sent).toBe(EQUINOX_0100_RESPONSE);
    expect(recording.lines().filter((line) => line.dir === "rx").map((line) => line.data)).toEqual(EQUINOX_0100_RX);
    expect(recording.lines().map((line) => line.t)).toEqual([0, ...Array<number>(1 + EQUINOX_0100_RX.length).fill(0.123)]);
  });

  it("timeout records the meta note, rejects, and unlocks", async () => {
    vi.useFakeTimers();
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording, 10);
    const timed = session.send("ATZ"); const timedExpectation = expect(timed).rejects.toThrow("Timed out"); await vi.advanceTimersByTimeAsync(10); await timedExpectation;
    expect(recording.lines().at(-1)).toEqual({ t: 0, dir: "meta", note: "timeout waiting for '>' after ATZ" });
    transport.data(">");
    const next = session.send("ATE0"); transport.data("OK\r\r>"); await expect(next).resolves.toBe("OK\r\r");
  });

  it("write failure records the meta note, rejects, and unlocks", async () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    transport.fail = new TypeError("nope"); await expect(session.send("0100")).rejects.toThrow("nope");
    expect(recording.lines().slice(1)).toEqual([{ t: 0, dir: "tx", data: "0100\r" }, { t: 0, dir: "meta", note: "write failed after 0100: TypeError" }]);
    transport.fail = undefined; transport.data(">"); const next = session.send("0100"); transport.data("4100>"); await expect(next).resolves.toBe("4100");
  });

  it("S1: after a timeout with no '>', send writes nothing until a late '>' arrives", async () => {
    vi.useFakeTimers();
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording, 10);
    const timed = session.send("ATZ"); const timedExpectation = expect(timed).rejects.toThrow("Timed out"); await vi.advanceTimersByTimeAsync(10); await timedExpectation;
    const linesBefore = recording.lines().length;
    await expect(session.send("ATE0")).rejects.toThrow("Waiting for '>'");
    expect(transport.writes).toEqual(["ATZ\r"]); expect(recording.lines()).toHaveLength(linesBefore);
    transport.data("\r>");
    const next = session.send("ATE0"); expect(transport.writes).toEqual(["ATZ\r", "ATE0\r"]);
    transport.data("OK\r\r>"); await expect(next).resolves.toBe("OK\r\r");
  });

  it("S2: waitForPrompt is true at once when fresh; after a timeout true on a late '>', false after ms, false on close", async () => {
    vi.useFakeTimers();
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording, 10);
    await expect(session.waitForPrompt(1000)).resolves.toBe(true);
    const timeOut = async () => { const timed = session.send("0100"); const expectation = expect(timed).rejects.toThrow("Timed out"); await vi.advanceTimersByTimeAsync(10); await expectation; };
    await timeOut();
    const late = session.waitForPrompt(1000); await vi.advanceTimersByTimeAsync(500); transport.data("4100\r\r>"); await expect(late).resolves.toBe(true);
    await timeOut();
    const none = session.waitForPrompt(1000); await vi.advanceTimersByTimeAsync(999);
    await expect(Promise.race([none, Promise.resolve("pending")])).resolves.toBe("pending");
    await vi.advanceTimersByTimeAsync(1); await expect(none).resolves.toBe(false);
    const closing = session.waitForPrompt(1000); session.close(); await expect(closing).resolves.toBe(false);
  });

  it("S3: closed flips on close and send after close writes nothing", async () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    expect(session.closed).toBe(false); session.close(); expect(session.closed).toBe(true);
    await expect(session.send("0100")).rejects.toThrow("Console session closed");
    expect(transport.writes).toEqual([]); expect(recording.lines()).toHaveLength(1);
  });

  it("close rejects a pending send and unsubscribes", async () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    const pending = session.send("0100"); session.close(); await expect(pending).rejects.toThrow("closed");
    transport.data("4100>"); expect(recording.lines().filter((line) => line.dir === "rx")).toHaveLength(0);
  });

  // docs/specs/X-2026-09-24-first-write.md Verification, isolated tests 8-11.
  const UNKNOWN = "ELM state unknown; send ATZ or ATI first";
  const fresh = (timeoutMs?: number) => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); transport.startsIdle = false;
    return { recording, transport, session: new ConsoleSession(transport, recording, timeoutMs) };
  };

  it("first-write C1: a fresh console refuses anything but ATZ/ATI before recording or writing; ATI is sent", async () => {
    const { recording, transport, session } = fresh();
    await expect(session.send("0100")).rejects.toThrow(UNKNOWN);
    expect(transport.writes).toEqual([]); expect(recording.lines()).toHaveLength(1); expect(session.stateUnknown).toBe(true);
    const sent = session.send("ATI"); expect(transport.writes).toEqual(["ATI\r"]);
    transport.data("ELM327 v1.5\r\r>"); await expect(sent).resolves.toBe("ELM327 v1.5\r\r"); expect(session.stateUnknown).toBe(false);
  });

  it("first-write C2: an ATZ answered '?' leaves the console unknown", async () => {
    const { transport, session } = fresh();
    const sent = session.send("ATZ"); transport.data("?\r\r>"); await sent;
    await expect(session.send("0100")).rejects.toThrow(UNKNOWN); expect(transport.writes).toEqual(["ATZ\r"]);
  });

  it("first-write C3: a late '>' after a timed-out ATZ does not end the unknown state", async () => {
    vi.useFakeTimers();
    const { transport, session } = fresh(10);
    const timed = session.send("ATZ"); const timedExpectation = expect(timed).rejects.toThrow("Timed out"); await vi.advanceTimersByTimeAsync(10); await timedExpectation;
    transport.data("\r\rELM327 v1.5\r\r>");
    expect(session.stateUnknown).toBe(true);
    await expect(session.send("ATE0")).rejects.toThrow(UNKNOWN); expect(transport.writes).toEqual(["ATZ\r"]);
  });

  it("first-write C4: STOPPED in a known console starts the unknown state again", async () => {
    const { transport, session } = fresh();
    const reset = session.send("ATZ"); transport.data("\r\rELM327 v1.5\r\r>"); await reset; expect(session.stateUnknown).toBe(false);
    const stopped = session.send("0100"); transport.data("STOPPED\r\r>"); await stopped;
    expect(session.stateUnknown).toBe(true);
    await expect(session.send("0101")).rejects.toThrow(UNKNOWN); expect(transport.writes).toEqual(["ATZ\r", "0100\r"]);
  });
});

describe("RecordingBuffer", () => {
  it("uses non-negative three-decimal timestamps from an injected clock", () => {
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(100.0004).mockReturnValueOnce(101.23456).mockReturnValueOnce(99);
    const recording = new RecordingBuffer(now); recording.start(meta); recording.tx("a"); recording.tx("b"); recording.tx("c");
    expect(recording.lines().map((line) => line.t)).toEqual([0, 0, 1.235, 0]);
  });

  it("writes standard JSONL with one final newline and byte-exact rx for all 256 values", () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); recording.tx("0100\r");
    const all = Uint8Array.from({ length: 256 }, (_, index) => index); recording.rx(all);
    const jsonl = recording.toJsonl(); expect(jsonl.endsWith("}\n")).toBe(true); expect(jsonl.split("\n")).toHaveLength(4);
    const lines = parseRecording(jsonl); expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ t: 0, dir: "meta", ...meta });
    const rx = lines[2]; expect(rx.dir).toBe("rx"); expect(latin1Encode((rx as { data: string }).data)).toEqual(all);
  });

  it("R1: toJsonl writes each line byte for byte in Python json.dumps form", () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); recording.rx(Uint8Array.from({ length: 256 }, (_, index) => index));
    // Generated with: python3 -c 'import json; print(json.dumps({"t": 0, "dir": "meta", "car": "chevrolet-equinox-ev-2024", "dongle": "veepeak-obdcheck-ble", "note": "Ready", "writeChar": "fff1", "notifyChar": "fff2", "mtu": 23})); print(json.dumps({"t": 0, "dir": "rx", "data": "".join(map(chr, range(256)))}))'
    // (the rx line is pasted as a JSON string literal of that output, from json.dumps(json.dumps(...))).
    const expected = '{"t": 0, "dir": "meta", "car": "chevrolet-equinox-ev-2024", "dongle": "veepeak-obdcheck-ble", "note": "Ready", "writeChar": "fff1", "notifyChar": "fff2", "mtu": 23}\n' + "{\"t\": 0, \"dir\": \"rx\", \"data\": \"\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f !\\\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\\u007f\\u0080\\u0081\\u0082\\u0083\\u0084\\u0085\\u0086\\u0087\\u0088\\u0089\\u008a\\u008b\\u008c\\u008d\\u008e\\u008f\\u0090\\u0091\\u0092\\u0093\\u0094\\u0095\\u0096\\u0097\\u0098\\u0099\\u009a\\u009b\\u009c\\u009d\\u009e\\u009f\\u00a0\\u00a1\\u00a2\\u00a3\\u00a4\\u00a5\\u00a6\\u00a7\\u00a8\\u00a9\\u00aa\\u00ab\\u00ac\\u00ad\\u00ae\\u00af\\u00b0\\u00b1\\u00b2\\u00b3\\u00b4\\u00b5\\u00b6\\u00b7\\u00b8\\u00b9\\u00ba\\u00bb\\u00bc\\u00bd\\u00be\\u00bf\\u00c0\\u00c1\\u00c2\\u00c3\\u00c4\\u00c5\\u00c6\\u00c7\\u00c8\\u00c9\\u00ca\\u00cb\\u00cc\\u00cd\\u00ce\\u00cf\\u00d0\\u00d1\\u00d2\\u00d3\\u00d4\\u00d5\\u00d6\\u00d7\\u00d8\\u00d9\\u00da\\u00db\\u00dc\\u00dd\\u00de\\u00df\\u00e0\\u00e1\\u00e2\\u00e3\\u00e4\\u00e5\\u00e6\\u00e7\\u00e8\\u00e9\\u00ea\\u00eb\\u00ec\\u00ed\\u00ee\\u00ef\\u00f0\\u00f1\\u00f2\\u00f3\\u00f4\\u00f5\\u00f6\\u00f7\\u00f8\\u00f9\\u00fa\\u00fb\\u00fc\\u00fd\\u00fe\\u00ff\"}" + "\n";
    expect(recording.toJsonl()).toBe(expected);
  });

  it("replays console output through ReplayTransport and ElmLineReader to the same response", async () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    const sent = session.send("0100"); for (const chunk of EQUINOX_0100_RX) transport.data(chunk); const live = await sent;
    const replay = new ReplayTransport(parseRecording(recording.toJsonl())); const reader = new ElmLineReader(); const responses: string[] = [];
    replay.onData((bytes) => { responses.push(...reader.push(bytes)); }); await replay.write(latin1Encode("0100\r")); await Promise.resolve();
    expect(responses).toEqual([live]); expect(live).toBe(EQUINOX_0100_RESPONSE); expect(live.replace(/\s/g, "")).toContain("4100");
  });
});
