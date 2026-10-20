import type { Frame } from "../elm/isotp.js";

export interface DecodeFailure {
  ok: false;
  ecu: string;
  reason: "negative" | "echo" | "length" | "format" | "unknown-pid";
  code?: number;
}

export function checkEcho(frame: Frame, echo: readonly number[]): DecodeFailure | undefined {
  if (frame.negative !== undefined) return { ok: false, ecu: frame.ecu, reason: "negative", code: frame.negative.code };
  if (frame.data.length < echo.length || echo.some((b, i) => frame.data[i] !== b)) {
    return { ok: false, ecu: frame.ecu, reason: "echo" };
  }
  return undefined;
}
