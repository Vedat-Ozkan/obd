/* eslint-disable @typescript-eslint/require-await */
// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { latin1Decode, latin1Encode, parseRecording } from "obd-core/recording";
import { ReplayTransport } from "obd-core/transport/replay";
import type { Transport } from "obd-core/transport";
import { parseRelayAddress } from "../src/relay/parseRelayAddress.js";
import { RelayClient, type RelayPhoneMeta, type RelayWebSocket } from "../src/relay/RelayClient.js";

const read = readFileSync as (path: URL, encoding: "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const root = new URL("../../../", import.meta.url);
const FIXTURE = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl";
const ARTIFACT = "/tmp/t0.6b-relay-replay.json";
// The screen builds this URL; the client must never put it, or the token, on the wire or in the artifact.
const TOKEN = "SECRET-TOKEN-0123";
const phoneUrl = `ws://relay.test:8765/phone?token=${TOKEN}`;
const phoneMeta: RelayPhoneMeta = { vehicle: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", writeChar: "fff2", notifyChar: "fff1", mtu: 247 };

interface Sent { type: string; id?: string; ok?: boolean; error?: string; dataBase64?: string; ms?: number; [key: string]: unknown }

class FakeSocket implements RelayWebSocket {
  readyState = 0;
  readonly sent: Sent[] = [];
  failSend = false;
  readonly url = phoneUrl;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();
  constructor(private readonly log: string[]) {}
  send(data: string): void {
    if (this.failSend) throw new Error("socket send failed");
    const message = JSON.parse(data) as Sent; this.sent.push(message); this.log.push(`socket:${message.type}${message.id === undefined ? "" : `:${message.id}`}`);
  }
  close(): void { this.readyState = 3; }
  addEventListener(type: string, listener: (event: unknown) => void): void { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: (event: unknown) => void): void { this.listeners.get(type)?.delete(listener); }
  listenerCount(): number { let n = 0; for (const set of this.listeners.values()) n += set.size; return n; }
  emit(type: string, event: unknown = {}): void { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event); }
  open(): void { this.readyState = 1; this.emit("open"); }
  receive(data: unknown): void { this.emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) }); }
  results(): Sent[] { return this.sent.filter((message) => message.type === "result"); }
}

class FakeTransport implements Transport {
  readonly writes: string[] = [];
  readonly subscribers = new Set<(bytes: Uint8Array) => void>();
  fail?: Error;
  onWrite?: () => void;
  constructor(private readonly log: string[]) {}
  async write(bytes: Uint8Array): Promise<void> { this.onWrite?.(); this.writes.push(latin1Decode(bytes)); this.log.push(`ble:write:${latin1Decode(bytes)}`); if (this.fail) throw this.fail; }
  onData(callback: (bytes: Uint8Array) => void): () => void { this.subscribers.add(callback); return () => { this.subscribers.delete(callback); }; }
  async close(): Promise<void> { /* nothing to release */ }
  data(bytes: string | number[]): void { const chunk = typeof bytes === "string" ? latin1Encode(bytes) : Uint8Array.from(bytes); for (const callback of [...this.subscribers]) callback(chunk); }
}

interface Options { transport?: (log: string[]) => Transport; confirm?: () => Promise<boolean>; timeoutMs?: number; nowMs?: () => number }
const harness = (options: Options = {}) => {
  const log: string[] = [];
  const socket = new FakeSocket(log);
  const fake = new FakeTransport(log);
  const transport = options.transport?.(log) ?? fake;
  const terminals: boolean[] = []; const activity: (string | undefined)[] = [];
  const confirm = vi.fn(options.confirm ?? (async () => false));
  const client = new RelayClient(socket, transport, phoneMeta, confirm, options.timeoutMs, options.nowMs, (uncertain) => { terminals.push(uncertain); }, (command) => { activity.push(command); });
  socket.open();
  return { log, socket, fake, transport, terminals, activity, confirm, client };
};
const command = (id: string, text: string, confirmMode04 = false) => ({ type: "command", id, command: text, confirmMode04 });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise<void>((resolve) => { setTimeout(resolve, 0); }); };
const b64 = (text: string) => btoa(text);
const unb64 = (text: string) => latin1Encode(atob(text));

