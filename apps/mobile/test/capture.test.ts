/* eslint-disable @typescript-eslint/require-await */
import { afterEach, describe, expect, it, vi } from "vitest";
import { latin1Decode, latin1Encode, parseRecording } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { CAPTURE_COMMANDS, runCapture, type CaptureProgress } from "../src/capture.js";
import { ConsoleSession, normalizeReadOnlyCommand } from "../src/console.js";
import { RecordingBuffer } from "../src/recording.js";

// Verbatim rx chunks after tx "0100\r": fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl lines 25-41.
const EQUINOX_0100_RX = ["SEAR", "CH", "I", "NG", ".", "..", "\r", "18DAF14506410080", "000001\r18DAF1CB0", "6410080000001\r18", "DAF1400641008000", "0001\r18DAF128064", "100BFFFF997\r18DA", "F117064100800800", "13\r", "\r", ">"];
// Verbatim rx chunks after tx "03\r": same file, lines 107-114.
const EQUINOX_03_RX = ["18DAF1CB23000000", "00000000\r18DAF14", "5024300\r18DAF117", "024300\r18DAF1400", "24300\r18DAF12802", "4300\r18DAF1CB024", "300\r", "\r>"];
const HAPPY: Record<string, string[]> = {
  ATZ: ["\r\rELM327 v1.5\r\r>"], ATE0: ["OK\r\r>"], ATL0: ["OK\r\r>"], ATS0: ["OK\r\r>"], ATH1: ["OK\r\r>"], ATSP0: ["OK\r\r>"],
  "0100": EQUINOX_0100_RX, "020000": ["NO DATA\r\r>"], "020200": ["NO DATA\r\r>"], "03": EQUINOX_03_RX,
};
const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "Ready", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };

/** Replies from a script on write; "none" = no reply ever, "throw" = the write rejects. Flags any write made while a '>' is outstanding. */
class ScriptedTransport implements Transport {
  readonly writes: string[] = [];
  readonly violations: string[] = [];
  onWrite?: (command: string) => void;
  private outstanding = false;
  private callbacks = new Set<(bytes: Uint8Array) => void>();
  constructor(private readonly script: Record<string, string[] | "none" | "throw">) {}
  async write(bytes: Uint8Array): Promise<void> {
    const text = latin1Decode(bytes); const command = text.slice(0, -1);
    if (this.outstanding) this.violations.push(text);
    this.writes.push(text); this.outstanding = true; this.onWrite?.(command);
    const reply = this.script[command];
    if (reply === "throw") throw new Error("gatt write failed");
    if (reply === "none") return;
    void Promise.resolve().then(() => { for (const chunk of reply) this.data(chunk); });
  }
  onData(callback: (bytes: Uint8Array) => void): () => void { this.callbacks.add(callback); return () => { this.callbacks.delete(callback); }; }
  async close(): Promise<void> { /* nothing to release */ }
  data(text: string): void { if (text.includes(">")) this.outstanding = false; this.callbacks.forEach((callback) => { callback(latin1Encode(text)); }); }
}

function setup(overrides: Record<string, string[] | "none" | "throw"> = {}) {
  const recording = new RecordingBuffer(() => 1); recording.start(meta);
  const transport = new ScriptedTransport({ ...HAPPY, ...overrides });
  const session = new ConsoleSession(transport, recording, 50);
  const progress: CaptureProgress[] = [];
  return { recording, transport, session, progress, run: () => runCapture(session, recording, (event) => { progress.push({ ...event }); }) };
}
const start = `capture start: ${CAPTURE_COMMANDS.join(" ")}`;
const outcomes = (progress: CaptureProgress[]) => progress.filter((event) => event.outcome !== undefined).map((event) => [event.command, event.outcome]);

afterEach(() => { vi.useRealTimers(); });

