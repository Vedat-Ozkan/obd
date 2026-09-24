// Read-only allowlist and header/protocol sequence rule for Elm327Session. Every rule is sourced in
// docs/ELM327.md §Write safety; behavior: docs/specs/X-2026-09-23-write-safety.md. AGENTS.md hard rule 5.

// docs/ELM327.md §Framing: a command ends at '\r', so an embedded CR (or any control byte) could smuggle a
// second command past the checks below. Only ASCII 0x20-0x7E goes on the wire.
export const NON_PRINTABLE = /[^\x20-\x7E]/;

export function normalize(cmd: string): string {
  return cmd.replace(/ /g, "").toUpperCase();
}

// §Write safety, Services: first byte of an OBD request with CAF1 in effect, and the one request length
// (hex characters) allowed for it, so a dropped first character cannot leave a refused service. Hex pairs
// only, so the response-count digit (odd length) and an empty command (a bare CR repeats) are refused.
const READ_LENGTHS: Readonly<Record<string, number | undefined>> = {
  "01": 4, "02": 6, "03": 2, "06": 4, "07": 2, "09": 4, "0A": 2, "22": 6,
};
const HEX_BYTES = /^(?:[0-9A-F]{2})+$/;

// §Write safety, AT commands allowed: no CAF, PP, reset other than ATZ, or monitoring command is listed.
const PLAIN_AT: readonly string[] = [
  "ATZ", "ATI", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATSP6", "ATSP7", "ATDPN", "ATRV", "ATAT1",
];
// §Write safety: a 29-bit receive filter for replies to F1, and FC data pinned to 30 00 00.
const PLAIN_PATTERN = /^(?:ATCRA18DAF1[0-9A-F]{2}|ATFCSD300000)$/;
// §Write safety, Input rules: header commands, allowed only after ATSP7 was answered OK (see beforeWrite).
const HEADER_CLASS = /^(?:ATCP18|ATSHDA[0-9A-F]{2}F1|ATFCSH18DA[0-9A-F]{2}F1|ATFCSM1)$/;

/** The normalized command if it is on the read-only allowlist (docs/ELM327.md §Write safety); otherwise undefined. */
export function allowedCommand(cmd: string): string | undefined {
  if (NON_PRINTABLE.test(cmd)) return undefined;
  const norm = normalize(cmd);
  if (HEX_BYTES.test(norm)) return READ_LENGTHS[norm.slice(0, 2)] === norm.length ? norm : undefined;
  if (PLAIN_AT.includes(norm) || PLAIN_PATTERN.test(norm) || HEADER_CLASS.test(norm)) return norm;
  return undefined;
}

/** Dongle state that decides whether a header or protocol command is safe to send. */
export interface HeaderState {
  /** The last ATSP value the ELM answered OK to since the last reset; undefined when unknown. */
  readonly protocol: string | undefined;
  /** An ATSH or ATFCSH value may be in effect (they persist until ATD/ATWS/ATZ). */
  readonly customHeader: boolean;
}

/** The state before any reset has been seen: assume the worst. */
export const UNKNOWN_STATE: HeaderState = { protocol: undefined, customHeader: true };

// §Write safety, Input rules: headers persist across a protocol change and 11-bit CAN uses only their
// rightmost 11 bits, so after a header only ATSP7 is allowed until ATZ. Restrictive effects apply here,
// before the write; permissive ones only in afterReply, once the ELM confirmed.
/** For an allowedCommand() result: the state to hold while it is in flight, or undefined if the sequence rule blocks it. */
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

/** ElmResponse["kind"]; repeated here so the guard does not import the session. */
export type ReplyKind = "data" | "ok" | "nodata" | "error";

/** After a '>' arrived for `norm` (never called on a timeout); kind = the parsed response kind. */
export function afterReply(state: HeaderState, norm: string, kind: ReplyKind): HeaderState {
  // §Write safety: ATZ returns every setting, headers included, to its default. Its banner parses as "data";
  // a busy ELM answers STOPPED and discards the ATZ (datasheet rev J p.9, p.48), so an error resets nothing.
  if (norm === "ATZ") return kind === "error" ? state : { protocol: undefined, customHeader: false };
  if (norm.startsWith("ATSP") && kind === "ok") return { protocol: norm.slice(4), customHeader: state.customHeader };
  return state;
}
