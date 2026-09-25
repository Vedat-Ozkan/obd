// Stage A imports obd-core by relative path, as packages/obd-battery/scripts/twelve-volt-report.ts does:
// the "obd-core/vehicles" export is Codex's uncommitted T2.6 change and must not be relied on here.
import { Elm327Session, ElmSessionError } from "../../obd-core/src/elm/session.js";
import type { Frame } from "../../obd-core/src/elm/isotp.js";
import type { RecordingLine } from "../../obd-core/src/recording/format.js";
import { ReplayTransport } from "../../obd-core/src/transport/replay.js";
import { decodeObdbMode22 } from "../../obd-core/src/vehicles/obdb/decode.js";
import type { ObdbMode22Signal } from "../../obd-core/src/vehicles/obdb/import.js";
import type { VehicleProfile } from "../../obd-core/src/vehicles/profile.js";

// Behavior and every constant: docs/specs/T2.4-charge-logger.md (§Interfaces, §Sources, §Policy values, Decisions 8–9).

const GROUP_DIDS = ["2AE1", "2AE2", "2AE3", "2AE4", "2AE5", "2AE6", "2AE7"];

/** Every cycle, in this order. Sources: spec §Sources. Raw-only DIDs are recorded and not decoded in T2.4. */
export const CHARGE_LOG_PROFILE: VehicleProfile = {
  protocol: "7",
  mode22: [
    { target: "17", dids: ["2414", "2885"] },
    { target: "CB", dids: ["27AF", "2B43", "2AF5", ...GROUP_DIDS, "27C6", "276D", "2AF7", "2AF1"] },
  ],
};

// Policy values, not vehicle constants (spec §Policy values; Decision 3).
export const MAX_GAP_S = 10;
export const REST_CURRENT_A = 2.0;
export const CHARGE_CURRENT_A = 5.0;
export const MIN_CHARGE_S = 60;
export const PRE_REST_S = 600;
export const POST_REST_S = 1800;
export const TRANSITION_S = 300;

/** 80 valid records = 10 modules x 8 groups (spec §Sources; confirmed on the P1 recording, Decision 8). */
const GROUP_RECORDS = 80;

export interface Point { t: number; value: number }
export interface GroupSet { t: number; volts: readonly number[]; modules: readonly number[] }
export interface CellMinMax { t: number; min: number; max: number }
/** A 2AE1–2AE7 set that was started and not kept: a missing reply, or a record count other than 80 (Decision 8). */
export interface DroppedGroupSet { t: number; reason: "incomplete" | "not-80-records"; valid?: number }
/** A "charge-log session" boundary (Decision 9). */
export interface SessionMark { t: number; reason: string }
/** A recorded state mark (meta "state"), used only to break statistics down. */
export interface StateMark { t: number; state: string }

export interface ChargeLog {
  recording: string;
  synthetic: boolean;
  current: readonly Point[];
  packVolts: readonly Point[];
  energyKwh: readonly Point[];
  soc: readonly Point[];
  groups: readonly GroupSet[];
  cellMinMax: readonly CellMinMax[];
  droppedGroupSets: readonly DroppedGroupSet[];
  /** Filled by chargeLogFromRecording; ChargeLogBuilder.log() leaves both out (Decision 12). */
  sessions?: readonly SessionMark[];
  states?: readonly StateMark[];
}

export interface Window { start: number; end: number }
export interface ChargePhases {
  preRest?: Window; charge?: Window; postRest?: Window;
  /** Decision 10: the uncut post-charge rest run; postRest is this run clipped to POST_REST_S. The gate tests this run's length. */
  postRestRun?: Window;
  /** Largest gap between consecutive samples, with where it starts, over the gate span (preRest.start to postRest.end), or the whole log when either rest is missing. */
  currentGap: { seconds: number; at: number };
  groupGap: { seconds: number; at: number };
}

/** Data after the 62 <DID> echo from the target module, or undefined. */
function payload(target: string, did: string, frames: readonly Frame[]): Uint8Array | undefined {
  const echo = [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16)];
  const frame = frames.find((f) => f.header.toUpperCase() === `18DAF1${target}` && f.negative === undefined && echo.every((b, i) => f.data[i] === b));
  return frame?.data.subarray(3);
}

const u16 = (d: Uint8Array) => (d[0] << 8) | d[1];
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Seconds from a to b at the recordings' millisecond resolution, so 10.35 - 0.35 compares as exactly 10. */
export const span = (a: number, b: number) => round(b - a, 3);

/** Incremental: one call per Mode 22 reply. Used by the replay below and, in B1, live on the phone. */
export class ChargeLogBuilder {
  private readonly current: Point[] = [];
  private readonly packVolts: Point[] = [];
  private readonly energyKwh: Point[] = [];
  private readonly soc: Point[] = [];
  private readonly groups: GroupSet[] = [];
  private readonly cellMinMax: CellMinMax[] = [];
  private readonly dropped: DroppedGroupSet[] = [];
  /** The 2AE1–2AE7 set being read: its start time and the payloads so far; undefined when none is open. */
  private open: { t: number; parts: Uint8Array[] } | undefined;
  private readonly signals: readonly ObdbMode22Signal[];

