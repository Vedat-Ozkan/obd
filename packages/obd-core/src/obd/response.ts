// Shared decode failure and echo check: docs/specs/T0.5-standard-decoding.md "src/obd/response.ts".
// Positive response = service + 0x40, then the PID/infotype echo: docs/ELM327.md §J1979 conventions.
import type { Frame } from "../elm/isotp.js";

export interface DecodeFailure {
  ok: false;
  ecu: string;
  reason: "negative" | "echo" | "length" | "format" | "unknown-pid";
  /** Present iff reason === "negative": frame.negative.code. */
  code?: number;
}

/** Failure if the frame is negative, or its data does not start with `echo` (e.g. [0x41, pid]); else undefined. */
export function checkEcho(frame: Frame, echo: readonly number[]): DecodeFailure | undefined {
  if (frame.negative !== undefined) return { ok: false, ecu: frame.ecu, reason: "negative", code: frame.negative.code };
  // The echoed PID also catches a reply paired with the wrong request after a late '>' (T0.4 resync risk).
  if (frame.data.length < echo.length || echo.some((b, i) => frame.data[i] !== b)) {
    return { ok: false, ecu: frame.ecu, reason: "echo" };
  }
  return undefined;
}
