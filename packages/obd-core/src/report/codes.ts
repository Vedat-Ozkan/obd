// Codes report model and the "recently cleared" verdict: docs/specs/T0.7-codes-report.md "Stage B2: codes.ts".
// Heuristic: docs/PLAN.md T0.7 row; permanent codes as the strong path: docs/ELM327.md §Standard modes, row 0A.
// Layouts and decoders: src/obd/* (docs/ELM327.md §J1979 conventions).
import type { Frame } from "../elm/isotp.js";
import type { ElmResponse } from "../elm/session.js";
import { decodeDtcList, type DtcMode } from "../obd/dtc.js";
import { decodeFreezeDtc, decodeFreezePid } from "../obd/freeze.js";
import { decodePid, MODE01_PIDS, type PidReading, type Unit } from "../obd/j1979.js";
import { decodeReadiness, type Monitor } from "../obd/readiness.js";
import type { DecodeFailure } from "../obd/response.js";
import { decodeSupported } from "../obd/supported.js";

/** One command sent during a scan and its response, in send order. T0.9 builds these; replay builds them in tests. */
export interface CodesExchange { command: string; response: ElmResponse }

export type Tri = "yes" | "no" | "unknown";

type Failed = { status: "failed"; reason: DecodeFailure["reason"]; code?: number };
type NotRead = { status: "not-read" }; // not requested, or requested and this module sent no frame
type Unsupported = { status: "unsupported" }; // the module's bitmap covering this PID was read and does not flag it

export type DtcRead = { status: "read"; dtcs: string[] } | Failed | NotRead;
export type PidValue = { status: "read"; value: number; unit: Unit } | Unsupported | Failed | NotRead;
export type ReadinessRead = { status: "read"; mil: boolean; dtcCount: number; monitors: Monitor[] } | Unsupported | Failed | NotRead;
export type FreezeFrame =
  | { status: "none-stored" } // PID 02 = 00 00: nothing else from Mode 02 is shown
  | { status: "stored"; dtc: string; readings: PidReading[] } // readings: frame-0 MODE01_PIDS values, ascending PID
  | Failed | NotRead;

/** PIDs the codes report shows: MIL distance/time and the three "since codes cleared" counters. */
export type CodesPid = "21" | "30" | "31" | "4D" | "4E";

export interface ModuleCodes {
  ecu: string; // Frame.ecu: "17", "7E8"
  stored: DtcRead; // Mode 03
  pending: DtcRead; // Mode 07
  permanent: DtcRead; // Mode 0A
  readiness: ReadinessRead; // PID 01
  pids: Record<CodesPid, PidValue>;
  freezeFrame: FreezeFrame; // Mode 02 frame 0
}

export interface ClearLegs {
  noStoredDtcs: Tri;
  monitorsIncomplete: Tri;
  countersLow: Tri;
  permanentDtcs: Tri;
}

export interface RecentlyCleared {
  verdict: "indicated" | "not-indicated" | "unknown";
  /** The permanent-DTC path fired (docs/ELM327.md §Standard modes, row 0A). */
  strong: boolean;
  legs: ClearLegs;
}

export interface CodesReport {
  modules: ModuleCodes[]; // ascending by ecu
  recentlyCleared: RecentlyCleared;
}

/** POLICY values (Decisions, Q1), not from a standard: a counter below its value is "low". Set by the owner
 *  (2026-09-24) to catch a clear within roughly the last few days of ordinary use before a sale; round numbers,
 *  not measured; revisit with beta recordings. */
export const LOW_COUNTER: Readonly<Record<"30" | "31" | "4E", number>> = { "30": 10, "31": 100, "4E": 600 };

const CODES_PIDS: readonly CodesPid[] = ["21", "30", "31", "4D", "4E"];
// Covering supported-PID bitmap per Mode 01 PID: docs/ELM327.md §J1979 conventions "Supported-PID bitmaps".
const BITMAP_FOR: Readonly<Record<"01" | CodesPid, string>> = {
  "01": "0100", "21": "0120", "30": "0120", "31": "0120", "4D": "0140", "4E": "0140",
};
const DTC_MODES: Readonly<Record<"03" | "07" | "0A", DtcMode>> = { "03": 0x03, "07": 0x07, "0A": 0x0a };
const RECOGNIZED = new Set(["0100", "0120", "0140", "0101", "0121", "0130", "0131", "014D", "014E", "03", "07", "0A", "020200"]);

const pidHex = (pid: number) => pid.toString(16).padStart(2, "0").toUpperCase();
// Mode 02 frame 0 only: docs/ELM327.md §J1979 conventions "Mode 02 reply layout".
const freezeCommand = (pid: number) => `02${pidHex(pid)}00`;
for (const d of MODE01_PIDS) RECOGNIZED.add(freezeCommand(d.pid));

function failed(f: DecodeFailure): Failed {
  return f.code === undefined ? { status: "failed", reason: f.reason } : { status: "failed", reason: f.reason, code: f.code };
}

type FrameOf = (command: string) => Frame | undefined;

/** The PID's covering bitmap was decoded for this ECU and does not flag it. */
function unsupported(frameOf: FrameOf, pid: "01" | CodesPid): boolean {
  const bitmap = BITMAP_FOR[pid];
  const frame = frameOf(bitmap);
  if (frame === undefined) return false;
  const r = decodeSupported(parseInt(bitmap.slice(2), 16), frame);
  return r.ok && !r.pids.includes(parseInt(pid, 16));
}

