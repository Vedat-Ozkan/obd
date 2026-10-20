import { latin1Decode } from "../recording/format.js";
import { classifyLine, type ElmError } from "./errors.js";

export class ElmLineReader {
  private buffer = "";

  push(chunk: Uint8Array): string[] {
    const segments = (this.buffer + latin1Decode(chunk)).split(">");
    this.buffer = segments.pop() ?? "";
    return segments;
  }

  reset(): void {
    this.buffer = "";
  }
}

export interface ElmRawResponse {
  raw: string;
  lines: string[];
  searching: boolean;
  status:
    | { kind: "data" }
    | { kind: "ok" }
    | { kind: "nodata" }
    | { kind: "error"; error: ElmError };
}

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
