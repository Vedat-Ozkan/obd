export const NON_PRINTABLE = /[^\x20-\x7E]/;

export function normalize(cmd: string): string {
  return cmd.replace(/ /g, "").toUpperCase();
}

const READ_LENGTHS: Readonly<Record<string, number | undefined>> = {
  "01": 4, "02": 6, "03": 2, "07": 2, "09": 4, "0A": 2, "22": 6,
};
const HEX_BYTES = /^(?:[0-9A-F]{2})+$/;
const MODE02_FRAME = "00";

const PLAIN_AT: readonly string[] = [
  "ATZ", "ATI", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATSP6", "ATSP7", "ATDPN", "ATRV", "ATAT1",
];
const PLAIN_PATTERN = /^(?:ATCRA18DAF1[0-9A-F]{2}|ATFCSD300000)$/;
const HEADER_CLASS = /^(?:ATCP18|ATSHDA[0-9A-F]{2}F1|ATFCSH18DA[0-9A-F]{2}F1|ATFCSM1)$/;

export function allowedCommand(cmd: string): string | undefined {
  if (NON_PRINTABLE.test(cmd)) return undefined;
  const norm = normalize(cmd);
  if (HEX_BYTES.test(norm)) {
    if (norm === "1902FF") return norm;
    if (READ_LENGTHS[norm.slice(0, 2)] !== norm.length) return undefined;
    return !norm.startsWith("02") || norm.endsWith(MODE02_FRAME) ? norm : undefined;
  }
  if (PLAIN_AT.includes(norm) || PLAIN_PATTERN.test(norm) || HEADER_CLASS.test(norm)) return norm;
  return undefined;
}

export interface HeaderState {
  readonly protocol: string | undefined;
  readonly customHeader: boolean;
}

export const UNKNOWN_STATE: HeaderState = { protocol: undefined, customHeader: true };

export function beforeWrite(state: HeaderState, norm: string): HeaderState | undefined {
  if (norm.startsWith("ATSP")) {
    if (state.customHeader && norm !== "ATSP7") return undefined;
    return { protocol: undefined, customHeader: state.customHeader };
  }
  if (HEADER_CLASS.test(norm)) {
    if (state.protocol !== "7") return undefined;
    if (norm.startsWith("ATSH") || norm.startsWith("ATFCSH")) return { protocol: state.protocol, customHeader: true };
  }
  return state;
}

export type ReplyKind = "data" | "ok" | "nodata" | "error";

export function afterReply(state: HeaderState, norm: string, kind: ReplyKind): HeaderState {
  if (norm === "ATZ") return kind === "error" ? state : { protocol: undefined, customHeader: false };
  if (norm.startsWith("ATSP") && kind === "ok") return { protocol: norm.slice(4), customHeader: state.customHeader };
  return state;
}
