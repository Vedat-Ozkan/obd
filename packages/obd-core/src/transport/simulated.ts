import type { RecordingLine } from "../recording/format.js";
import { latin1Decode, latin1Encode } from "../recording/format.js";
import type { Transport } from "./types.js";

export type SimTable = {
  replies: Readonly<Record<string, readonly string[]>>;
  wrongModelVin: readonly string[];
};

const ERROR_TOKENS = new Set(["NO DATA", "UNABLE TO CONNECT", "?", "CAN ERROR", "BUFFER FULL"]);
const HEADER_RESETS = new Set(["ATZ", "ATD", "ATWS"]);

const normalise = (text: string): string => text.trim().toUpperCase().replace(/\s+/g, " ");
const isAt = (command: string): boolean => command.startsWith("AT");
export const simKey = (header: string, command: string): string => `${normalise(header)}|${normalise(command)}`;

function nextHeader(header: string, command: string): string {
  if (HEADER_RESETS.has(command)) return "";
  return command.startsWith("ATSH") ? command.slice(4).trim() : header;
}

export function isErrorReply(reply: string, command: string): boolean {
  const lines = reply.split("\r").map(normalise).filter((line) => line !== "" && line !== ">" && line !== command);
  return lines.length > 0 && lines.every((line) => ERROR_TOKENS.has(line.replace(/>$/, "").trim()));
}

function subsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]);
}

function collect(lines: readonly RecordingLine[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  let header = "";
  let key: string | undefined;
  let command = "";
  let chunks: string[] = [];
  const flush = () => {
    if (key !== undefined && chunks.length > 0) {
      const list = byKey.get(key) ?? [];
      const reply = chunks.join("");
      if (!isAt(command) || list.length === 0) {
        if (!list.includes(reply)) list.push(reply);
      }
      byKey.set(key, list);
    }
    chunks = [];
  };
  for (const line of lines) {
    if (line.dir === "tx") {
      flush();
      command = normalise(line.data);
      key = simKey(isAt(command) ? "" : header, command);
      header = nextHeader(header, command);
    } else if (line.dir === "rx") chunks.push(line.data);
  }
  flush();
  return byKey;
}

function queues(sources: readonly (readonly RecordingLine[])[], maxPerKey: number): Record<string, string[]> {
  const merged = new Map<string, string[]>();
  for (const lines of sources) {
    for (const [key, replies] of collect(lines)) {
      const list = merged.get(key) ?? [];
      for (const reply of replies) if (!list.includes(reply) && !(isAt(key.slice(key.indexOf("|") + 1)) && list.length > 0)) list.push(reply);
      merged.set(key, list);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [key, replies] of merged) {
    const command = key.slice(key.indexOf("|") + 1);
    const data = replies.filter((reply) => !isErrorReply(reply, command));
    out[key] = subsample(data.length > 0 ? data : replies, maxPerKey);
  }
  return out;
}

export function buildSimTable(
  sources: readonly { path: string; lines: readonly RecordingLine[] }[],
  synthetic: { path: string; lines: readonly RecordingLine[] },
  maxPerKey: number,
): SimTable {
  for (const source of sources) {
    if (!source.path.endsWith(".redacted.jsonl")) throw new Error(`simulated: refusing non-redacted source ${source.path}`);
  }
  return {
    replies: queues(sources.map((source) => source.lines), maxPerKey),
    wrongModelVin: queues([synthetic.lines], maxPerKey)["|0902"] ?? [],
  };
}

export class SimulatedCommandError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`simulated: no recorded reply for ${key}`);
    this.name = "SimulatedCommandError";
    this.key = key;
  }
}

export class SimulatedTransport implements Transport {
  readonly startsIdle = true;
  private header = "";
  private closed = false;
  private readonly cursors = new Map<string, number>();
  private readonly missed: string[] = [];
  private readonly subscribers = new Set<(bytes: Uint8Array) => void>();

  constructor(private readonly table: SimTable, private readonly scenario: "equinox" | "wrong-model" = "equinox") {}

  get misses(): readonly string[] {
    return this.missed;
  }

  get requested(): readonly string[] {
    return [...this.cursors.keys()];
  }

  write(bytes: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error("simulated: transport is closed"));
    const command = normalise(latin1Decode(bytes));
    const key = simKey(isAt(command) ? "" : this.header, command);
    this.header = nextHeader(this.header, command);
    const queue = this.scenario === "wrong-model" && command === "0902" ? this.table.wrongModelVin : (this.table.replies as Readonly<Record<string, readonly string[] | undefined>>)[key];
    if (queue === undefined || queue.length === 0) {
      this.missed.push(key);
      return Promise.reject(new SimulatedCommandError(key));
    }
    const cursor = this.cursors.get(key) ?? 0;
    this.cursors.set(key, cursor + 1);
    const chunk = latin1Encode(queue[cursor % queue.length]);
    queueMicrotask(() => {
      if (this.closed) return;
      for (const cb of this.subscribers) cb(chunk);
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