const synthetic: { synthetic: true; failure: string; observed: string }[] = [];
const note = (failure: string, observed: string) => { synthetic.push({ synthetic: true, failure, observed }); };
let tokenOnWire: boolean | undefined;
const e2e: { command: string; responseBytes: number; printable: string; promptTerminated: boolean }[] = [];

afterEach(() => { vi.useRealTimers(); });

const printable = (bytes: Uint8Array) => [...bytes].map((byte) => byte === 0x0d ? "\\r" : byte === 0x0a ? "\\n" : byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : `\\x${byte.toString(16).padStart(2, "0")}`).join("");

describe("recording replay through RelayClient", () => {
  it("bridges the recorded ATZ..0100 exchange over the relay protocol", async () => {
    const lines = parseRecording(read(new URL(FIXTURE, root), "latin1"));
    const commands = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "0100"];
    const recordedTx = lines.filter((line) => line.dir === "tx").map((line) => line.data);
    expect(recordedTx.slice(0, 7)).toEqual(commands.map((text) => `${text}\r`));
    const recordedRx = (n: number) => { let seen = -1; let text = ""; for (const line of lines) { if (line.dir === "tx") seen++; else if (line.dir === "rx" && seen === n) text += line.data; } return text; };
    let clock = 0;
    const { log, socket, transport, terminals } = harness({
      nowMs: () => (clock += 5),
      transport: (shared) => {
        const replay = new ReplayTransport(lines);
        return { write: async (bytes) => { shared.push(`ble:write:${latin1Decode(bytes)}`); await replay.write(bytes); }, onData: (cb) => replay.onData(cb), close: () => replay.close() };
      },
    });
    expect(socket.sent[0]).toEqual({ type: "hello", protocol: 1, ...phoneMeta });
    for (const [index, text] of commands.entries()) {
      socket.receive(command(String(index + 1), text));
      await vi.waitFor(() => { expect(socket.results()).toHaveLength(index + 1); });
      const result = socket.results()[index];
      expect(result).toMatchObject({ type: "result", id: String(index + 1), ok: true });
      const bytes = unb64(result.dataBase64 ?? "");
      expect(latin1Decode(bytes)).toBe(recordedRx(index));
      expect(bytes.at(-1)).toBe(0x3e); expect(bytes.indexOf(0x3e)).toBe(bytes.length - 1);
      expect(result.ms).toBeGreaterThan(0);
      const at = (needle: string) => log.indexOf(needle);
      expect(at(`socket:started:${String(index + 1)}`)).toBeLessThan(at(`ble:write:${text}\r`));
      expect(at(`ble:write:${text}\r`)).toBeLessThan(at(`socket:result:${String(index + 1)}`));
      e2e.push({ command: text, responseBytes: bytes.length, printable: printable(bytes), promptTerminated: true });
    }
    expect(terminals).toEqual([]);
    await transport.close();
    expect(e2e[0].printable).toContain("\\xfc");
    expect(e2e[6].printable).toContain("4100");
    tokenOnWire = JSON.stringify(socket.sent).includes(TOKEN) || JSON.stringify(socket.sent).includes("token");
    expect(tokenOnWire).toBe(false);
  });
});

