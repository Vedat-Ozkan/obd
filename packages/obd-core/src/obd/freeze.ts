// Mode 02 freeze frame: docs/specs/T0.5-standard-decoding.md Stage C.
// Reply layout 42 <pid> <frame#> <data>, and PID 02 = 00 00 meaning no snapshot: docs/ELM327.md §J1979 conventions
// ("Mode 02 reply layout"). The data after the frame number is laid out as in Mode 01, so the Mode 01 decoders
// are reused on the reply rewritten to 41 <pid> <data>.
import type { Frame } from "../elm/isotp.js";
import { decodeDtc } from "./dtc.js";
import { decodePid, type PidReading } from "./j1979.js";
import { checkEcho, type DecodeFailure } from "./response.js";
import { decodeSupported, type Supported } from "./supported.js";

export interface FreezeDtc {
  ok: true;
  ecu: string;
  frameNo: number;
  /** undefined when the reply is 00 00: no freeze frame stored. */
  dtc?: string;
}

/** checkEcho [0x42, pid, frameNo]; then the data as a Mode 01 reply. The frame number catches a mismatched reply. */
function asMode01(pid: number, frameNo: number, frame: Frame): Frame | DecodeFailure {
  const failure = checkEcho(frame, [0x42, pid, frameNo]);
  if (failure !== undefined) return failure;
  return { ...frame, data: Uint8Array.of(0x41, pid, ...frame.data.subarray(3)) };
}

/** PID 02 of freeze frame `frameNo`: the DTC that stored it; data.length !== 5 -> "length". */
export function decodeFreezeDtc(frameNo: number, frame: Frame): FreezeDtc | DecodeFailure {
  const failure = checkEcho(frame, [0x42, 0x02, frameNo]);
  if (failure !== undefined) return failure;
  const { data } = frame;
  if (data.length !== 5) return { ok: false, ecu: frame.ecu, reason: "length" };
  const result: FreezeDtc = { ok: true, ecu: frame.ecu, frameNo };
  if (data[3] !== 0 || data[4] !== 0) result.dtc = decodeDtc(data[3], data[4]);
  return result;
}

/** A MODE01_PIDS pid read from freeze frame `frameNo`; same scaling and failures as decodePid. */
export function decodeFreezePid(pid: number, frameNo: number, frame: Frame): (PidReading & { frameNo: number }) | DecodeFailure {
  const f = asMode01(pid, frameNo, frame);
  if ("ok" in f) return f;
  const r = decodePid(pid, f);
  return r.ok ? { ...r, frameNo } : r;
}

/** A supported-PID bitmap (base in BITMAP_PIDS) of freeze frame `frameNo`; same failures as decodeSupported. */
export function decodeFreezeSupported(base: number, frameNo: number, frame: Frame): (Supported & { frameNo: number }) | DecodeFailure {
  const f = asMode01(base, frameNo, frame);
  if ("ok" in f) return f;
  const r = decodeSupported(base, f);
  return r.ok ? { ...r, frameNo } : r;
}
