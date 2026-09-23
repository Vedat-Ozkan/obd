import type { RecordingLine } from "../recording/format.js";
import { latin1Decode, latin1Encode } from "../recording/format.js";
import type { Transport } from "./types.js";

export class ReplayMismatchError extends Error {
  /** 1-based line in the recording, or the line after the last one when the recording is exhausted. */
  readonly line: number;
  /** Next tx data, undefined when exhausted. */
  readonly expected: string | undefined;
  /** What was written, latin1-decoded. */
  readonly actual: string;

  constructor(line: number, expected: string | undefined, actual: string) {
    super(
      expected === undefined
        ? `replay: recording exhausted at line ${String(line)}, got ${JSON.stringify(actual)}`
        : `replay: line ${String(line)} expects ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
    this.name = "ReplayMismatchError";
    this.line = line;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Plays a parsed recording back through the Transport interface. Each write must match the next
 * tx line exactly (docs/ARCHITECTURE.md "Recording format"); the rx lines up to the following tx
 * are delivered asynchronously, one callback per rx line, so recorded chunk boundaries survive.
 */
export class ReplayTransport implements Transport {
  private cursor = 0;
  private closed = false;
  private readonly subscribers = new Set<(bytes: Uint8Array) => void>();

  constructor(private readonly lines: readonly RecordingLine[]) {}

  write(bytes: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error("replay: transport is closed"));
    const actual = latin1Decode(bytes);
    const batch: string[] = [];
    // Collect rx (skipping meta) from index i up to the next tx; returns that tx's index or lines.length.
    const collectRx = (from: number): number => {
      let i = from;
      for (; i < this.lines.length; i++) {
        const line = this.lines[i];
        if (line.dir === "tx") break;
        if (line.dir === "rx") batch.push(line.data);
      }
      return i;
    };
    const at = collectRx(this.cursor);
    const next = at < this.lines.length ? this.lines[at] : undefined;
    const expected = next?.dir === "tx" ? next.data : undefined;
    if (expected !== actual) {
      return Promise.reject(new ReplayMismatchError(at + 1, expected, actual));
    }
    this.cursor = collectRx(at + 1);
    queueMicrotask(() => {
      if (this.closed) return;
      for (const data of batch) {
        const chunk = latin1Encode(data);
        for (const cb of this.subscribers) cb(chunk);
      }
    });
    return Promise.resolve();
  }

  onData(cb: (bytes: Uint8Array) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
