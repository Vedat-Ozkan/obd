import { createHash, randomBytes } from "node:crypto";
import { appendFile, lstat, mkdir, open, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { afterReply, beforeWrite, normalize, UNKNOWN_STATE, type HeaderState } from "../../packages/obd-core/src/elm/guard.js";
import { parseElmResponse } from "../../packages/obd-core/src/elm/reader.js";
import { authorizeRelayCommand, type RelayCommand, type RelayCommandChannel, type RelayCommandExchange } from "../../packages/obd-core/src/transport/relay.js";

const vehicle = "chevrolet-equinox-ev-2024" as const;
const helloSchema = z.object({ type: z.literal("hello"), protocol: z.literal(1), vehicle: z.literal(vehicle), dongle: z.literal("veepeak-obdcheck-ble"), writeChar: z.string(), notifyChar: z.string(), mtu: z.number().int().positive() });
const startedSchema = z.object({ type: z.literal("started"), id: z.string() });
const resultSchema = z.looseObject({ type: z.literal("result"), id: z.string(), ok: z.boolean() });
const successfulResultSchema = z.object({ type: z.literal("result"), id: z.string(), ok: z.literal(true), dataBase64: z.string(), ms: z.number() });
const failedResultSchema = z.object({ type: z.literal("result"), id: z.string(), ok: z.literal(false), error: z.enum(["confirmation-denied", "busy", "disconnected", "invalid-command", "transport-error", "timeout"]) });
type Hello = z.infer<typeof helloSchema>;

interface Pending { id: string; command: RelayCommand; resolveStarted: () => void; rejectStarted: (error: Error) => void; resolveResult: (value: { bytes: Uint8Array; ms: number }) => void; rejectResult: (error: Error) => void; started: boolean; }
interface Recording { path: string; startedAt: bigint; lastT: number; lines: number; chain: Promise<void>; }
export interface BrokerOptions { port?: number; token?: string; root?: string; logger?: (line: string) => void; }

export class RelayBroker implements RelayCommandChannel {
  readonly token: string;
  readonly root: string;
  private readonly http = createServer((_, response) => { response.writeHead(404); response.end(); });
  private readonly ws: WebSocketServer;
  private phone: WebSocket | undefined;
  private hello: Hello | undefined;
  private pending: Pending | undefined;
  private recording: Recording | undefined;
  private serial = 0;
  private messages: Promise<void> = Promise.resolve();
  private readonly logger: (line: string) => void;
  // Per phone connection, reset on hello: what the ELM may hold (guard.ts sequence rule), and whether its last
  // exchange ended in a clean '>' reply. The stale rule: docs/ELM327.md §Write safety, Input rules.
  private header: HeaderState = UNKNOWN_STATE;
  private idle = false;

  constructor(options: BrokerOptions = {}) {
    // An empty OBD_RELAY_TOKEN (a blank .env line) is unset; it must never become the token.
    const configured = process.env.OBD_RELAY_TOKEN;
    this.token = (configured === "" ? undefined : configured) ?? options.token ?? randomBytes(32).toString("base64url");
    this.root = resolve(options.root ?? process.cwd());
    this.logger = options.logger ?? ((line) => process.stderr.write(line + "\n"));
    this.ws = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1024 * 1024 });
    this.http.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://relay");
      if (url.pathname !== "/phone" || url.searchParams.get("token") !== this.token || this.phone !== undefined) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
      this.ws.handleUpgrade(request, socket, head, (client) => { this.accept(client); });
    });
    this.http.listen(options.port ?? numberEnv("OBD_RELAY_PORT", 8765), "0.0.0.0", () => {
      const address = this.http.address(); const port = typeof address === "object" && address ? address.port : options.port ?? 8765;
      this.logger(`phone setup: ws://<host>:${String(port)}/phone?token=${this.token}`);
    });
  }

  port(): number | undefined { const address = this.http.address(); return typeof address === "object" && address ? address.port : undefined; }
  // The caller's confirmation is ignored: dispatch derives the policy again from the text.
  request(command: RelayCommand): RelayCommandExchange { return this.dispatch(command.command); }
  async send(commandText: string): Promise<{ bytes: Uint8Array; ms: number }> { const exchange = this.dispatch(commandText); await exchange.started; return exchange.result; }
  async startRecording(path: string): Promise<{ path: string }> {
    if (!this.isConnected() || this.hello === undefined) throw new Error("relay: disconnected");
    if (this.recording !== undefined) throw new Error("relay: recording already active");
    const full = await this.validatePath(path); await mkdir(resolve(full, ".."), { recursive: true }); const handle = await open(full, "wx"); await handle.close();
    const recording: Recording = { path: full, startedAt: process.hrtime.bigint(), lastT: 0, lines: 0, chain: Promise.resolve() }; this.recording = recording;
    await this.append(recording, { dir: "meta", vehicle: this.hello.vehicle, dongle: this.hello.dongle, writeChar: this.hello.writeChar, notifyChar: this.hello.notifyChar, mtu: this.hello.mtu, note: "phone relay; raw original; redact before commit" }, true);
    return { path };
  }
  async stopRecording(): Promise<{ path: string; sha256: string; lines: number }> {
    const recording = this.recording; if (recording === undefined) throw new Error("relay: no recording active"); this.recording = undefined; await recording.chain;
    const data = await readFile(recording.path); return { path: relativeToRoot(this.root, recording.path), sha256: createHash("sha256").update(data).digest("hex"), lines: recording.lines };
  }
  async close(): Promise<void> { const phone = this.phone; await this.enqueue(() => this.disconnect(phone, new Error("relay: closed"))); phone?.close(); await new Promise<void>((resolveClose) => { this.http.close(() => { resolveClose(); }); }); }
  isConnected(): boolean { return this.phone !== undefined && this.hello !== undefined; }

  /** The single check for every phone-bound command. */
  private dispatch(text: string): RelayCommandExchange {
    let command: RelayCommand;
    try { command = authorizeRelayCommand(text); } catch (error) { return this.refuse(text, error instanceof Error ? error.message : "relay: refused"); }
    if (!this.isConnected()) return rejectedExchange("relay: disconnected");
    if (this.pending !== undefined) return rejectedExchange("relay: busy");
    const norm = normalize(command.command);
    // A busy ELM drops the first character; the datasheet does not bound how many, and ATI/ATZ leave no hex behind.
    if (!this.idle && norm !== "ATI" && norm !== "ATZ") return this.refuse(text, "relay: refused, ELM state unknown; send ATI or ATZ first");
    const inFlight = beforeWrite(this.header, norm);
    if (inFlight === undefined) return this.refuse(text, "relay: refused, header/protocol sequence");
    this.header = inFlight;
    const id = String(++this.serial);
    let resolveStarted!: () => void; let rejectStarted!: (error: Error) => void; let resolveResult!: (value: { bytes: Uint8Array; ms: number }) => void; let rejectResult!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
    const result = new Promise<{ bytes: Uint8Array; ms: number }>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    void started.catch(() => undefined); void result.catch(() => undefined);
    const pending: Pending = { id, command, resolveStarted, rejectStarted, resolveResult, rejectResult, started: false };
    this.pending = pending;
    try { this.phone?.send(JSON.stringify({ type: "command", id, command: command.command, confirmMode04: command.confirmation === "on-phone" })); }
    catch { this.failPending(pending, new Error("relay: transport-error")); }
    return { started, result };
  }

  private refuse(text: string, reason: string): RelayCommandExchange { this.logger(`${reason}: ${JSON.stringify(text)}`); return rejectedExchange(reason); }
  private accept(socket: WebSocket): void {
    this.phone = socket;
    socket.on("message", (data, isBinary) => {
      if (isBinary || (typeof data === "object" && !Buffer.isBuffer(data))) { void this.enqueue(() => this.protocolError(socket)); return; }
      void this.enqueue(() => this.onMessage(socket, Buffer.from(data).toString("utf8")));
    });
    socket.on("error", () => { void this.enqueue(async () => { try { await this.disconnect(socket, new Error("relay: disconnected")); } finally { socket.close(); } }); });
    socket.on("close", () => { void this.enqueue(() => this.disconnect(socket, new Error("relay: disconnected"))); });
  }
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.messages.then(task, task);
    this.messages = next.catch(async () => { const phone = this.phone; if (phone !== undefined) await this.protocolError(phone); });
    return this.messages;
  }
  private async onMessage(socket: WebSocket, text: string): Promise<void> {
    if (socket !== this.phone) return;
    let value: unknown; try { value = JSON.parse(text); } catch { await this.protocolError(socket); return; }
    if (this.hello === undefined) { const parsed = helloSchema.safeParse(value); if (!parsed.success) await this.protocolError(socket); else { this.hello = parsed.data; this.header = UNKNOWN_STATE; this.idle = false; } return; }
    const envelope = resultSchema.safeParse(value); const started = startedSchema.safeParse(value); const pending = this.pending;
    const id = started.success ? started.data.id : envelope.success ? envelope.data.id : undefined;
    if (pending === undefined || id !== pending.id) { await this.protocolError(socket); return; }
    if (started.success) {
      if (pending.started) { await this.protocolError(socket); return; }
      pending.started = true; this.idle = false; await this.record("tx", pending.command.command + "\r"); if (this.pending === pending) pending.resolveStarted(); return;
    }
    if (!envelope.success) { await this.protocolError(socket); return; }
    const failure = failedResultSchema.safeParse(value);
    if (failure.success) { await this.recordMeta({ note: `phone relay: ${failure.data.error}` }); this.failPending(pending, new Error(`relay: ${failure.data.error}`)); return; }
    const success = successfulResultSchema.safeParse(value);
    if (!success.success || !pending.started || !Number.isFinite(success.data.ms) || success.data.ms < 0) { await this.protocolError(socket); return; }
    const bytes = decodeBase64(success.data.dataBase64);
    if (bytes === undefined || bytes.byteLength > 1024 * 1024 || bytes.at(-1) !== 0x3e || bytes.indexOf(0x3e) !== bytes.byteLength - 1) { await this.protocolError(socket); return; }
    await this.record("rx", Buffer.from(bytes).toString("latin1"));
    if (this.pending !== pending) return;
    const norm = normalize(pending.command.command);
    const kind = parseElmResponse(Buffer.from(bytes.subarray(0, -1)).toString("latin1"), pending.command.command).status.kind;
    this.header = afterReply(this.header, norm, kind); this.idle = kind !== "error";
    this.pending = undefined; pending.resolveResult({ bytes, ms: success.data.ms });
  }
  private async disconnect(socket: WebSocket | undefined, error: Error): Promise<void> {
    if (socket !== undefined && socket !== this.phone) return;
    // The final meta is on disk before any caller sees the rejection.
    this.phone = undefined; this.hello = undefined; try { await this.endRecording("phone relay: disconnected"); } finally { this.failPending(this.pending, error); }
  }
  private failPending(pending: Pending | undefined, error: Error): void { if (pending === undefined || this.pending !== pending) return; this.pending = undefined; pending.rejectStarted(error); pending.rejectResult(error); }
  private async protocolError(socket: WebSocket): Promise<void> { if (socket !== this.phone) return; try { await this.disconnect(socket, new Error("relay: protocol error")); } finally { socket.close(); } }
  private async endRecording(note: string): Promise<void> { const recording = this.recording; if (recording === undefined) return; this.recording = undefined; await this.append(recording, { dir: "meta", note }); await recording.chain; }
  private async record(dir: "tx" | "rx", data: string): Promise<void> { const recording = this.recording; if (recording !== undefined) await this.append(recording, { dir, data }); }
  private async recordMeta(meta: Record<string, unknown>): Promise<void> { const recording = this.recording; if (recording !== undefined) await this.append(recording, { dir: "meta", ...meta }); }
  private async append(recording: Recording, line: Record<string, unknown>, initial = false): Promise<void> {
    recording.chain = recording.chain.then(async () => { const elapsedMs = Number((process.hrtime.bigint() - recording.startedAt) / 1_000_000n); const t = initial ? 0 : Math.max(recording.lastT, Math.round(elapsedMs) / 1000); recording.lastT = t; await appendFile(recording.path, JSON.stringify({ t, ...line }) + "\n", "latin1"); recording.lines++; });
    return recording.chain;
  }
  private async validatePath(input: string): Promise<string> {
    if (!/^fixtures\/recordings\/chevrolet-equinox-ev-2024\/\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.jsonl$/.test(input) || input.includes("discovery") || input.endsWith(".redacted.jsonl")) throw new Error("relay: invalid recording path");
    const full = resolve(this.root, input); if (!full.startsWith(resolve(this.root, "fixtures", "recordings") + sep)) throw new Error("relay: invalid recording path");
    for (const part of ["fixtures", "fixtures/recordings", "fixtures/recordings/chevrolet-equinox-ev-2024"]) {
      try { if ((await lstat(resolve(this.root, part))).isSymbolicLink()) throw new Error("relay: symlink in recording path"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    try { const status = await lstat(full); if (status.isSymbolicLink() || status.isFile()) throw new Error("relay: recording exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return full;
  }
}
function decodeBase64(input: string): Uint8Array | undefined { try { const bytes = Uint8Array.from(Buffer.from(input, "base64")); return Buffer.from(bytes).toString("base64") === input ? bytes : undefined; } catch { return undefined; } }
function numberEnv(name: string, fallback: number): number { const value = process.env[name]; const parsed = value === undefined ? fallback : Number(value); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`relay: invalid ${name}`); return parsed; }
function rejectedExchange(message: string): RelayCommandExchange { const error = new Error(message); const started = Promise.reject(error); const result = Promise.reject(error); void started.catch(() => undefined); void result.catch(() => undefined); return { started, result }; }
function relativeToRoot(root: string, path: string): string { return path.slice(root.length + 1); }
