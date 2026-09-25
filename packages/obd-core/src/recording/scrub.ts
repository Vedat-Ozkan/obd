// Upload scrubber for beta data (ADR-019): docs/specs/T2.9-beta-data-upload.md §Scrub rules, every rule sourced in
// that spec's §Sources table. The VIN rules, ISO-TP spots and safety net port tools/spike/redact_vin.py (ADR-017).
// Pure TypeScript: it runs on the phone before upload and again at intake.
import { vinCheckDigit } from "../obd/vin.js";
import { recordingLineSchema } from "./format.js";

export const SCRUB_VERSION = 1;
export const SCRUB_RULES = [
  "vin-0902", "vin-4193", "vin-check-digit", "did-f180-f1ff", "mode09-infotype",
  "odometer-01a6", "user-note", "date-in-note", "meta-key",
] as const;
export type ScrubRule = (typeof SCRUB_RULES)[number];
/** Messages or lines touched per rule. */
export interface ScrubReport { version: typeof SCRUB_VERSION; masked: Record<ScrubRule, number> }

/** 1-based input line; the message never contains a VIN or serial. */
export class ScrubRefusal extends Error {
  readonly line: number;
  constructor(line: number, reason: string) {
    super(`line ${String(line)}: ${reason}`);
    this.name = "ScrubRefusal";
    this.line = line;
  }
}

// redact_vin.py MASK: ASCII "0", so each masked byte's hex digits become "30" (ADR-017).
const MASK_HI = "3";
const MASK_LO = "0";
const MASKED_SERIAL = "000000";
// redact_vin.py RULES: normalized tx -> reply prefix and the payload indices where a 17-byte VIN starts.
const VIN_RULES: Readonly<Record<string, { rule: ScrubRule; prefix: readonly number[]; offsets: readonly number[] }>> = {
  "0902": { rule: "vin-0902", prefix: [0x49, 0x02, 0x01], offsets: [3] },
  "224193": { rule: "vin-4193", prefix: [0x62, 0x41, 0x93], offsets: [3, 20, 37, 54] },
};
// Mode 09 infotypes with a layout in docs/ELM327.md §J1979 conventions (supported bitmap, VIN, CAL IDs, ECU name).
const MODE09_KEPT = new Set([0x00, 0x02, 0x04, 0x0a]);
// apps/mobile/src/recording.ts RecordingMeta plus t and dir, and the T2.4 charge-log session boundary (T2.4 Decisions
// 9 and 13, this spec's Decision 15); everything else is dropped (fail-closed).
const META_KEYS = new Set(["t", "dir", "car", "dongle", "note", "writeChar", "notifyChar", "mtu", "event", "reason"]);
const SESSION_EVENT = "charge-log session";
const SESSION_REASONS = new Set(["start", "lv-reset", "timeout", "disconnect", "elm-error"]);
// Decision 16: tx and rx lines are fail-closed too.
const LINE_KEYS = new Set(["t", "dir", "data"]);
const USER_NOTE = "removed before upload";
const DATE = /\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+Z?)?/g;
const VIN_WINDOW = /^[0-9A-HJ-NPR-Z]{17}$/;

type Entry = [key: string, valueText: string];
interface Spot { k: number; n: number }
interface Message { header: string; length: number; payload: number[]; spots: [Spot, Spot][]; next?: number }
interface Held { n: number; out: string; data?: string; entries?: Entry[] }
interface Exchange { tx: Held; cmd: string; lines: Held[] }

/** Python json.dumps string form (ensure_ascii): the same escapes as apps/mobile/src/recording.ts pythonJsonLine. */
export const pyString = (s: string) =>
  JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Python repr(float): shortest round-trip digits, scientific below 1e-4 or from 1e16, always a "." or exponent. */
function pyFloat(x: number): string | undefined {
  if (!Number.isFinite(x)) return undefined;
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mantissa, e] = x.toExponential().split("e");
  const exp = Number(e);
  const sign = x < 0 ? "-" : "";
  const digits = mantissa.replace(/[-.]/g, "");
  if (exp < -4 || exp >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  if (exp < 0) return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
  const int = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
  return `${sign}${int}.${digits.length > exp + 1 ? digits.slice(exp + 1) : "0"}`;
}

function pyScalar(token: string): string | undefined {
  if (token === "true" || token === "false" || token === "null") return token;
  if (/^-?(0|[1-9]\d*)$/.test(token)) return token === "-0" ? "0" : token;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(token)) return pyFloat(Number(token));
  return undefined;
}

