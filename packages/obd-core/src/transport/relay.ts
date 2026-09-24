import { allowedCommand, NON_PRINTABLE, normalize } from "../elm/guard.js";
import type { Transport } from "./types.js";

export type RelayCommand =
  | { command: string; confirmation: "none" }
  | { command: "04"; confirmation: "on-phone" };

// The allowlist is Elm327Session's (docs/ELM327.md §Write safety), plus two relay deltas: exact 04 goes to
// the phone for on-phone confirmation (AGENTS.md hard rule 5, ADR-013), and Mode 06 is refused until T0.7
// sources its request length. Spec: docs/specs/T0.6a-node-relay-mcp.md, amendment 2026-09-24, decision 1.
export function authorizeRelayCommand(input: string): RelayCommand {
  const refused = new Error("relay: refused, not on the read-only allowlist");
  if (NON_PRINTABLE.test(input)) throw refused;
  const command = input.trim();
  if (normalize(command) === "04") return { command: "04", confirmation: "on-phone" };
  if (allowedCommand(command) === undefined) throw refused;
  if (normalize(command).startsWith("06")) throw new Error("relay: refused, Mode 06 is not exposed");
  return { command, confirmation: "none" };
}

export interface RelayCommandExchange { started: Promise<void>; result: Promise<{ bytes: Uint8Array; ms: number }>; }
export interface RelayCommandChannel { request(command: RelayCommand): RelayCommandExchange; close(): Promise<void>; }

export class RelayTransport implements Transport {
  private readonly data = new Set<(bytes: Uint8Array) => void>();
  private readonly errors = new Set<(error: Error) => void>();
  private busy = false;
  private closed = false;
  constructor(private readonly channel: RelayCommandChannel) {}
  write(bytes: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error("relay: transport is closed"));
    if (this.busy) return Promise.reject(new Error("relay: busy"));
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    if (!/^[\x20-\x7e]+\r$/.test(text) || text.slice(0, -1).includes("\r")) return Promise.reject(new Error("relay: expected one command ending CR"));
    let command: RelayCommand;
    try { command = authorizeRelayCommand(text.slice(0, -1)); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error("relay: authorization failed")); }
    this.busy = true;
    const exchange = this.channel.request(command);
    void exchange.result.then(({ bytes: reply }) => { for (const cb of this.data) cb(reply); }, (error: unknown) => {
      const e = error instanceof Error ? error : new Error("relay: request failed"); for (const cb of this.errors) cb(e);
    }).finally(() => { this.busy = false; });
    return exchange.started;
  }
  onData(callback: (bytes: Uint8Array) => void): () => void { this.data.add(callback); return () => this.data.delete(callback); }
  onError(callback: (error: Error) => void): () => void { this.errors.add(callback); return () => this.errors.delete(callback); }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; this.data.clear(); this.errors.clear(); await this.channel.close(); }
}