  constructor(private readonly recording: string, private readonly synthetic: boolean, signals: readonly ObdbMode22Signal[]) {
    this.signals = signals.filter((s) => s.module === "CB" && (s.id === "EQUINOXEV_SOC" || s.id.startsWith("EQUINOXEV_HVBAT_C_V_")));
  }

  add(t: number, target: string, did: string, frames: readonly Frame[]): void {
    if (target === "CB" && GROUP_DIDS.includes(did)) {
      this.addGroup(t, did, payload(target, did, frames));
      return;
    }
    const data = payload(target, did, frames);
    if (data === undefined) return;
    const key = `${target}/${did}`;
    // 17/2414: s16 big-endian / 20 A, negative = into the pack (P1 recording; docs/discovery-2026-09.md §7.4).
    if (key === "17/2414" && data.length >= 2) this.current.push({ t, value: round((u16(data) << 16 >> 16) / 20, 2) });
    // 17/2885: u16 / 100 V (P1 recording; §7.4).
    if (key === "17/2885" && data.length >= 2) this.packVolts.push({ t, value: round(u16(data) / 100, 2) });
    // CB/27AF: u16 / 100 kWh (P1 recording; §7.4).
    if (key === "CB/27AF" && data.length >= 2) this.energyKwh.push({ t, value: round(u16(data) / 100, 2) });
    // CB/2B43 (SOC) and CB/2AF5 (cell min/max) through the OBDb signalset.
    if (key === "CB/2B43" || key === "CB/2AF5") {
      const readings = frames.flatMap((f) => decodeObdbMode22(did, f, this.signals));
      const value = (id: string) => readings.find((r) => r.ok && r.id === id && r.ecu === "CB");
      const pick = (id: string) => { const r = value(id); return r?.ok ? r.value : undefined; };
      if (key === "CB/2B43") {
        const soc = pick("EQUINOXEV_SOC");
        if (soc !== undefined) this.soc.push({ t, value: soc });
      } else {
        const min = pick("EQUINOXEV_HVBAT_C_V_MIN");
        const max = pick("EQUINOXEV_HVBAT_C_V_MAX");
        if (min !== undefined && max !== undefined) this.cellMinMax.push({ t, min, max });
      }
    }
  }

  // CB/2AE1–2AE7: 3-byte records [u16 x 0.0001 V][module 1–10] (spec §Sources; Decision 8).
  private addGroup(t: number, did: string, data: Uint8Array | undefined): void {
    const index = GROUP_DIDS.indexOf(did);
    if (index === 0) {
      if (this.open !== undefined) this.dropped.push({ t: this.open.t, reason: "incomplete" });
      this.open = { t, parts: [] };
    }
    const open = this.open;
    if (open === undefined) return;
    if (data === undefined || open.parts.length !== index) {
      this.dropped.push({ t: open.t, reason: "incomplete" });
      this.open = undefined;
      return;
    }
    open.parts.push(data);
    if (index < GROUP_DIDS.length - 1) return;
    this.open = undefined;
    const volts: number[] = [];
    const modules: number[] = [];
    for (const part of open.parts) {
      for (let i = 0; i + 3 <= part.length; i += 3) {
        const module = part[i + 2];
        if (module < 1 || module > 10) continue;
        volts.push(round(u16(part.subarray(i)) / 10000, 4));
        modules.push(module);
      }
    }
    if (volts.length === GROUP_RECORDS) this.groups.push({ t: open.t, volts, modules });
    else this.dropped.push({ t: open.t, reason: "not-80-records", valid: volts.length });
  }

  log(): ChargeLog {
    return {
      recording: this.recording, synthetic: this.synthetic,
      current: [...this.current], packVolts: [...this.packVolts], energyKwh: [...this.energyKwh], soc: [...this.soc],
      groups: [...this.groups], cellMinMax: [...this.cellMinMax],
      droppedGroupSets: this.open === undefined ? [...this.dropped] : [...this.dropped, { t: this.open.t, reason: "incomplete" }],
    };
  }
}

const isBoundary = (line: RecordingLine) => line.dir === "meta" && line.event === "charge-log session";