const TOKEN = /\s+|"(?:[^"\\]|\\.)*"|[-+.\w]+|[{}[\],:]/y;

/** The line's top-level [key, value text] pairs if json.dumps(json.loads(line)) == line in Python, else undefined.
 *  Token-based so Python floats such as 5.0 keep their form (JSON.parse would lose it). */
function pythonEntries(line: string): Entry[] | undefined {
  const entries: Entry[] = [];
  const stack: (Set<string> | undefined)[] = []; // key set per open object, undefined per open array
  let canonical = "";
  let expectKey = false;
  let topKey: string | undefined;
  let valueFrom = 0;
  const closeEntry = () => {
    if (stack.length === 1 && topKey !== undefined) entries.push([topKey, canonical.slice(valueFrom)]);
  };
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < line.length) {
    const token = TOKEN.exec(line)?.[0];
    if (token === undefined) return undefined;
    if (/^\s/.test(token)) continue;
    if (token === "{" || token === "[") {
      stack.push(token === "{" ? new Set() : undefined);
      canonical += token;
      expectKey = token === "{";
    } else if (token === "}" || token === "]") {
      closeEntry();
      stack.pop();
      canonical += token;
      expectKey = false;
    } else if (token === ",") {
      closeEntry();
      canonical += ", ";
      expectKey = stack.at(-1) !== undefined;
    } else if (token === ":") {
      canonical += ": ";
      if (stack.length === 1) valueFrom = canonical.length;
    } else if (token.startsWith('"')) {
      const s = JSON.parse(token) as string;
      if (expectKey) {
        const keys = stack.at(-1);
        if (keys === undefined || keys.has(s)) return undefined; // Python keeps only the last duplicate
        keys.add(s);
        if (stack.length === 1) topKey = s;
        expectKey = false;
      }
      canonical += pyString(s);
    } else {
      const scalar = pyScalar(token);
      if (scalar === undefined) return undefined;
      canonical += scalar;
    }
  }
  return canonical === line && stack.length === 0 ? entries : undefined;
}

const pyObject = (entries: readonly Entry[]) => `{${entries.map(([k, v]) => `${pyString(k)}: ${v}`).join(", ")}}`;

/** redact_vin.py _norm. */
const normCommand = (data: string) => data.replace(/\r$/, "").replace(/ /g, "").toUpperCase();

/** redact_vin.py _frames: hex-only pieces between "\r" or ">", spaces skipped, each char with its spot. */
function* hexFrames(rx: readonly string[]): Generator<{ text: string; spots: Spot[] }> {
  let text = "";
  let spots: Spot[] = [];
  const cut = function* () {
    if (/^[0-9A-F]+$/.test(text)) yield { text, spots };
    text = "";
    spots = [];
  };
  for (const [k, data] of rx.entries()) {
    for (let n = 0; n < data.length; n++) {
      const c = data[n];
      if (c === "\r" || c === ">") yield* cut();
      else if (c !== " ") {
        text += c;
        spots.push({ k, n });
      }
    }
  }
  yield* cut();
}

/** redact_vin.py messages() for one exchange: ISO-TP SF/FF/CF per header. A bad CF refuses only in a VIN reply. */
function messages(cmd: string, rx: readonly string[], txLine: number): Message[] {
  const started: Message[] = [];
  const open = new Map<string, Message>();
  for (const { text, spots } of hexFrames(rx)) {
    const h = text.length % 2 === 0 ? 8 : 3;
    const header = text.slice(0, h);
    const pci = text.slice(h, h + 1);
    let body = h + 1;
    let msg: Message;
    if (pci === "0" && text.length > body) {
      msg = { header, length: parseInt(text[h + 1], 16), payload: [], spots: [] };
      body++;
    } else if (pci === "1" && text.length >= h + 4) {
      msg = { header, length: parseInt(text.slice(h + 1, h + 4), 16), payload: [], spots: [], next: 1 };
      open.set(header, msg);
      body = h + 4;
    } else if (pci === "2" && text.length > body) {
      const found = open.get(header);
      const seq = parseInt(text[h + 1], 16);
      body++;
      if (found?.next !== seq || found.payload.length >= found.length) {
        if (cmd in VIN_RULES) throw new ScrubRefusal(txLine, `${cmd} ${header}: unexpected CF (sequence ${String(seq)})`);
        continue;
      }
      found.next = (seq + 1) & 0xf;
      msg = found;
    } else {
      continue;
    }
    if (pci !== "2") started.push(msg);
    for (let k = body; k < text.length - 1; k += 2) {
      if (msg.payload.length < msg.length) {
        msg.payload.push(parseInt(text.slice(k, k + 2), 16));
        msg.spots.push([spots[k], spots[k + 1]]);
      }
    }
  }
  return started;
}

