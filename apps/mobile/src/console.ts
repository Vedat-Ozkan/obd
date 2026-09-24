import { ElmLineReader } from "obd-core/elm";
import { latin1Encode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import type { RecordingBuffer } from "./recording.js";

// Sources: docs/ELM327.md §Standard modes used (04 is a write) and §Init sequence; AGENTS.md hard rule 5.
export const READ_ONLY_SERVICES: readonly string[] = ["01", "02", "03", "06", "07", "09", "0A", "22"];
export const ALLOWED_AT_COMMANDS: readonly string[] = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATDPN", "ATRV"];

export function normalizeReadOnlyCommand(input: string): string {
  // Tabs, CR, and LF count as control characters: a CR inside the input would send a second command.
  if (/[^\x20-\x7e]/.test(input)) throw new Error("Command must contain printable ASCII only");
  const command = input.trim().toUpperCase().replace(/ +/g, " ");
  if (ALLOWED_AT_COMMANDS.includes(command)) return command;
  const hex = command.replace(/ /g, "");
  if (!hex || !/^[0-9A-F]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("Command must be complete hexadecimal bytes");
  if (!READ_ONLY_SERVICES.includes(hex.slice(0, 2))) {
    throw new Error("Command service is not read-only");
  }
  return hex;
}

export class ConsoleSession {
  private readonly reader = new ElmLineReader();
  private readonly unsubscribe: () => void;
  private pending?: { command: string; resolve: (response: string) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> };
  // After a timeout or failed write the ELM may still be busy; a write then would be cut short (docs/ELM327.md §Write safety).
  private stale = false;
  private isClosed = false;
  private readonly promptWaiters = new Set<(prompted: boolean) => void>();

  constructor(private readonly transport: Transport, private readonly recording: RecordingBuffer, private readonly timeoutMs = 20_000) {
    // Every notification is recorded, including late ones after a timeout, so the file shows what the dongle sent.
    this.unsubscribe = transport.onData((bytes) => {
      this.recording.rx(bytes);
      const responses = this.reader.push(bytes);
      if (responses.length === 0) return;
      if (this.pending) { this.finish(responses[0]); return; }
      this.stale = false;
      this.settleWaiters(true);
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** Resolves true at once when no timeout/write failure is outstanding; otherwise true on the next '>', false after `ms` or on close(). */
  waitForPrompt(ms: number): Promise<boolean> {
    if (!this.stale) return Promise.resolve(true);
    if (this.isClosed) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const waiter = (prompted: boolean) => { clearTimeout(timer); this.promptWaiters.delete(waiter); resolve(prompted); };
      const timer = setTimeout(() => { waiter(false); }, ms);
      this.promptWaiters.add(waiter);
    });
  }

  async send(input: string): Promise<string> {
    if (this.pending) throw new Error("Console is busy");
    const command = normalizeReadOnlyCommand(input);
    if (this.isClosed) throw new Error("Console session closed");
    if (this.stale) throw new Error("Waiting for '>' after a timeout or failed write");
    // tx is recorded before the write starts so a fast reply can never precede it in the file.
    this.recording.tx(`${command}\r`);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending) return;
        this.recording.meta(`timeout waiting for '>' after ${command}`);
        this.reader.reset();
        this.stale = true;
        this.fail(new Error(`Timed out waiting for response to ${command}`));
      }, this.timeoutMs);
      const pending = { command, resolve, reject, timer };
      this.pending = pending;
      void this.transport.write(latin1Encode(`${command}\r`)).catch((error: unknown) => {
        // A late write rejection must not fail a later command.
        if (this.pending !== pending) return;
        const name = error instanceof Error ? error.name : "Error";
        this.recording.meta(`write failed after ${command}: ${name}`);
        this.stale = true;
        this.fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  close(): void {
    this.isClosed = true;
    this.settleWaiters(false);
    this.unsubscribe();
    this.reader.reset();
    if (this.pending) this.fail(new Error("Console session closed"));
  }

  private settleWaiters(prompted: boolean): void {
    for (const waiter of [...this.promptWaiters]) waiter(prompted);
  }

  private finish(response: string): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.resolve(response);
  }

  private fail(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    pending.reject(error);
  }
}
