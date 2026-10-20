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
  "SEARCHING...": "searching",
  "NO DATA": "nodata",
  OK: "ok",
};

const errorTokens: Record<string, ElmErrorKind> = {
  "UNABLE TO CONNECT": "unable-to-connect",
  "CAN ERROR": "can-error",
  "BUFFER FULL": "buffer-full",
  STOPPED: "stopped",
  "?": "unknown-command",
  "LV RESET": "lv-reset",
  "DATA ERROR": "data-error",
  "<DATA ERROR": "data-error",
};

function errorKind(line: string): ElmErrorKind | undefined {
  if (Object.hasOwn(errorTokens, line)) return errorTokens[line];
  if (line.startsWith("BUS INIT:") && line.endsWith("ERROR")) return "bus-init-error";
  if (/^ERR\d\d$/.test(line)) return "err-code";
  return undefined;
}

export function classifyLine(line: string): ElmLineClass | undefined {
  if (Object.hasOwn(statusTokens, line)) return { kind: statusTokens[line] };
  const kind = errorKind(line);
  return kind === undefined ? undefined : { kind: "error", error: { kind, line } };
}
