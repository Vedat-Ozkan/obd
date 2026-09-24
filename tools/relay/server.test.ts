import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { RelayTransport, type RelayCommandChannel } from "../../packages/obd-core/src/transport/relay.js";
import { parseRecording } from "../../packages/obd-core/src/recording/format.js";
import { ReplayTransport } from "../../packages/obd-core/src/transport/replay.js";
import { RelayBroker } from "./broker.js";
import { main as hilSmoke } from "./hil-smoke.js";
import { createRelayServer } from "./server.js";

const hello = { type: "hello", protocol: 1, vehicle: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", writeChar: "FFF1", notifyChar: "FFF2", mtu: 20 };
const raw = "4100 BE 1F A8 13\r>";
// ATI reply: spike lines 6–8. ATZ banner: 2026-09-24-phone-console.redacted.jsonl line 6.
const banner = "\r\rELM327 v1.5\r\r>";
const version = "ELM327 v1.5\r\r>";

class Phone {
  readonly commands: Array<{ id: string; command: string; confirmMode04: boolean }> = [];
  readonly socket: WebSocket;
  private constructor(socket: WebSocket) { this.socket = socket; socket.on("message", (data) => { const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data; this.commands.push(JSON.parse(bytes.toString()) as { id: string; command: string; confirmMode04: boolean }); }); }
  static async connect(broker: RelayBroker): Promise<Phone> {
    while (broker.port() === undefined) await delay(1);
    const socket = new WebSocket(`ws://127.0.0.1:${String(broker.port())}/phone?token=${encodeURIComponent(broker.token)}`);
    await once(socket, "open"); const phone = new Phone(socket); phone.send(hello); while (!broker.isConnected()) await delay(1); return phone;
  }
  send(value: unknown): void { this.socket.send(JSON.stringify(value)); }
  started(command = this.commands.at(-1)): void { if (command === undefined) throw new Error("no command"); this.send({ type: "started", id: command.id }); }
  result(bytes = raw, ms = 7, command = this.commands.at(-1)): void { if (command === undefined) throw new Error("no command"); this.send({ type: "result", id: command.id, ok: true, dataBase64: Buffer.from(bytes, "latin1").toString("base64"), ms }); }
  close(): void { this.socket.close(); }
}

async function fixture(primed = true): Promise<{ broker: RelayBroker; phone: Phone; root: string; logs: string[] }> {
  const root = await mkdtemp(join(tmpdir(), "obd-relay-")); await mkdir(join(root, "fixtures/recordings/chevrolet-equinox-ev-2024"), { recursive: true });
  const logs: string[] = [];
  const broker = new RelayBroker({ port: 0, root, token: "test-token", logger: (line) => { logs.push(line); } }); const phone = await Phone.connect(broker);
  if (primed) await prime(broker, phone);
  return { broker, phone, root, logs };
}
// A new connection admits only AT commands until one gets a clean reply (amendment 2026-09-24, decision 3).
async function prime(broker: RelayBroker, phone: Phone): Promise<void> { await exchange(broker, phone, "ATI", version); phone.commands.length = 0; }
async function exchange(broker: RelayBroker, phone: Phone, command: string, reply: string): Promise<void> {
  const count = phone.commands.length; const sent = broker.send(command); await commands(phone, count + 1);
  expect(phone.commands.at(-1)?.command).toBe(command); phone.started(); phone.result(reply); await sent;
}
async function refused(broker: RelayBroker, phone: Phone, command: string, reason = "relay: refused"): Promise<void> {
  const count = phone.commands.length; await expect(broker.send(command)).rejects.toThrow(reason); await delay(5); expect(phone.commands).toHaveLength(count);
}
async function close(broker: RelayBroker, phone?: Phone): Promise<void> { phone?.close(); await broker.close(); }
function delay(ms: number): Promise<void> { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
async function commands(phone: Phone, count: number): Promise<void> { while (phone.commands.length < count) await delay(1); }
function once(socket: WebSocket, event: "open"): Promise<void> { return new Promise((resolveOnce, rejectOnce) => { socket.once(event, () => { resolveOnce(); }); socket.once("error", rejectOnce); }); }
async function waitFor(predicate: () => boolean): Promise<void> { for (let i = 0; i < 1000; i++) { if (predicate()) return; await delay(1); } throw new Error("timed out waiting for relay state"); }
async function connectRaw(broker: RelayBroker, token = broker.token): Promise<WebSocket> {
  await waitFor(() => broker.port() !== undefined);
  const socket = new WebSocket(`ws://127.0.0.1:${String(broker.port())}/phone?token=${encodeURIComponent(token)}`);
  await once(socket, "open"); return socket;
}
async function rejectedSocket(broker: RelayBroker, token: string): Promise<void> {
  await waitFor(() => broker.port() !== undefined);
  const socket = new WebSocket(`ws://127.0.0.1:${String(broker.port())}/phone?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolveReject, rejectReject) => { socket.once("unexpected-response", () => { resolveReject(); }); socket.once("open", () => { rejectReject(new Error("unauthorized upgrade accepted")); }); socket.once("error", () => { resolveReject(); }); });
}
async function mcp(broker: RelayBroker) {
  const { server } = createRelayServer(broker); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, async close() { await client.close(); await server.close(); } };
}
function path(slug: string): string { return `fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-${slug}.jsonl`; }
async function waitForLines(root: string, recordingPath: string, count: number): Promise<void> {
  for (let i = 0; i < 1000; i++) { if (parseRecording(await readFile(join(root, recordingPath), "latin1")).length >= count) return; await delay(1); }
  throw new Error("timed out waiting for recording append");
}

describe("relay policy and pure transport", () => {
  it("is single flight and emits only complete channel results", async () => {
    let resolveStart!: () => void; let resolveResult!: (value: { bytes: Uint8Array; ms: number }) => void; let requests = 0;
    const channel: RelayCommandChannel = { request() { requests++; return { started: new Promise((resolve) => { resolveStart = resolve; }), result: new Promise((resolve) => { resolveResult = resolve; }) }; }, async close() {} };
    const relay = new RelayTransport(channel); const received: string[] = []; relay.onData((bytes) => received.push(Buffer.from(bytes).toString("latin1")));
    const first = relay.write(Buffer.from("0100\r", "latin1")); await expect(relay.write(Buffer.from("0100\r", "latin1"))).rejects.toThrow("busy"); expect(requests).toBe(1);
    resolveStart(); await first; resolveResult({ bytes: Buffer.from(raw, "latin1"), ms: 1 }); await delay(0); expect(received).toEqual([raw]);
  });
  it("rejects invalid transport writes before dispatch", async () => {
    let requests = 0; const channel: RelayCommandChannel = { request() { requests++; throw new Error("unexpected request"); }, async close() {} };
    const relay = new RelayTransport(channel);
    for (const input of ["0100", "0100\r\r", "0100\n\r", "04FF\r", "ATMA\r", "é\r"]) await expect(relay.write(Buffer.from(input, "latin1"))).rejects.toThrow();
    expect(requests).toBe(0); await relay.close(); await expect(relay.write(Buffer.from("0100\r"))).rejects.toThrow("closed");
  });
});

describe("authenticated fake phone, recording, and MCP", () => {
  it("settles a valid result before an immediate socket close, including its rx append", async () => {
    const { broker, phone, root } = await fixture();
    try {
      await broker.startRecording(path("close-race"));
      const result = broker.send("0100"); await commands(phone, 1); phone.started(); phone.result("4100\r>"); phone.close();
      await expect(result).resolves.toMatchObject({ ms: 7 });
      await waitFor(() => !broker.isConnected());
      const lines = parseRecording(await readFile(join(root, path("close-race")), "latin1"));
      expect(lines.map((line) => line.dir)).toEqual(["meta", "tx", "rx", "meta"]);
      expect(lines[2]).toMatchObject({ data: "4100\r>" });
      await expect(broker.stopRecording()).rejects.toThrow("no recording");
    } finally { await close(broker); }
  });
  it("gates Mode 04 on the phone and records approval and denial truthfully through MCP", async () => {
    const { broker, phone, root } = await fixture(); const kit = await mcp(broker);
    try {
      await kit.client.callTool({ name: "start_recording", arguments: { path: path("mode04") } });
      const denied = kit.client.callTool({ name: "send_command", arguments: { cmd: "04" } }); await commands(phone, 1);
      expect(phone.commands[0]).toMatchObject({ command: "04", confirmMode04: true });
      phone.send({ type: "result", id: phone.commands[0]?.id, ok: false, error: "confirmation-denied" });
      expect((await denied).isError).toBe(true);
      let lines = parseRecording(await readFile(join(root, path("mode04")), "latin1"));
      expect(lines.map((line) => line.dir)).toEqual(["meta", "meta"]);
      const approved = kit.client.callTool({ name: "send_command", arguments: { cmd: "04" } }); await commands(phone, 2);
      expect(phone.commands[1]?.confirmMode04).toBe(true); phone.started();
      await waitForLines(root, path("mode04"), 3);
      phone.result("44\r>"); expect((await approved).structuredContent).toMatchObject({ lines: ["44"], ms: 7 });
      const stop = await kit.client.callTool({ name: "stop_recording", arguments: {} });
      expect(stop.structuredContent).toMatchObject({ path: path("mode04"), lines: 4 });
      lines = parseRecording(await readFile(join(root, path("mode04")), "latin1"));
      expect(lines.map((line) => line.dir)).toEqual(["meta", "meta", "tx", "rx"]);
      expect(lines[2]).toMatchObject({ data: "04\r" }); expect(lines[3]).toMatchObject({ data: "44\r>" });
    } finally { await kit.close(); await close(broker, phone); }
  });
  it("uses the real WebSocket broker, serializes exchanges, and records only prompt-terminated raw responses", async () => {
    const { broker, phone, root } = await fixture();
    try {
      const path = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-relay-test.jsonl"; await broker.startRecording(path);
      const first = broker.send("0100"); await expect(broker.send("0100")).rejects.toThrow("busy"); await commands(phone, 1); expect(phone.commands).toHaveLength(1); expect(phone.commands[0]?.confirmMode04).toBe(false);
      phone.started(); phone.result(); await expect(first).resolves.toMatchObject({ ms: 7 }); const stopped = await broker.stopRecording();
      const lines = parseRecording(await readFile(join(root, path), "latin1")); expect(lines.map((line) => line.dir)).toEqual(["meta", "tx", "rx"]); expect(lines[0]?.t).toBe(0); expect(lines.every((line) => Number.isInteger(line.t * 1000) && line.t >= 0)).toBe(true); expect(lines[2]).toMatchObject({ data: raw }); expect(stopped.lines).toBe(3);
      const replay = new ReplayTransport(lines); const replayed: string[] = []; replay.onData((bytes) => replayed.push(Buffer.from(bytes).toString("latin1"))); await replay.write(Buffer.from("0100\r", "latin1")); await delay(0); expect(replayed).toEqual([raw]);
      const partialPath = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-partial.jsonl"; await broker.startRecording(partialPath);
      const partial = broker.send("0100"); await commands(phone, 2); phone.started(); phone.result("4100\r"); await expect(partial).rejects.toThrow("protocol"); await waitForLines(root, partialPath, 3);
      expect(parseRecording(await readFile(join(root, partialPath), "latin1")).map((line) => line.dir)).toEqual(["meta", "tx", "meta"]);
    } finally { await close(broker, phone); }
  });
  it("records denial before start as meta and disconnect after start as tx plus meta", async () => {
    const { broker, phone, root } = await fixture();
    try {
      const path = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-denial.jsonl"; await broker.startRecording(path);
      const denied = broker.send("04"); await commands(phone, 1); expect(phone.commands[0]?.confirmMode04).toBe(true); phone.send({ type: "result", id: phone.commands[0]?.id, ok: false, error: "confirmation-denied" }); await expect(denied).rejects.toThrow("confirmation-denied");
      const pending = broker.send("0100"); await commands(phone, 2); phone.started(); await waitForLines(root, path, 3); phone.close(); await expect(pending).rejects.toThrow("disconnected"); await waitForLines(root, path, 4);
      const lines = parseRecording(await readFile(join(root, path), "latin1")); expect(lines.filter((line) => line.dir === "rx")).toHaveLength(0); expect(lines.filter((line) => line.dir === "tx")).toHaveLength(1); expect(lines.filter((line) => line.dir === "meta")).toHaveLength(3);
    } finally { await close(broker); }
  });
  it("keeps attempted tx and a meta note when the phone reports a write failure", async () => {
    const { broker, phone, root } = await fixture();
    try {
      await broker.startRecording(path("write-failure"));
      const pending = broker.send("0100"); await commands(phone, 1); phone.started();
      phone.send({ type: "result", id: phone.commands[0]?.id, ok: false, error: "transport-error" });
      await expect(pending).rejects.toThrow("transport-error"); const stop = await broker.stopRecording();
      const lines = parseRecording(await readFile(join(root, path("write-failure")), "latin1"));
      expect(lines.map((line) => line.dir)).toEqual(["meta", "tx", "meta"]);
      expect(stop.lines).toBe(3);
    } finally { await close(broker, phone); }
  });
  it("keeps recording time monotonic when the wall clock moves backwards", async () => {
    const { broker, phone, root } = await fixture(); const wallClock = vi.spyOn(Date, "now");
    try {
      wallClock.mockReturnValue(2_000_000); await broker.startRecording(path("clock"));
      const pending = broker.send("0100"); await commands(phone, 1); phone.started(); await waitForLines(root, path("clock"), 2);
      wallClock.mockReturnValue(1); phone.result(); await pending; await broker.stopRecording();
      const times = parseRecording(await readFile(join(root, path("clock")), "latin1")).map((line) => line.t);
      expect(times[0]).toBe(0); expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times.every((t) => t >= 0 && Number.isInteger(t * 1000))).toBe(true);
    } finally { wallClock.mockRestore(); await close(broker, phone); }
  });
  it("rejects invalid protocol traffic without dispatch and accepts a replacement phone", async () => {
    const root = await mkdtemp(join(tmpdir(), "obd-relay-")); const broker = new RelayBroker({ port: 0, root, token: "test-token", logger: () => undefined });
    try {
      while (broker.port() === undefined) await delay(1);
      const bad = new WebSocket(`ws://127.0.0.1:${String(broker.port())}/phone?token=wrong`); await once(bad, "open").catch(() => undefined); await waitFor(() => bad.readyState === WebSocket.CLOSED); expect(broker.isConnected()).toBe(false);
      const phone = await Phone.connect(broker); phone.send({ type: "result", id: "wrong", ok: false, error: "busy" }); await waitFor(() => !broker.isConnected());
      const replacement = await Phone.connect(broker); expect(broker.isConnected()).toBe(true); replacement.close();
    } finally { await broker.close(); }
  });
  it("drives all four MCP tools through an in-memory MCP client", async () => {
    const { broker, phone, root } = await fixture();
    const { server } = createRelayServer(broker); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "test", version: "1" });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.listTools(); expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["list_signals", "send_command", "start_recording", "stop_recording"]);
      for (const [name, required] of [["send_command", "cmd"], ["start_recording", "path"], ["list_signals", "vehicle"]] as const) {
        expect(listed.tools.find((tool) => tool.name === name)?.inputSchema).toMatchObject({ required: [required] });
      }
      expect(listed.tools.find((tool) => tool.name === "stop_recording")?.inputSchema).toMatchObject({ type: "object" });
      for (const [name, args] of [["send_command", {}], ["start_recording", {}], ["list_signals", {}]] as const) {
        expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
      }
      const signals = await client.callTool({ name: "list_signals", arguments: { vehicle: "chevrolet-equinox-ev-2024" } }); expect(signals.structuredContent).toMatchObject({ status: "not-defined-until-T2.1", signals: [] });
      const unknown = await client.callTool({ name: "list_signals", arguments: { vehicle: "other" } }); expect(unknown.isError).toBe(true);
      const recording = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-mcp.jsonl"; expect((await client.callTool({ name: "start_recording", arguments: { path: recording } })).structuredContent).toMatchObject({ path: recording });
      expect((await client.callTool({ name: "start_recording", arguments: { path: path("second") } })).isError).toBe(true);
      const sent = client.callTool({ name: "send_command", arguments: { cmd: "0100" } }); const busy = client.callTool({ name: "send_command", arguments: { cmd: "0100" } }); await commands(phone, 1); phone.started(); phone.result("4100\rNO DATA\r>"); const answer = await sent; expect(answer.structuredContent).toMatchObject({ lines: ["4100", "NO DATA"], ms: 7 }); expect((await busy).isError).toBe(true); expect(phone.commands).toHaveLength(1);
      const stopped = await client.callTool({ name: "stop_recording", arguments: {} }); expect(stopped.structuredContent).toMatchObject({ path: recording, lines: 3 });
      const data = await readFile(join(root, recording)); expect(stopped.structuredContent).toMatchObject({ sha256: createHash("sha256").update(data).digest("hex") });
      expect((await client.callTool({ name: "stop_recording", arguments: {} })).isError).toBe(true);
      expect(parseRecording(data.toString("latin1")).map((line) => line.t)).toEqual([...parseRecording(data.toString("latin1")).map((line) => line.t)].sort((a, b) => a - b));
      await expect(broker.startRecording("../bad.jsonl")).rejects.toThrow(); await symlink(join(root, "x"), join(root, "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-link.jsonl")); await expect(broker.startRecording("fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-link.jsonl")).rejects.toThrow();
      for (const invalid of ["/tmp/a.jsonl", "fixtures/recordings/chevrolet-equinox-ev-2024/../2026-09-23-bad.jsonl", "fixtures\\recordings\\chevrolet-equinox-ev-2024\\2026-09-23-bad.jsonl", path("discovery"), "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-copy.redacted.jsonl", recording]) await expect(broker.startRecording(invalid)).rejects.toThrow();
    } finally { await client.close(); await server.close(); await close(broker, phone); }
  });
  it("rejects unauthenticated and second phones before upgrade", async () => {
    const { broker, phone } = await fixture();
    try { await rejectedSocket(broker, ""); await rejectedSocket(broker, "wrong"); await rejectedSocket(broker, broker.token); expect(broker.isConnected()).toBe(true); expect(phone.commands).toHaveLength(0); }
    finally { await close(broker, phone); }
  });
  it("uses the exact configured environment token instead of test injection", async () => {
    const previous = process.env.OBD_RELAY_TOKEN; process.env.OBD_RELAY_TOKEN = "configured-token";
    const root = await mkdtemp(join(tmpdir(), "obd-relay-")); const broker = new RelayBroker({ port: 0, root, token: "injected-token", logger: () => undefined });
    try {
      expect(broker.token).toBe("configured-token"); await rejectedSocket(broker, "injected-token");
      const socket = await connectRaw(broker, "configured-token"); socket.close();
    } finally {
      await broker.close(); if (previous === undefined) delete process.env.OBD_RELAY_TOKEN; else process.env.OBD_RELAY_TOKEN = previous;
    }
  });
  it("treats an empty OBD_RELAY_TOKEN as unset", async () => {
    const previous = process.env.OBD_RELAY_TOKEN; process.env.OBD_RELAY_TOKEN = "";
    const root = await mkdtemp(join(tmpdir(), "obd-relay-")); const broker = new RelayBroker({ port: 0, root, logger: () => undefined });
    try { expect(broker.token).not.toBe(""); await rejectedSocket(broker, ""); }
    finally { await broker.close(); if (previous === undefined) delete process.env.OBD_RELAY_TOKEN; else process.env.OBD_RELAY_TOKEN = previous; }
  });
  it("rejects a symlinked recording directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "obd-relay-")); await mkdir(join(root, "fixtures/recordings"), { recursive: true }); await mkdir(join(root, "escape"));
    await symlink(join(root, "escape"), join(root, "fixtures/recordings/chevrolet-equinox-ev-2024"));
    const broker = new RelayBroker({ port: 0, root, token: "test-token", logger: () => undefined }); const phone = await Phone.connect(broker);
    try { await expect(broker.startRecording(path("escaped"))).rejects.toThrow("symlink"); }
    finally { await close(broker, phone); }
  });
  it.each(["binary", "pre-hello", "malformed", "wrong-protocol", "oversized"])("rejects %s phone traffic before dispatch", async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "obd-relay-")); const broker = new RelayBroker({ port: 0, root, token: "secret-test-token", logger: () => undefined });
    try {
      const socket = await connectRaw(broker);
      if (kind === "binary") socket.send(Buffer.from([1, 2]));
      if (kind === "pre-hello") socket.send(JSON.stringify({ type: "result", id: "1", ok: false, error: "busy" }));
      if (kind === "malformed") socket.send("{");
      if (kind === "wrong-protocol") socket.send(JSON.stringify({ ...hello, protocol: 2 }));
      if (kind === "oversized") socket.send("x".repeat(1024 * 1024 + 1));
      await waitFor(() => socket.readyState === WebSocket.CLOSED);
      expect(broker.isConnected()).toBe(false);
      await expect(broker.send("0100")).rejects.toThrow("disconnected");
    } finally { await broker.close(); }
  });
  it.each(["wrong-id", "duplicate-result", "duplicate-started", "result-before-started", "invalid-base64", "negative-ms", "two-prompts"])("rejects %s while settling only the pending request", async (kind) => {
    const { broker, phone } = await fixture();
    try {
      const pending = broker.send("0100"); await commands(phone, 1); const command = phone.commands[0];
      if (kind === "wrong-id") phone.send({ type: "started", id: "wrong" });
      if (kind === "invalid-base64") { phone.started(command); phone.send({ type: "result", id: command.id, ok: true, dataBase64: "%%%", ms: 1 }); }
      if (kind === "negative-ms") { phone.started(command); phone.result(raw, -1, command); }
      if (kind === "two-prompts") { phone.started(command); phone.result("STOPPED\r>OK\r\r>", 1, command); }
      if (kind === "duplicate-started") { phone.started(command); phone.started(command); }
      if (kind === "result-before-started") phone.result(raw, 1, command);
      if (kind === "duplicate-result") { phone.started(command); phone.result(raw, 1, command); phone.result(raw, 1, command); await expect(pending).resolves.toMatchObject({ ms: 1 }); }
      else await expect(pending).rejects.toThrow("protocol");
      await waitFor(() => !broker.isConnected()); expect(phone.commands).toHaveLength(1);
    } finally { await close(broker); }
  });
  it("rejects noncanonical base64 padding before resolving the pending command", async () => {
    const { broker, phone, root } = await fixture();
    try {
      await broker.startRecording(path("noncanonical-base64"));
      const pending = broker.send("0100"); await commands(phone, 1); const command = phone.commands[0]; phone.started(command);
      phone.send({ type: "result", id: command.id, ok: true, dataBase64: "NDEwMA0+=", ms: 1 });
      await expect(pending).rejects.toThrow("protocol"); await waitFor(() => !broker.isConnected());
      expect(parseRecording(await readFile(join(root, path("noncanonical-base64")), "latin1")).map((line) => line.dir)).toEqual(["meta", "tx", "meta"]);
    } finally { await close(broker); }
  });
  it("rejects a pending MCP call on disconnect and accepts a replacement phone", async () => {
    const { broker, phone, root } = await fixture(); const kit = await mcp(broker);
    try {
      await kit.client.callTool({ name: "start_recording", arguments: { path: path("replacement") } });
      const pending = kit.client.callTool({ name: "send_command", arguments: { cmd: "0100" } }); await commands(phone, 1); phone.started(); await waitForLines(root, path("replacement"), 2); phone.close();
      expect((await pending).isError).toBe(true); await waitFor(() => !broker.isConnected());
      expect(parseRecording(await readFile(join(root, path("replacement")), "latin1")).map((line) => line.dir)).toEqual(["meta", "tx", "meta"]);
      expect((await kit.client.callTool({ name: "send_command", arguments: { cmd: "0100" } })).isError).toBe(true);
      const replacement = await Phone.connect(broker); await prime(broker, replacement);
      try { const sent = kit.client.callTool({ name: "send_command", arguments: { cmd: "0100" } }); await commands(replacement, 1); replacement.started(); replacement.result(); expect((await sent).structuredContent).toMatchObject({ lines: ["4100 BE 1F A8 13"] }); }
      finally { replacement.close(); }
    } finally { await kit.close(); await close(broker); }
  });
  it("rejects a pending call when the server socket reports an error", async () => {
    const { broker, phone } = await fixture();
    try {
      const pending = broker.send("0100"); await commands(phone, 1); phone.started();
      const socket = Reflect.get(broker, "phone") as WebSocket;
      socket.emit("error", new Error("synthetic socket failure"));
      await expect(pending).rejects.toThrow("disconnected"); await waitFor(() => !broker.isConnected());
      await waitFor(() => phone.socket.readyState === WebSocket.CLOSED);
    } finally { await close(broker); }
  });
  it("appends the disconnect meta before the pending call rejects", async () => {
    const { broker, phone, root } = await fixture();
    try {
      await broker.startRecording(path("disconnect-order"));
      const pending = broker.send("0100"); await commands(phone, 1); phone.started(); await waitForLines(root, path("disconnect-order"), 2); phone.close();
      await expect(pending).rejects.toThrow("disconnected");
      expect(parseRecording(readFileSync(join(root, path("disconnect-order")), "latin1")).map((line) => line.dir)).toEqual(["meta", "tx", "meta"]);
    } finally { await close(broker); }
  });
  it("hil:smoke reports a mid-sequence disconnect, keeps the final meta, and closes the broker", async () => {
    const { broker, phone, root } = await fixture(false); const dir = join(root, "fixtures/recordings/chevrolet-equinox-ev-2024");
    try {
      const run = hilSmoke(broker);
      await commands(phone, 1); phone.started(); phone.result(banner);
      await commands(phone, 2); phone.started(); phone.result("OK\r\r>");
      await commands(phone, 3); phone.started();
      const [file] = await readdir(dir);
      await waitForLines(root, `fixtures/recordings/chevrolet-equinox-ev-2024/${file}`, 6); phone.close();
      await expect(run).rejects.toThrow("relay: disconnected");
      expect(broker.port()).toBeUndefined();
      const lines = parseRecording(readFileSync(join(dir, file), "latin1"));
      expect(lines.map((line) => line.dir)).toEqual(["meta", "tx", "rx", "tx", "rx", "tx", "meta"]);
      expect(lines.at(-1)).toMatchObject({ note: "phone relay: disconnected" });
    } finally { await close(broker); }
  });
});