const startsWith = (payload: readonly number[], prefix: readonly number[]) => prefix.every((b, i) => payload[i] === b);
const isVinByte = (b: number) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a); // redact_vin.py [0-9A-Z]
const ascii = (payload: readonly number[]) => String.fromCharCode(...payload);
const hexOf = (s: string) => Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join("");

/** One instance per file. Lines are passed without their "\n". */
export class UploadScrubber {
  private readonly masked = Object.fromEntries(SCRUB_RULES.map((r) => [r, 0])) as Record<ScrubRule, number>;
  private readonly serials = new Set<string>();
  private line = 0;
  private seenMeta = false;
  private exchange: Exchange | undefined;
  private verifyLine = 0;
  private verifyExchange: { line: number; cmd: string; rx: string[] } | undefined;

  /** Pass 1. Returns the output lines that are final (it holds back at most one exchange). Throws ScrubRefusal. */
  push(line: string): string[] {
    const n = ++this.line;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ScrubRefusal(n, "not valid JSON");
    }
    const parsed = recordingLineSchema.safeParse(value);
    if (!parsed.success) throw new ScrubRefusal(n, "not a recording line");
    const entries = pythonEntries(line);
    if (entries === undefined) throw new ScrubRefusal(n, "not in Python json.dumps form");
    const record = parsed.data;
    if (record.dir !== "meta" && entries.some(([k]) => !LINE_KEYS.has(k))) {
      throw new ScrubRefusal(n, `${record.dir} line has a key other than t, dir and data`);
    }
    if (record.dir === "tx") {
      const done = this.flush();
      this.exchange = { tx: { n, out: line }, cmd: normCommand(record.data), lines: [] };
      return done;
    }
    const held: Held = record.dir === "rx" ? { n, out: line, data: record.data, entries } : { n, out: this.meta(n, line, entries, record) };
    if (this.exchange === undefined) return [held.out];
    this.exchange.lines.push(held);
    return [];
  }

  /** Pass 1 end: the held-back lines and the report. */
  end(): { lines: string[]; report: ScrubReport } {
    return { lines: this.flush(), report: { version: SCRUB_VERSION, masked: { ...this.masked } } };
  }

  /** Pass 2 (safety net, redact_vin.py _safety_net) over the complete pass-1 output, in order. */
  verify(line: string): void {
    const n = ++this.verifyLine;
    if (this.serials.size === 0) return;
    for (const s of this.serials) {
      if (line.includes(s) || line.includes(hexOf(s)) || line.includes(hexOf(s).toLowerCase())) throw survives(n);
    }
    const record = JSON.parse(line) as { dir: string; data?: string };
    if (record.dir === "tx") {
      this.verifyEnd();
      this.verifyExchange = { line: n, cmd: normCommand(record.data ?? ""), rx: [] };
    } else if (record.dir === "rx") {
      this.verifyExchange?.rx.push(record.data ?? "");
    }
  }

  verifyEnd(): void {
    const ex = this.verifyExchange;
    this.verifyExchange = undefined;
    if (ex === undefined || this.serials.size === 0) return;
    const rx = ex.rx.join("").replace(/[\r ]/g, "");
    const payloads = messages(ex.cmd, ex.rx, ex.line).map((m) => ascii(m.payload));
    for (const s of this.serials) {
      if (rx.includes(hexOf(s)) || rx.includes(hexOf(s).toLowerCase()) || payloads.some((p) => p.includes(s))) throw survives(ex.line);
    }
  }

  private meta(n: number, line: string, entries: Entry[], record: Record<string, unknown>): string {
    const { event, reason, note } = record;
    if ((event !== undefined || reason !== undefined) && !(event === SESSION_EVENT && typeof reason === "string" && SESSION_REASONS.has(reason))) {
      throw new ScrubRefusal(n, "meta event or reason outside the charge-log session allowlist");
    }
    const kept = entries.filter(([k]) => META_KEYS.has(k));
    let changed = kept.length !== entries.length;
    if (changed) this.masked["meta-key"]++;
    const at = kept.findIndex(([k]) => k === "note");
    const first = !this.seenMeta;
    this.seenMeta = true;
    if (at >= 0 && first) {
      kept[at] = ["note", pyString(USER_NOTE)];
      this.masked["user-note"]++;
      changed = true;
    } else if (at >= 0 && typeof note === "string") {
      const dated = note.replace(DATE, "[date]");
      if (dated !== note) {
        kept[at] = ["note", pyString(dated)];
        this.masked["date-in-note"]++;
        changed = true;
      }
    }
    return changed ? pyObject(kept) : line;
  }

  /** Applies the message rules to the held exchange and returns its lines. */
  private flush(): string[] {
    const ex = this.exchange;
    this.exchange = undefined;
    if (ex === undefined) return [];
    const rx = ex.lines.map((h) => h.data ?? "");
    const edits = new Map<number, Map<number, string>>();
    const mask = (pairs: readonly [Spot, Spot][]) => {
      for (const [hi, lo] of pairs) {
        for (const [spot, digit] of [[hi, MASK_HI], [lo, MASK_LO]] as const) {
          const line = edits.get(spot.k) ?? new Map<number, string>();
          line.set(spot.n, digit);
          edits.set(spot.k, line);
        }
      }
    };
    const learn = (serial: string) => {
      if (serial !== MASKED_SERIAL) this.serials.add(serial);
    };
    const vinRule = VIN_RULES[ex.cmd] as (typeof VIN_RULES)[string] | undefined;
    for (const m of messages(ex.cmd, rx, ex.tx.n)) {
      const p = m.payload;
      if (vinRule !== undefined && startsWith(p, vinRule.prefix)) {
        this.masked[vinRule.rule]++;
        for (const o of vinRule.offsets) {
          if (!p.slice(o, o + 17).every(isVinByte)) throw new ScrubRefusal(ex.tx.n, `${ex.cmd} ${m.header}: VIN byte outside 0-9A-Z`);
          if (p.length >= o + 17) learn(ascii(p.slice(o + 11, o + 17)));
          mask(m.spots.slice(o + 11, o + 17));
        }
        continue;
      }
      if (p[0] === 0x62 && p[1] === 0xf1 && p.length >= 3 && p[2] >= 0x80) {
        this.masked["did-f180-f1ff"]++;
        mask(m.spots.slice(3));
      }
      if (p[0] === 0x49 && p.length >= 2 && !MODE09_KEPT.has(p[1])) {
        this.masked["mode09-infotype"]++;
        mask(m.spots.slice(2));
      }
      if (p[0] === 0x41 && p[1] === 0xa6) {
        this.masked["odometer-01a6"]++;
        mask(m.spots.slice(2, 6));
      }
      const text = ascii(p);
      let hit = false;
      for (let i = 0; i + 17 <= text.length; i++) {
        const w = text.slice(i, i + 17);
        if (!VIN_WINDOW.test(w) || w[8] !== vinCheckDigit(w)) continue;
        // Decision 11: chance hits on digit runs are common, so check-digit serials mask but never feed the safety net.
        hit = true;
        mask(m.spots.slice(i + 11, i + 17));
      }
      if (hit) this.masked["vin-check-digit"]++;
    }
    const out = [ex.tx.out];
    for (const [k, h] of ex.lines.entries()) {
      const changes = edits.get(k);
      if (changes === undefined || h.data === undefined || h.entries === undefined) {
        out.push(h.out);
        continue;
      }
      const chars = h.data.split("");
      for (const [n, digit] of changes) chars[n] = digit;
      const data = chars.join("");
      out.push(data === h.data ? h.out : pyObject(h.entries.map(([key, v]) => [key, key === "data" ? pyString(data) : v])));
    }
    return out;
  }
}

const survives = (line: number) => new ScrubRefusal(line, "a VIN serial survives masking");

/** Both passes over a whole text (small files, intake, tests). Throws ScrubRefusal. */
export function scrubRecording(text: string): { text: string; report: ScrubReport } {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const scrubber = new UploadScrubber();
  const out = lines.flatMap((line) => scrubber.push(line));
  const { lines: rest, report } = scrubber.end();
  out.push(...rest);
  for (const line of out) scrubber.verify(line);
  scrubber.verifyEnd();
  return { text: out.length > 0 ? out.join("\n") + "\n" : "", report };
}
