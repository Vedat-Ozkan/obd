import { fromByteArray } from "base64-js";
import { latin1Encode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { authorizeRelayCommand } from "obd-core/transport/relay";

// Wire messages: docs/specs/T0.6a-node-relay-mcp.md §Interfaces, tools/relay/broker.ts. Framing: docs/ELM327.md §Framing.
const OPEN = 1;
const PROMPT = 0x3e;

export interface RelayWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
  removeEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
}

export interface RelayPhoneMeta {
  vehicle: "chevrolet-equinox-ev-2024";
  dongle: "veepeak-obdcheck-ble";
  writeChar: string;
  notifyChar: string;
  mtu: number;
}

export type ConfirmMode04 = () => Promise<boolean>;

type FailureCode = "confirmation-denied" | "busy" | "invalid-command" | "transport-error" | "timeout";
interface Inbound { id: string; command: string; confirmMode04: boolean }
interface Pending { id: string; writing: boolean; chunks: Uint8Array[]; timer?: ReturnType<typeof setTimeout>; startedAt: number }

function parseCommand(data: unknown): Inbound | undefined {
  if (typeof data !== "string") return undefined;
  let value: unknown;
  try { value = JSON.parse(data); } catch { return undefined; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || record.type !== "command") return undefined;
  if (typeof record.id !== "string" || record.id === "" || typeof record.command !== "string" || typeof record.confirmMode04 !== "boolean") return undefined;
  return { id: record.id, command: record.command, confirmMode04: record.confirmMode04 };
}

/** Bridges one authenticated relay socket to one BLE transport, one command at a time. The caller owns the socket and the BLE link. */
export class RelayClient {
  private readonly seen = new Set<string>();
  private pending: Pending | undefined;
  private ended = false;
  // Set once a timeout, a possibly partial write or stray RX means the ELM may still be busy (docs/ELM327.md §Write safety).
  private dirty = false;
  private readonly unsubscribe: () => void;
  private readonly onOpen = () => { this.opened = true; this.sendJson({ type: "hello", protocol: 1, ...this.meta }); };
  private readonly onMessage = (event: unknown) => { this.receive((event as { data?: unknown } | null)?.data); };
  private readonly onSocketEnd = () => { this.end(); };
  private opened = false;

  constructor(
    private readonly socket: RelayWebSocket,
    private readonly transport: Transport,
    private readonly meta: RelayPhoneMeta,
    private readonly confirmMode04: ConfirmMode04,
    private readonly timeoutMs = 20_000,
    private readonly nowMs: () => number = () => performance.now(),
    private readonly onTerminal?: (bleUncertain: boolean) => void,
    // Not in the T0.6b interface: lets the screen show "busy <command>" and know a command is unresolved.
    private readonly onActivity?: (command: string | undefined) => void,
  ) {
    // One subscription for the client's life, so data outside a pending exchange is seen and not lost.
    this.unsubscribe = transport.onData((bytes) => { this.onBytes(bytes); });
    socket.addEventListener("open", this.onOpen);
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("error", this.onSocketEnd);
    socket.addEventListener("close", this.onSocketEnd);
    if (socket.readyState === OPEN) this.onOpen();
  }

  close(): void {
    if (this.ended) return;
    this.finish();
  }

  private finish(): void {
    this.ended = true;
    if (this.pending?.timer !== undefined) clearTimeout(this.pending.timer);
    this.pending = undefined;
    this.unsubscribe();
    this.socket.removeEventListener("open", this.onOpen);
    this.socket.removeEventListener("message", this.onMessage);
    this.socket.removeEventListener("error", this.onSocketEnd);
    this.socket.removeEventListener("close", this.onSocketEnd);
  }

  // Uncertain when a command or alert was unresolved, or a timeout, partial write or stray RX happened.
  private end(): void {
    if (this.ended) return;
    const uncertain = this.pending !== undefined || this.dirty;
    this.finish();
    this.onTerminal?.(uncertain);
  }

  private sendJson(message: Record<string, unknown>): boolean {
    if (this.ended) return false;
    try {
      if (this.socket.readyState !== OPEN) throw new Error("relay socket is not open");
      this.socket.send(JSON.stringify(message));
      return true;
    } catch { this.end(); return false; }
  }

  private fail(id: string, error: FailureCode): boolean { return this.sendJson({ type: "result", id, ok: false, error }); }

  private setPending(next: Pending | undefined, command?: string): void {
    this.pending = next;
    this.onActivity?.(command);
  }

  private receive(data: unknown): void {
    if (this.ended) return;
    const message = this.opened ? parseCommand(data) : undefined;
    // Anything the broker would not send ends the session: a compromised peer gets no second try.
    if (message === undefined || this.seen.has(message.id)) { this.end(); return; }
    this.seen.add(message.id);
    if (this.pending !== undefined) { this.fail(message.id, "busy"); return; }
    let authorized;
    try { authorized = authorizeRelayCommand(message.command); } catch { this.fail(message.id, "invalid-command"); return; }
    if (message.confirmMode04 !== (authorized.confirmation === "on-phone")) { this.fail(message.id, "invalid-command"); return; }
    const pending: Pending = { id: message.id, writing: false, chunks: [], startedAt: 0 };
    this.setPending(pending, authorized.command);
    void this.run(pending, authorized.command, authorized.confirmation === "on-phone");
  }

  private async run(pending: Pending, command: string, needsConfirm: boolean): Promise<void> {
    if (needsConfirm) {
      let approved = false;
      try { approved = await this.confirmMode04(); } catch { approved = false; }
      // close() or a socket end while the alert was open invalidates it.
      if (this.ended || this.pending !== pending) return;
      if (!approved) { this.setPending(undefined); this.fail(pending.id, "confirmation-denied"); return; }
    }
    pending.startedAt = this.nowMs();
    pending.timer = setTimeout(() => { this.settleFailure(pending, "timeout"); }, this.timeoutMs);
    pending.writing = true;
    // started goes out before the write so the broker records tx first.
    if (!this.sendJson({ type: "started", id: pending.id })) return;
    const bytes = latin1Encode(`${command}\r`);
    try { await this.transport.write(bytes); }
    catch { if (!this.ended && this.pending === pending) this.settleFailure(pending, "transport-error"); }
  }

  // A timeout or a failed write leaves the ELM possibly busy, so the client ends and the screen closes BLE.
  private settleFailure(pending: Pending, error: FailureCode): void {
    if (this.ended || this.pending !== pending) return;
    this.dirty = true;
    this.fail(pending.id, error);
    this.end();
  }

  private onBytes(bytes: Uint8Array): void {
    const pending = this.pending;
    if (this.ended) return;
    if (pending === undefined || !pending.writing) { this.dirty = true; this.end(); return; }
    const prompt = bytes.indexOf(PROMPT);
    if (prompt < 0) { pending.chunks.push(bytes.slice()); return; }
    pending.chunks.push(bytes.slice(0, prompt + 1));
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    const total = pending.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const all = new Uint8Array(total); let offset = 0;
    for (const chunk of pending.chunks) { all.set(chunk, offset); offset += chunk.length; }
    const ms = Math.max(0, this.nowMs() - pending.startedAt);
    this.setPending(undefined);
    const sent = this.sendJson({ type: "result", id: pending.id, ok: true, dataBase64: fromByteArray(all), ms });
    // Bytes after the first prompt belong to no request.
    if (sent && prompt < bytes.length - 1) { this.dirty = true; this.end(); }
  }
}