describe("runCapture", () => {
  it("C1: the sequence is exact and already normalized", () => {
    expect(CAPTURE_COMMANDS).toEqual(["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "0100", "020000", "020200", "03"]);
    for (const command of CAPTURE_COMMANDS) expect(normalizeReadOnlyCommand(command)).toBe(command);
  });

  it("C2: happy path writes in order and records tx then rx per command", async () => {
    const { recording, transport, progress, run } = setup();
    const result = await run();
    expect(result).toEqual({ sent: 10, total: 10 });
    expect(transport.writes).toEqual(CAPTURE_COMMANDS.map((command) => `${command}\r`)); expect(transport.violations).toEqual([]);
    const expected = [{ t: 0, dir: "meta", note: start }];
    for (const command of CAPTURE_COMMANDS) {
      expected.push({ t: 0, dir: "tx", data: `${command}\r` } as never);
      for (const chunk of HAPPY[command]) expected.push({ t: 0, dir: "rx", data: chunk } as never);
    }
    expected.push({ t: 0, dir: "meta", note: "capture complete: 10 of 10 sent" });
    expect(recording.lines().slice(1)).toEqual(expected);
    expect(progress).toHaveLength(20);
    progress.forEach((event, index) => {
      const step = Math.floor(index / 2) + 1;
      expect(event.step).toBe(step); expect(event.total).toBe(10); expect(event.command).toBe(CAPTURE_COMMANDS[step - 1]);
      expect(event.outcome === undefined).toBe(index % 2 === 0);
    });
    expect(outcomes(progress)).toEqual([["ATZ", "data"], ["ATE0", "ok"], ["ATL0", "ok"], ["ATS0", "ok"], ["ATH1", "ok"], ["ATSP0", "ok"], ["0100", "data"], ["020000", "nodata"], ["020200", "nodata"], ["03", "data"]]);
    expect(progress[13].response).toBe(EQUINOX_0100_RX.join("").slice(0, -1));
  });

  it("C3: error replies are recorded and the run continues", async () => {
    const { transport, progress, run } = setup({ "020000": ["NO DATA\r\r>"], "020200": ["CAN ERROR\r\r>"] });
    const result = await run();
    expect(result).toEqual({ sent: 10, total: 10 }); expect(transport.violations).toEqual([]);
    expect(outcomes(progress).slice(7, 9)).toEqual([["020000", "nodata"], ["020200", "error: can-error"]]);
  });

  it("C4: after a timeout it waits for the late '>' and then continues", async () => {
    vi.useFakeTimers();
    const { recording, transport, progress, run } = setup({ "0100": "none" });
    const running = run();
    await vi.advanceTimersByTimeAsync(50);
    expect(recording.lines().at(-1)).toEqual({ t: 0, dir: "meta", note: "timeout waiting for '>' after 0100" });
    expect(outcomes(progress).at(-1)).toEqual(["0100", "Timed out waiting for response to 0100"]);
    await vi.advanceTimersByTimeAsync(499);
    expect(transport.writes.at(-1)).toBe("0100\r");
    await vi.advanceTimersByTimeAsync(1);
    for (const chunk of EQUINOX_0100_RX) transport.data(chunk);
    const result = await running;
    expect(result).toEqual({ sent: 10, total: 10 }); expect(transport.violations).toEqual([]);
    expect(transport.writes.slice(6)).toEqual(["0100\r", "020000\r", "020200\r", "03\r"]);
    expect(recording.lines().at(-1)).toEqual({ t: 0, dir: "meta", note: "capture complete: 10 of 10 sent" });
  });

  it("C5: after a timeout with no '>' it stops and records why", async () => {
    vi.useFakeTimers();
    const { recording, transport, run } = setup({ "0100": "none" });
    const running = run();
    await vi.advanceTimersByTimeAsync(50 + 1000);
    const result = await running;
    expect(result.sent).toBe(7); expect(result.total).toBe(10);
    expect(result.stoppedEarly).toBe("no '>' within 1000 ms after: Timed out waiting for response to 0100");
    expect(transport.writes.at(-1)).toBe("0100\r"); expect(transport.writes).toHaveLength(7);
    expect(recording.lines().at(-1)).toEqual({ t: 0, dir: "meta", note: `capture stopped at step 7 (0100): ${result.stoppedEarly ?? ""}` });
    expect(() => parseRecording(recording.toJsonl())).not.toThrow();
  });

  it("C6: a write failure with no '>' stops the run like a timeout", async () => {
    vi.useFakeTimers();
    const { recording, transport, run } = setup({ "020000": "throw" });
    const running = run();
    await vi.advanceTimersByTimeAsync(1000);
    const result = await running;
    expect(result).toEqual({ sent: 8, total: 10, stoppedEarly: "no '>' within 1000 ms after: gatt write failed" });
    expect(transport.writes.at(-1)).toBe("020000\r"); expect(transport.writes).toHaveLength(8);
    expect(recording.lines()).toContainEqual({ t: 0, dir: "meta", note: "write failed after 020000: Error" });
    expect(recording.lines().at(-1)).toEqual({ t: 0, dir: "meta", note: "capture stopped at step 8 (020000): no '>' within 1000 ms after: gatt write failed" });
  });

  it("C7: a disconnect mid-run stops without writing more or recording more", async () => {
    const { recording, transport, session, run } = setup({ "0100": "none" });
    let linesAtClose = -1;
    transport.onWrite = (command) => { if (command === "0100") void Promise.resolve().then(() => { session.close(); linesAtClose = recording.lines().length; }); };
    const result = await run();
    expect(result).toEqual({ sent: 7, total: 10, stoppedEarly: "disconnected" });
    expect(transport.writes.at(-1)).toBe("0100\r"); expect(transport.writes).toHaveLength(7);
    expect(recording.lines()).toHaveLength(linesAtClose);
  });

  // docs/specs/X-2026-09-24-first-write.md Verification, isolated test 12 (spec name C5).
  it("first-write C5: a plain capture whose ATZ is answered '?' stops before writing ATE0", async () => {
    const { recording, transport, run } = setup({ ATZ: ["?\r\r>"] });
    const result = await run();
    expect(result).toEqual({ sent: 1, total: 10, stoppedEarly: "ELM state unknown; send ATZ or ATI first" });
    expect(transport.writes).toEqual(["ATZ\r"]);
    expect(recording.lines().at(-1)).toEqual({ t: 0, dir: "meta", note: "capture stopped at step 1 (ATZ): ELM state unknown; send ATZ or ATI first" });
  });
});
