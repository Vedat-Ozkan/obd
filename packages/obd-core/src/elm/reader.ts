import { latin1Decode } from "../recording/format.js";
import { classifyLine, type ElmError } from "./errors.js";

// Framing rules: docs/ELM327.md §Framing. A response is complete only when '>' arrives; lines end
// with '\r' (ATL0) or '\r\n' (ATL1); the command is echoed unless ATE0.

/** Accumulates transport chunks; emits the text of each response once its '>' prompt has arrived. */
export class ElmLineReader {
  private buffer = "";

  /** Returns the raw text (without the '>') of every response completed by this chunk: zero, one, or more. Text after the last '>' stays buffered. */
  push(chunk: Uint8Array): string[] {
    const segments = (this.buffer + latin1Decode(chunk)).split(">");
    this.buffer = segments.pop() ?? "";
    return segments;
  }

  /** Drops any buffered partial response. */
  reset(): void {
    this.buffer = "";
  }
}

export interface ElmRawResponse {
  /** Verbatim text between the previous '>' and this one, '>' excluded. Never lost, whatever the classification. */
  raw: string;
  /** Content lines: split on '\r', trimmed, empty lines dropped, echo and status lines removed. */
  lines: string[];
  /** A SEARCHING... line was present (and removed from lines). */
  searching: boolean;
  status:
    | { kind: "data" } // lines hold whatever the ELM printed; an empty response ('>' only) is data with lines: []
    | { kind: "ok" } // the only line was OK
    | { kind: "nodata" }
    | { kind: "error"; error: ElmError };
}

/** Pure. `cmd` is the command that was sent (without '\r'); when given, one leading line equal to it is dropped as echo. */
export function parseElmResponse(raw: string, cmd?: string): ElmRawResponse {
  const all = raw
    .split("\r")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (cmd !== undefined && all[0] === cmd.trim()) all.shift();

  const lines: string[] = [];
  let searching = false;
  let nodata = false;
  let ok = 0;
  let error: ElmError | undefined;
  for (const line of all) {
    const cls = classifyLine(line);
    if (cls === undefined) {
      lines.push(line);
    } else if (cls.kind === "searching") {
      searching = true;
    } else if (cls.kind === "nodata") {
      nodata = true;
    } else if (cls.kind === "ok") {
      ok++;
    } else {
      error ??= cls.error;
    }
  }

  const status: ElmRawResponse["status"] =
    error !== undefined
      ? { kind: "error", error }
      : nodata
        ? { kind: "nodata" }
        : ok === 1 && all.length === 1
          ? { kind: "ok" }
          : { kind: "data" };
  return { raw, lines, searching, status };
}