describe("shared write guard at the broker (amendment 2026-09-24)", () => {
  // F1–F4: guard-refused commands, Mode 04 variants, and Mode 06 never reach the phone, and each refusal is logged once.
  it.each(["", "   ", "ATCAF0", "ATPP 24 SV FF", "ATMA", "08 01", "11 01", "14 FF FF FF", "2E1234", "0100FF", "014FFFFFF1", "01", "01\r00", "04FF", "0400", "044", "0600"])("T1 refuses %j before the phone and logs it", async (command) => {
    const { broker, phone, logs } = await fixture();
    try {
      const before = logs.length; await refused(broker, phone, command);
      const added = logs.slice(before); expect(added).toHaveLength(1); expect(added[0]).toContain(JSON.stringify(command));
    } finally { await close(broker, phone); }
  });
  it("T1 dispatches ATAT1, which the guard allows", async () => {
    const { broker, phone, logs } = await fixture();
    try { const before = logs.length; await exchange(broker, phone, "ATAT1", "OK\r\r>"); expect(phone.commands).toHaveLength(1); expect(logs).toHaveLength(before); }
    finally { await close(broker, phone); }
  });
  it("T2 derives the policy again for a hand-built RelayCommand", async () => {
    const { broker, phone } = await fixture();
    try {
      await expect(broker.request({ command: "ATCAF0", confirmation: "none" }).result).rejects.toThrow("relay: refused"); await delay(5); expect(phone.commands).toHaveLength(0);
      const clear = broker.request({ command: "04", confirmation: "none" } as never); await commands(phone, 1);
      expect(phone.commands[0]).toMatchObject({ command: "04", confirmMode04: true });
      phone.send({ type: "result", id: phone.commands[0]?.id, ok: false, error: "confirmation-denied" }); await expect(clear.result).rejects.toThrow("confirmation-denied");
    } finally { await close(broker, phone); }
  });
  it("T3 applies the header/protocol sequence rule", async () => {
    const { broker, phone } = await fixture();
    try {
      await refused(broker, phone, "ATSH DA1DF1"); await refused(broker, phone, "ATSP6");
      await exchange(broker, phone, "ATZ", banner); await exchange(broker, phone, "ATSP7", "OK\r\r>"); await exchange(broker, phone, "ATSH DA1DF1", "OK\r\r>");
      await refused(broker, phone, "ATSP6"); await exchange(broker, phone, "ATSP7", "OK\r\r>");
      expect(phone.commands.map((c) => c.command)).toEqual(["ATZ", "ATSP7", "ATSH DA1DF1", "ATSP7"]);
    } finally { await close(broker, phone); }
  });
  it("T4 does not count a ? reply as ATSP7 confirmation", async () => {
    const { broker, phone } = await fixture(false);
    try { await exchange(broker, phone, "ATZ", banner); await exchange(broker, phone, "ATSP7", "?\r\r>"); await exchange(broker, phone, "ATI", version); await refused(broker, phone, "ATSH DA1DF1", "header/protocol sequence"); }
    finally { await close(broker, phone); }
  });
  it("T8 keeps the in-flight state when ATSP7 fails with a phone timeout", async () => {
    const { broker, phone } = await fixture(false);
    try {
      await exchange(broker, phone, "ATZ", banner);
      const failed = broker.send("ATSP7"); await commands(phone, 2); phone.started(); phone.send({ type: "result", id: phone.commands[1]?.id, ok: false, error: "timeout" }); await expect(failed).rejects.toThrow("timeout");
      await exchange(broker, phone, "ATI", version); await refused(broker, phone, "ATSH DA1DF1", "header/protocol sequence");
    } finally { await close(broker, phone); }
  });
  it("T5 forgets header state on reconnect", async () => {
    const { broker, phone } = await fixture();
    try {
      await exchange(broker, phone, "ATZ", banner); await exchange(broker, phone, "ATSP7", "OK\r\r>"); phone.close(); await waitFor(() => !broker.isConnected());
      const next = await Phone.connect(broker); await prime(broker, next);
      try { await refused(broker, next, "ATSH DA1DF1"); } finally { next.close(); }
    } finally { await close(broker); }
  });
  it("T6 admits only ATI or ATZ first on a new connection", async () => {
    const { broker, phone } = await fixture(false);
    try { await refused(broker, phone, "0100"); await refused(broker, phone, "ATE0"); await exchange(broker, phone, "ATI", version); await exchange(broker, phone, "0100", raw); expect(phone.commands.map((c) => c.command)).toEqual(["ATI", "0100"]); }
    finally { await close(broker, phone); }
  });
  it.each(["timeout", "transport-error", "STOPPED"])("T7 admits only ATI or ATZ after %s", async (kind) => {
    const { broker, phone } = await fixture(false);
    try {
      await exchange(broker, phone, "ATI", version);
      if (kind === "STOPPED") await exchange(broker, phone, "ATZ", "STOPPED\r\r>");
      else { const failed = broker.send("0100"); await commands(phone, 2); phone.started(); phone.send({ type: "result", id: phone.commands[1]?.id, ok: false, error: kind }); await expect(failed).rejects.toThrow(kind); }
      await refused(broker, phone, "0100"); await exchange(broker, phone, "ATI", version);
    } finally { await close(broker, phone); }
  });
});
