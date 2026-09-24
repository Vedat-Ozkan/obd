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
  it("normalizes every allowed service and all eight AT commands", () => {
    expect(ALLOWED_AT_COMMANDS).toEqual(["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATDPN", "ATRV"]);
    expect(READ_ONLY_SERVICES).toEqual(["01", "02", "03", "06", "07", "09", "0A", "22"]);
    for (const command of [...ALLOWED_AT_COMMANDS, ...READ_ONLY_SERVICES, ...READ_ONLY_SERVICES.map((service) => `${service}00`)]) {
      expect(normalizeReadOnlyCommand(`  ${command.toLowerCase()}  `)).toBe(command);
    }
    expect(normalizeReadOnlyCommand(" 01   00 ")).toBe("0100");
    expect(normalizeReadOnlyCommand("22 33e5")).toBe("2233E5");
  });

  const rejected = ["", "   ", "ATI", "ATMA", "ATSP7", "ATST 32", "AT Z", "ATZ0", "ATSH DA1DF1", "04", "0400", "2E", "2E1234", "2F00", "31", "3101", "10 03", "08", "0800", "0", "010", "01\r00", "01\n00", "01\t00", "01é", "0100\u0000", "ZZ"];
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
    const next = session.send("ATE0"); transport.data("OK\r\r>"); await expect(next).resolves.toBe("OK\r\r");
  });

  it("has a 20 s default timeout", async () => {
    vi.useFakeTimers();
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const session = new ConsoleSession(new FakeTransport(), recording);
    const timed = session.send("0100"); let settled = false; timed.catch(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(19_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(settled).toBe(true);
  });

  it("write failure records the meta note, rejects, and unlocks", async () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    transport.fail = new TypeError("nope"); await expect(session.send("0100")).rejects.toThrow("nope");
    expect(recording.lines().slice(1)).toEqual([{ t: 0, dir: "tx", data: "0100\r" }, { t: 0, dir: "meta", note: "write failed after 0100: TypeError" }]);
    transport.fail = undefined; const next = session.send("0100"); transport.data("4100>"); await expect(next).resolves.toBe("4100");
  });

  it("close rejects a pending send and unsubscribes", async () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    const pending = session.send("0100"); session.close(); await expect(pending).rejects.toThrow("closed");
    transport.data("4100>"); expect(recording.lines().filter((line) => line.dir === "rx")).toHaveLength(0);
  });
});

describe("RecordingBuffer", () => {
  it("throws before start and returns a defensive copy", () => {
    const recording = new RecordingBuffer(() => 1);
    expect(() => { recording.tx("0100\r"); }).toThrow(); expect(() => { recording.rx(Uint8Array.of(1)); }).toThrow();
    recording.start(meta); (recording.lines() as unknown[]).push("x"); expect(recording.lines()).toHaveLength(1);
  });

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

  it("replays console output through ReplayTransport and ElmLineReader to the same response", async () => {
    const recording = new RecordingBuffer(() => 1); recording.start(meta); const transport = new FakeTransport(); const session = new ConsoleSession(transport, recording);
    const sent = session.send("0100"); for (const chunk of EQUINOX_0100_RX) transport.data(chunk); const live = await sent;
    const replay = new ReplayTransport(parseRecording(recording.toJsonl())); const reader = new ElmLineReader(); const responses: string[] = [];
    replay.onData((bytes) => { responses.push(...reader.push(bytes)); }); await replay.write(latin1Encode("0100\r")); await Promise.resolve();
    expect(responses).toEqual([live]); expect(live).toBe(EQUINOX_0100_RESPONSE); expect(live.replace(/\s/g, "")).toContain("4100");
  });
});