describe("synthetic failure scenarios (one per listed failure)", () => {
  it("1. a malformed, binary, duplicate-ID or pre-open command never reaches BLE", async () => {
    for (const frame of ["{not json", JSON.stringify({ type: "command", id: "1" }), JSON.stringify({ ...command("1", "0100"), extra: 1 }), new Uint8Array([1, 2, 3])]) {
      const { socket, fake, terminals } = harness();
      socket.emit("message", { data: frame });
      await flush(); expect(fake.writes).toEqual([]); expect(socket.results()).toEqual([]); expect(terminals).toEqual([false]);
    }
    { // duplicate ID after a completed request
      const { socket, fake, terminals } = harness();
      socket.receive(command("1", "0100")); await flush(); fake.data("41 00\r\r>"); await flush();
      socket.receive(command("1", "0100")); await flush();
      expect(fake.writes).toEqual(["0100\r"]); expect(terminals).toEqual([false]);
    }
    { // traffic before the socket opened
      const log: string[] = []; const socket = new FakeSocket(log); const fake = new FakeTransport(log); const terminals: boolean[] = [];
      const client = new RelayClient(socket, fake, phoneMeta, async () => true, undefined, undefined, (u) => { terminals.push(u); });
      socket.receive(command("1", "0100")); await flush();
      expect(fake.writes).toEqual([]); expect(socket.sent).toEqual([]); client.close();
    }
    note("malformed, binary, duplicate-ID or pre-open command reaches BLE", "no BLE write in any variant; malformed/duplicate ended the client");
  });

  it("2. a second request during a pending write or an open alert gets busy, not BLE", async () => {
    const first = harness();
    first.socket.receive(command("1", "0100")); await flush();
    first.socket.receive(command("2", "0100")); await flush();
    expect(first.fake.writes).toEqual(["0100\r"]);
    expect(first.socket.results()).toEqual([{ type: "result", id: "2", ok: false, error: "busy" }]);
    let approve!: (value: boolean) => void;
    const second = harness({ confirm: () => new Promise<boolean>((resolve) => { approve = resolve; }) });
    second.socket.receive(command("1", "04", true)); await flush();
    second.socket.receive(command("2", "0100")); await flush();
    expect(second.fake.writes).toEqual([]);
    expect(second.socket.results()).toEqual([{ type: "result", id: "2", ok: false, error: "busy" }]);
    approve(false); await flush();
    note("second request overlapping a pending write or an open alert reaches BLE", "both replied busy with no BLE write");
  });

  it("3. a policy refusal or confirmation-flag mismatch writes nothing and sends no started", async () => {
    const { socket, fake, confirm } = harness();
    socket.receive(command("1", "2E1234")); await flush();
    socket.receive(command("2", "0100", true)); await flush();
    socket.receive(command("3", "04", false)); await flush();
    expect(fake.writes).toEqual([]); expect(confirm).not.toHaveBeenCalled();
    expect(socket.sent.filter((message) => message.type === "started")).toEqual([]);
    expect(socket.results()).toEqual(["1", "2", "3"].map((id) => ({ type: "result", id, ok: false, error: "invalid-command" })));
    note("policy refusal or confirmation-flag mismatch writes or sends started", "2E, true flag on 0100 and false flag on 04 all invalid-command");
  });

  it("4. Mode 04 needs a fresh approval per request and never writes without it", async () => {
    const answers = [false, true, false];
    const { socket, fake, confirm, log } = harness({ confirm: async () => answers.shift() ?? false });
    socket.receive(command("1", "04", true)); await flush();
    expect(socket.results()).toEqual([{ type: "result", id: "1", ok: false, error: "confirmation-denied" }]);
    expect(fake.writes).toEqual([]); expect(socket.sent.some((message) => message.type === "started")).toBe(false);
    socket.receive(command("2", "04", true)); await flush();
    expect(fake.writes).toEqual(["04\r"]);
    expect(log.indexOf("socket:started:2")).toBeLessThan(log.indexOf("ble:write:04\r"));
    fake.data("44\r\r>"); await flush();
    socket.receive(command("3", "04", true)); await flush();
    expect(confirm).toHaveBeenCalledTimes(3); expect(fake.writes).toEqual(["04\r"]);
    expect(socket.results().at(-1)).toEqual({ type: "result", id: "3", ok: false, error: "confirmation-denied" });
    // A late approval after close() writes nothing.
    let approve!: (value: boolean) => void;
    const late = harness({ confirm: () => new Promise<boolean>((resolve) => { approve = resolve; }) });
    late.socket.receive(command("1", "04", true)); await flush();
    late.client.close(); approve(true); await flush();
    expect(late.fake.writes).toEqual([]); expect(late.socket.sent.some((message) => message.type === "started")).toBe(false);
    note("Mode 04 denial or dismissal writes, approval reused, or late approval after close writes", "one approved 04 wrote exactly 04\\r after started; denials and late approval wrote nothing");
  });

  it("5. started is sent before the BLE write, not after", async () => {
    const { socket, fake, log } = harness();
    let startedAtWrite = false; fake.onWrite = () => { startedAtWrite = socket.sent.some((message) => message.type === "started"); };
    socket.receive(command("1", "0100")); await flush();
    expect(startedAtWrite).toBe(true); expect(log.slice(-2)).toEqual(["socket:started:1", "ble:write:0100\r"]);
    note("started follows the write instead of preceding it", "started was already on the socket inside transport.write");
  });

  it("6. every end path settles once, leaves no listener, and late data satisfies nothing", async () => {
    const ends: [string, (h: ReturnType<typeof harness>) => void | Promise<void>, string | undefined][] = [
      ["timeout", async () => { await vi.advanceTimersByTimeAsync(50); }, "timeout"],
      ["write failure", (h) => { h.fake.fail = new Error("BLE closed"); }, "transport-error"],
      ["socket send failure", (h) => { h.socket.failSend = true; h.fake.data("OK\r\r>"); }, undefined],
      ["socket close", (h) => { h.socket.emit("close"); }, undefined],
      ["socket error", (h) => { h.socket.emit("error"); }, undefined],
      ["close()", (h) => { h.client.close(); h.client.close(); }, undefined],
    ];
    for (const [name, end, expected] of ends) {
      vi.useFakeTimers();
      const h = harness({ timeoutMs: 20 });
      if (name === "write failure") h.fake.fail = new Error("BLE closed");
      h.socket.receive(command("1", "0100")); await vi.advanceTimersByTimeAsync(0);
      if (name !== "write failure") await end(h); else await vi.advanceTimersByTimeAsync(0);
      const results = h.socket.results();
      if (expected !== undefined) expect(results, name).toEqual([{ type: "result", id: "1", ok: false, error: expected }]); else expect(results.filter((r) => r.ok === false), name).toEqual([]);
      const count = h.socket.sent.length;
      expect(h.fake.subscribers.size, name).toBe(0);
      h.fake.data("41 00\r\r>"); h.socket.receive(command("2", "0100")); await vi.advanceTimersByTimeAsync(100);
      expect(h.socket.sent.length, name).toBe(count); expect(h.fake.writes, name).toEqual(["0100\r"]);
      expect(h.terminals.length, name).toBe(name === "close()" ? 0 : 1);
      vi.useRealTimers();
    }
    note("timeout, write failure, socket send failure, socket close/error, or close() leaves a pending result or listener, settles twice, or lets late data satisfy a later request", "all six end paths: no subscribers, no second result, no later write. A BLE-side close is covered through close(): the screen maps a BLE disconnect to teardown, which calls close()");
  });

  it("7. unsolicited RX or bytes after the prompt end the client uncertain", async () => {
    const idle = harness();
    idle.socket.receive(command("1", "0100")); await flush(); idle.fake.data("41 00\r\r>"); await flush();
    idle.fake.data("STRAY"); await flush();
    idle.socket.receive(command("2", "0100")); await flush();
    expect(idle.terminals).toEqual([true]); expect(idle.fake.writes).toEqual(["0100\r"]);
    const trailing = harness();
    trailing.socket.receive(command("1", "0100")); await flush(); trailing.fake.data("41 00\r\r>EXTRA"); await flush();
    expect(trailing.terminals).toEqual([true]);
    expect(trailing.socket.results().at(-1)).toMatchObject({ id: "1", ok: true, dataBase64: b64("41 00\r\r>") });
    note("unsolicited RX or bytes after the prompt reach a later result", "both variants ended with onTerminal(true); later command not written");
  });

  it("8. non-UTF-8 bytes survive base64 and no result is sent before the prompt", async () => {
    const { socket, fake } = harness();
    socket.receive(command("1", "ATZ")); await flush();
    fake.data([0x41, 0xff, 0xfc, 0x0d]); await flush(); expect(socket.results()).toEqual([]);
    fake.data([0x80, 0x3e]); await flush();
    expect(unb64(socket.results()[0].dataBase64 ?? "")).toEqual(Uint8Array.from([0x41, 0xff, 0xfc, 0x0d, 0x80, 0x3e]));
    note("non-UTF-8 bytes change in base64, or a result is sent before the prompt", "0xFF 0xFC 0x80 round-tripped; no result until the prompt");
  });

  it("9. onTerminal fires once with the right flag", async () => {
    const mid = harness();
    mid.socket.receive(command("1", "0100")); await flush(); mid.socket.emit("close"); mid.socket.emit("close"); mid.socket.emit("error"); await flush();
    expect(mid.terminals).toEqual([true]); expect(mid.socket.listenerCount()).toBe(0);
    const quiet = harness();
    quiet.socket.emit("close"); await flush(); expect(quiet.terminals).toEqual([false]);
    const closed = harness();
    closed.socket.receive(command("1", "0100")); await flush(); closed.client.close(); closed.socket.emit("close"); await flush();
    expect(closed.terminals).toEqual([]);
    note("onTerminal not called exactly once with the right flag", "true after mid-command close (once), false after idle close, never after close()");
  });
});

