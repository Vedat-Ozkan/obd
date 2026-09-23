// Every string matched here is a row of docs/ELM327.md "Responses and how to handle each"
// (cited per row below). Strings that table lacks fall through as content lines (spec Decisions 1).

export type ElmErrorKind =
  | "unable-to-connect"
  | "can-error"
  | "bus-init-error"
  | "buffer-full"
  | "stopped"
  | "unknown-command"
  | "lv-reset"
  | "data-error"
  | "err-code";

/** `line` is the text as received, e.g. "ERR94". */
export interface ElmError {
  kind: ElmErrorKind;
  line: string;
}

export type ElmLineClass =
  | { kind: "searching" }
  | { kind: "nodata" }
  | { kind: "ok" }
  | { kind: "error"; error: ElmError };

const statusTokens: Record<string, "searching" | "nodata" | "ok"> = {
  "SEARCHING...": "searching", // §Responses row 1
  "NO DATA": "nodata", // §Responses row 2
  OK: "ok", // §Responses row 12
};

const errorTokens: Record<string, ElmErrorKind> = {
  "UNABLE TO CONNECT": "unable-to-connect", // §Responses row 3
  "CAN ERROR": "can-error", // §Responses row 4
  "BUFFER FULL": "buffer-full", // §Responses row 6
  STOPPED: "stopped", // §Responses row 7
  "?": "unknown-command", // §Responses row 8
  "LV RESET": "lv-reset", // §Responses row 9
  "DATA ERROR": "data-error", // §Responses row 10
  "<DATA ERROR": "data-error", // §Responses row 10
};

function errorKind(line: string): ElmErrorKind | undefined {
  if (Object.hasOwn(errorTokens, line)) return errorTokens[line];
  // §Responses row 5: `BUS INIT: ...ERROR`; the dots vary.
  if (line.startsWith("BUS INIT:") && line.endsWith("ERROR")) return "bus-init-error";
  // §Responses row 11: `ERR94` etc.; generalized to ERR + two digits (spec Risks).
  if (/^ERR\d\d$/.test(line)) return "err-code";
  return undefined;
}

/** Exact, case-sensitive match on an already trimmed line. undefined = a content line (data, version string, voltage, ...). */
export function classifyLine(line: string): ElmLineClass | undefined {
  if (Object.hasOwn(statusTokens, line)) return { kind: statusTokens[line] };
  const kind = errorKind(line);
  return kind === undefined ? undefined : { kind: "error", error: { kind, line } };
}
