// ISO-TP reassembly with headers on: docs/ELM327.md §Multi-frame responses. Rules and drop reasons:
// docs/specs/T0.4-elm327-session.md "src/elm/isotp.ts".

/** One reassembled ISO-TP message from one ECU (name kept from ARCHITECTURE.md; it is a message, not a CAN frame). */
export interface Frame {
  /** CAN ID as printed, spaces removed: "7E8" or "18DAF117". */
  header: string;
  /** "17" when header is 18DAF1xx, otherwise the header itself ("7E8"). */
  ecu: string;
  /** Payload with PCI bytes removed, trimmed to the ISO-TP length (padding dropped). */
  data: Uint8Array;
  /** Present iff data[0] === 0x7F and data.length >= 3. */
  negative?: { service: number; code: number };
}

export type DropReason = "no-first-frame" | "sequence" | "incomplete" | "flow-control" | "malformed";

export interface DroppedFrame {
  header: string;
  reason: DropReason;
  /** The line as received (for "incomplete": the first-frame line). */
  line: string;
}

export interface Reassembly {
  /** In order of their single-frame or first-frame line. */
  frames: Frame[];
  /** In detection order; end-of-response "incomplete" entries last, in first-frame order. */
  dropped: DroppedFrame[];
  /** Content lines that are not frame-shaped (e.g. "ELM327 v1.5"). */
  text: string[];
}

interface InProgress {
  order: number;
  line: string;
  length: number;
  expected: number;
  bytes: number[];
}

interface CanLine {
  header: string;
  bytes: number[];
}

// Header width from parity: every data byte is two hex chars, so odd = 3-char 11-bit ID, even = 8-char 29-bit ID.
function parseCanLine(line: string): CanLine | undefined {
  const hex = line.replace(/ /g, "");
  if (!/^[0-9A-F]+$/i.test(hex)) return undefined;
  const width = hex.length % 2 === 1 ? 3 : 8;
  const dataHex = hex.slice(width);
  if (dataHex.length < 2 || dataHex.length > 16) return undefined;
  const bytes: number[] = [];
  for (let i = 0; i < dataHex.length; i += 2) bytes.push(parseInt(dataHex.slice(i, i + 2), 16));
  return { header: hex.slice(0, width), bytes };
}

// Equinox reply header 18DAF1<module> (docs/ELM327.md §Per-car notes).
function ecuOf(header: string): string {
  return /^18DAF1([0-9A-F]{2})$/i.exec(header)?.[1] ?? header;
}

function makeFrame(header: string, bytes: number[]): Frame {
  const frame: Frame = { header, ecu: ecuOf(header), data: Uint8Array.from(bytes) };
  if (bytes[0] === 0x7f && bytes.length >= 3) frame.negative = { service: bytes[1], code: bytes[2] };
  return frame;
}

/** Pure. `lines` = the content lines of ONE response (ElmRawResponse.lines), headers on (ATH1). */
export function reassemble(lines: readonly string[]): Reassembly {
  const frames: { order: number; frame: Frame }[] = [];
  const dropped: DroppedFrame[] = [];
  const text: string[] = [];
  const open = new Map<string, InProgress>();

  const complete = (header: string, msg: InProgress): void => {
    open.delete(header);
    frames.push({ order: msg.order, frame: makeFrame(header, msg.bytes.slice(0, msg.length)) });
  };

  for (const [order, line] of lines.entries()) {
    const can = parseCanLine(line);
    if (can === undefined) {
      text.push(line);
      continue;
    }
    const { header, bytes } = can;
    const pci = bytes[0];
    const msg = open.get(header);
    switch (pci >> 4) {
      case 0: {
        const length = pci & 0x0f;
        if (length >= 1 && length <= bytes.length - 1) {
          frames.push({ order, frame: makeFrame(header, bytes.slice(1, 1 + length)) });
        } else {
          dropped.push({ header, reason: "malformed", line });
        }
        break;
      }
      case 1: {
        if (bytes.length < 2) {
          dropped.push({ header, reason: "malformed", line });
          break;
        }
        if (msg !== undefined) {
          open.delete(header);
          dropped.push({ header, reason: "incomplete", line: msg.line });
        }
        const next: InProgress = { order, line, length: ((pci & 0x0f) << 8) | bytes[1], expected: 1, bytes: bytes.slice(2) };
        open.set(header, next);
        if (next.bytes.length >= next.length) complete(header, next);
        break;
      }
      case 2: {
        if (msg === undefined) {
          dropped.push({ header, reason: "no-first-frame", line });
        } else if ((pci & 0x0f) !== msg.expected) {
          open.delete(header);
          dropped.push({ header, reason: "sequence", line: msg.line }, { header, reason: "sequence", line });
        } else {
          msg.bytes.push(...bytes.slice(1));
          msg.expected = (msg.expected + 1) & 0x0f;
          if (msg.bytes.length >= msg.length) complete(header, msg);
        }
        break;
      }
      case 3:
        dropped.push({ header, reason: "flow-control", line });
        break;
      default:
        dropped.push({ header, reason: "malformed", line });
    }
  }

  for (const [header, msg] of open) dropped.push({ header, reason: "incomplete", line: msg.line });
  frames.sort((a, b) => a.order - b.order);
  return { frames: frames.map((f) => f.frame), dropped, text };
}