function dtcRead(frameOf: FrameOf, mode: "03" | "07" | "0A"): DtcRead {
  const frame = frameOf(mode);
  if (frame === undefined) return { status: "not-read" };
  const r = decodeDtcList(DTC_MODES[mode], frame);
  return r.ok ? { status: "read", dtcs: r.dtcs } : failed(r);
}

function pidValue(frameOf: FrameOf, pid: CodesPid): PidValue {
  const frame = frameOf(`01${pid}`);
  if (frame === undefined) return unsupported(frameOf, pid) ? { status: "unsupported" } : { status: "not-read" };
  const r = decodePid(parseInt(pid, 16), frame);
  return r.ok ? { status: "read", value: r.value, unit: r.unit } : failed(r);
}

function readinessRead(frameOf: FrameOf): ReadinessRead {
  const frame = frameOf("0101");
  if (frame === undefined) return unsupported(frameOf, "01") ? { status: "unsupported" } : { status: "not-read" };
  const r = decodeReadiness(0x01, frame);
  return r.ok ? { status: "read", mil: r.mil === true, dtcCount: r.dtcCount ?? 0, monitors: r.monitors } : failed(r);
}

/** No Mode 02 value is carried unless PID 02 names a DTC (T0.5 Stage C decision). */
function freezeFrame(frameOf: FrameOf): FreezeFrame {
  const frame = frameOf("020200");
  if (frame === undefined) return { status: "not-read" };
  const r = decodeFreezeDtc(0, frame);
  if (!r.ok) return failed(r);
  if (r.dtc === undefined) return { status: "none-stored" };
  const readings: PidReading[] = [];
  for (const d of [...MODE01_PIDS].sort((a, b) => a.pid - b.pid)) {
    const f = frameOf(freezeCommand(d.pid));
    const reading = f === undefined ? undefined : decodeFreezePid(d.pid, 0, f);
    if (reading?.ok) readings.push(reading);
  }
  return { status: "stored", dtc: r.dtc, readings };
}

function moduleCodes(ecu: string, frameOf: FrameOf): ModuleCodes {
  const pids = Object.fromEntries(CODES_PIDS.map((p) => [p, pidValue(frameOf, p)])) as Record<CodesPid, PidValue>;
  return {
    ecu,
    stored: dtcRead(frameOf, "03"),
    pending: dtcRead(frameOf, "07"),
    permanent: dtcRead(frameOf, "0A"),
    readiness: readinessRead(frameOf),
    pids,
    freezeFrame: freezeFrame(frameOf),
  };
}

function legs(modules: readonly ModuleCodes[]): ClearLegs {
  const stored = modules.map((m) => m.stored);
  const permanent = modules.map((m) => m.permanent);
  const lists = (reads: DtcRead[]) => reads.flatMap((r) => (r.status === "read" ? [r.dtcs] : []));
  const monitors = modules.flatMap((m) => (m.readiness.status === "read" ? [m.readiness.monitors] : []));
  const counters = modules.flatMap((m) =>
    (["30", "31", "4E"] as const).flatMap((pid) => {
      const v = m.pids[pid];
      return v.status === "read" ? [v.value < LOW_COUNTER[pid]] : [];
    }),
  );
  let noStoredDtcs: Tri = "unknown";
  if (lists(stored).some((d) => d.length > 0)) noStoredDtcs = "no";
  else if (!stored.some((r) => r.status === "failed") && lists(stored).length > 0) noStoredDtcs = "yes";
  const permanentDtcs: Tri = lists(permanent).some((d) => d.length > 0) ? "yes" : lists(permanent).length > 0 ? "no" : "unknown";
  // Absent monitors are not in Readiness.monitors, so they are never read as incomplete (T0.5 Risks).
  const monitorsIncomplete: Tri = monitors.some((ms) => ms.some((x) => !x.complete))
    ? "yes"
    : monitors.some((ms) => ms.length > 0) ? "no" : "unknown";
  const countersLow: Tri = counters.some(Boolean) ? "yes" : counters.length > 0 ? "no" : "unknown";
  return { noStoredDtcs, monitorsIncomplete, countersLow, permanentDtcs };
}

/** The verdict from the four legs; exported for the one isolated test (Verification, failure 10). */
export function recentlyCleared(l: ClearLegs): RecentlyCleared {
  const standard = l.noStoredDtcs === "yes" && l.monitorsIncomplete === "yes" && l.countersLow === "yes";
  const strong = l.noStoredDtcs === "yes" && l.permanentDtcs === "yes" && l.monitorsIncomplete === "yes";
  // POLICY (Decisions, Q2): only a counter read at or above its threshold can say "not indicated", because only
  // the counters measure time or distance since a clear. Anything else that is not "indicated" is unknown.
  const verdict = standard || strong ? "indicated" : l.countersLow === "no" ? "not-indicated" : "unknown";
  return { verdict, strong, legs: l };
}

export function buildCodesReport(exchanges: readonly CodesExchange[]): CodesReport {
  const byCommand = new Map<string, ElmResponse>();
  for (const { command, response } of exchanges) {
    const c = command.replace(/ /g, "").toUpperCase();
    if (RECOGNIZED.has(c)) byCommand.set(c, response); // a repeated command: the later exchange wins
  }
  const ecus = [...new Set([...byCommand.values()].flatMap((r) => r.frames.map((f) => f.ecu)))].sort();
  const modules = ecus.map((ecu) =>
    moduleCodes(ecu, (command) => byCommand.get(command)?.frames.find((f) => f.ecu === ecu)),
  );
  return { modules, recentlyCleared: recentlyCleared(legs(modules)) };
}
