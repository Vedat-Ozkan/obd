import type { Frame } from "../elm/isotp.js";
import { decodeDtc } from "./dtc.js";
import { decodePid, type PidReading } from "./j1979.js";
import { checkEcho, type DecodeFailure } from "./response.js";
import { decodeSupported, type Supported } from "./supported.js";

export interface FreezeDtc {
  ok: true;
  ecu: string;
  frameNo: number;
  dtc?: string;
}

function asMode01(pid: number, frameNo: number, frame: Frame): Frame | DecodeFailure {
  const failure = checkEcho(frame, [0x42, pid, frameNo]);
  if (failure !== undefined) return failure;
  return { ...frame, data: Uint8Array.of(0x41, pid, ...frame.data.subarray(3)) };
}

export function decodeFreezeDtc(frameNo: number, frame: Frame): FreezeDtc | DecodeFailure {
  const failure = checkEcho(frame, [0x42, 0x02, frameNo]);
  if (failure !== undefined) return failure;
  const { data } = frame;
  if (data.length !== 5) return { ok: false, ecu: frame.ecu, reason: "length" };
  const result: FreezeDtc = { ok: true, ecu: frame.ecu, frameNo };
  if (data[3] !== 0 || data[4] !== 0) result.dtc = decodeDtc(data[3], data[4]);
  return result;
}

export function decodeFreezePid(pid: number, frameNo: number, frame: Frame): (PidReading & { frameNo: number }) | DecodeFailure {
  const f = asMode01(pid, frameNo, frame);
  if ("ok" in f) return f;
  const r = decodePid(pid, f);
  return r.ok ? { ...r, frameNo } : r;
}

export function decodeFreezeSupported(base: number, frameNo: number, frame: Frame): (Supported & { frameNo: number }) | DecodeFailure {
  const f = asMode01(base, frameNo, frame);
  if ("ok" in f) return f;
  const r = decodeSupported(base, f);
  return r.ok ? { ...r, frameNo } : r;
}