/** Replays the recording through Elm327Session + ReplayTransport, one session per "charge-log session" meta boundary (Decision 9). t = the command's tx line t. */
export async function chargeLogFromRecording(lines: readonly RecordingLine[], recording: string, signals: readonly ObdbMode22Signal[]): Promise<ChargeLog> {
  const first = lines.find((line) => line.dir === "meta");
  const builder = new ChargeLogBuilder(recording, first?.dir === "meta" && first.synthetic === true, signals);
  const sessions: SessionMark[] = [];
  const states: StateMark[] = [];
  const segments: RecordingLine[][] = [[]];
  for (const line of lines) {
    if (isBoundary(line)) {
      sessions.push({ t: line.t, reason: line.dir === "meta" && typeof line.reason === "string" ? line.reason : "unknown" });
      segments.push([]);
    } else if (line.dir === "meta" && typeof line.state === "string") {
      states.push({ t: line.t, state: line.state });
    }
    segments[segments.length - 1].push(line);
  }
  for (const segment of segments) {
    if (!segment.some((line) => line.dir === "tx")) continue;
    const session = new Elm327Session(new ReplayTransport(segment));
    let target = "";
    try {
      const txs = segment.filter((line) => line.dir === "tx");
      for (const [i, line] of txs.entries()) {
        const command = line.data.replace(/\r$/, "");
        try {
          const response = await session.send(command, { retry: false, timeoutMs: 500 });
          if (command.startsWith("ATSH ")) target = command.slice(-4, -2);
          const did = /^22 ([0-9A-F]{4})$/.exec(command)?.[1];
          // Only the answered attempt adds a sample: not an error reply the live logger stopped on (Decision 17), and not an
          // attempt core retried, i.e. one whose next tx in this segment is the same command (Decision 18).
          const retried = txs.at(i + 1)?.data === line.data;
          if (did !== undefined && response.kind !== "error" && !retried) builder.add(line.t, target, did, response.frames);
        } catch (error) {
          if (!(error instanceof ElmSessionError && error.kind === "timeout")) throw error;
        }
      }
    } finally {
      await session.close();
    }
  }
  return { ...builder.log(), sessions, states };
}

/** Largest gap between consecutive samples with both inside `within` (the whole list without one); where it starts. */
export function largestGap(samples: readonly { t: number }[], within?: Window): { seconds: number; at: number } {
  const inside = within === undefined ? samples : samples.filter((s) => s.t >= within.start && s.t <= within.end);
  let gap = { seconds: inside.length < 2 ? Infinity : 0, at: inside.length > 0 ? inside[0].t : (within?.start ?? 0) };
  for (let i = 1; i < inside.length; i++) {
    const seconds = span(inside[i - 1].t, inside[i].t);
    if (seconds > gap.seconds) gap = { seconds, at: inside[i - 1].t };
  }
  return gap;
}

type CurrentClass = "rest" | "charge" | "other";
const classOf = (amps: number): CurrentClass => Math.abs(amps) <= REST_CURRENT_A ? "rest" : amps <= -CHARGE_CURRENT_A ? "charge" : "other";

/** Maximal runs of consecutive current samples in one class; a gap > MAX_GAP_S ends a run. */
function runs(current: readonly Point[]): { kind: CurrentClass; start: number; end: number }[] {
  const out: { kind: CurrentClass; start: number; end: number }[] = [];
  for (const [i, p] of current.entries()) {
    const kind = classOf(p.value);
    const last = out.at(-1);
    if (last !== undefined && last.kind === kind && span(current[i - 1].t, p.t) <= MAX_GAP_S) last.end = p.t;
    else out.push({ kind, start: p.t, end: p.t });
  }
  return out;
}

export function chargePhases(log: ChargeLog): ChargePhases {
  const all = runs(log.current);
  let charge: Window | undefined;
  for (const run of all) {
    if (run.kind === "charge" && span(run.start, run.end) >= MIN_CHARGE_S && (charge === undefined || span(run.start, run.end) > span(charge.start, charge.end))) {
      charge = { start: run.start, end: run.end };
    }
  }
  let preRest: Window | undefined;
  let postRest: Window | undefined;
  let postRestRun: Window | undefined;
  if (charge !== undefined) {
    const c = charge;
    const pre = all.filter((run) => run.kind === "rest" && span(run.start, run.end) >= PRE_REST_S && run.end < c.start && span(run.end, c.start) <= TRANSITION_S).at(-1);
    if (pre !== undefined) preRest = { start: pre.start, end: pre.end };
    const post = all.find((run) => run.kind === "rest" && run.start > c.end && span(c.end, run.start) <= TRANSITION_S);
    if (post !== undefined) {
      const clipped = log.current.filter((p) => p.t >= post.start && span(post.start, p.t) <= POST_REST_S && p.t <= post.end).at(-1);
      postRest = { start: post.start, end: clipped?.t ?? post.start };
      postRestRun = { start: post.start, end: post.end };
    }
  }
  const gate = preRest !== undefined && postRest !== undefined ? { start: preRest.start, end: postRest.end } : undefined;
  return {
    ...(preRest ? { preRest } : {}), ...(charge ? { charge } : {}), ...(postRest ? { postRest } : {}), ...(postRestRun ? { postRestRun } : {}),
    currentGap: largestGap(log.current, gate),
    groupGap: largestGap(log.groups, gate),
  };
}