describe("relay address parsing (one per listed failure)", () => {
  it("rejects a portless address", () => { expect(parseRelayAddress("ws://host", "tok")).toMatchObject({ ok: false }); });
  it("rejects userinfo before the host", () => { expect(parseRelayAddress("ws://user:pw@host:8765", "tok")).toMatchObject({ ok: false }); });
  it("rejects a non-numeric or out-of-range port", () => {
    expect(parseRelayAddress("ws://host:8765x", "tok")).toMatchObject({ ok: false });
    expect(parseRelayAddress("ws://host:0", "tok")).toMatchObject({ ok: false });
    expect(parseRelayAddress("ws://host:65536", "tok")).toMatchObject({ ok: false });
  });
  it("rejects a bad percent escape without throwing", () => {
    expect(parseRelayAddress("ws://192.168.2.10:8765/phone?token=%E0", "")).toMatchObject({ ok: false });
  });
  it("clears the address field when a rejected paste contains a token", () => {
    expect(parseRelayAddress("ws://host/phone?token=abc", "")).toEqual({ ok: false, clearAddress: true });
    expect(parseRelayAddress("ws://host", "")).toEqual({ ok: false, clearAddress: false });
  });
  it("accepts the broker's printed line and takes its token when the field is empty", () => {
    expect(parseRelayAddress("ws://192.168.2.10:8765/phone?token=abc", "")).toEqual({ ok: true, base: "ws://192.168.2.10:8765", token: "abc" });
    expect(parseRelayAddress("ws://192.168.2.10:8765/phone?token=abc", "typed")).toEqual({ ok: true, base: "ws://192.168.2.10:8765", token: "typed" });
  });
  it("accepts a bare ws://host:8765 with the token from its own field", () => {
    expect(parseRelayAddress(" ws://host:8765 ", "tok")).toEqual({ ok: true, base: "ws://host:8765", token: "tok" });
    expect(parseRelayAddress("ws://host:8765", "")).toMatchObject({ ok: false });
  });
});

afterAll(() => {
  const text = `${JSON.stringify({ fixture: FIXTURE, commandOrder: e2e.map((entry) => entry.command), responses: e2e, contains4100: e2e.some((entry) => entry.printable.includes("4100")), tokenOnWire, synthetic }, null, 2)}\n`;
  if (text.includes(TOKEN)) throw new Error("relay token leaked into the artifact");
  write(ARTIFACT, text);
});
