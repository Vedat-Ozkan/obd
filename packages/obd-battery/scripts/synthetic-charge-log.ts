import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Writes fixtures/synthetic/charge-log-rested.jsonl and its .label.json (docs/specs/T2.4-charge-logger.md
// §Verification, Stage A). Deterministic: integer milliseconds, no clock, no randomness.
// Encodings mirror the decoder's sourced scalings (spec §Sources), so this fixture cannot catch a wrong scaling;
// the P1 recording does that. Everything here is synthetic, not the car's.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE = "fixtures/synthetic/charge-log-rested.jsonl";
const LABEL = "fixtures/synthetic/charge-log-rested.label.json";

const CYCLE_MS = 10_000;
const STEP_MS = 50;
const REPLY_MS = 20;
/** Synthetic capacity, small so that the 900 s charge covers ΔSOC >= 30 %. Not the car's. */
const CAPACITY_AH = 12;
const PACK_V = 312;
const CAPACITY_KWH = (CAPACITY_AH * PACK_V) / 1000;
const SOC_START = 40;
const REST_A = 0.5;
const CHARGE_A = -20;
const GROUP_V = 3.9;
const WEAK_RECORD = 21; // 1-based record position; module 3
const WEAK_DROP_V = 0.03;
/** Planted not-80 set: record 80's module byte is 0, so 79 records are valid (Decision 8). */
const NOT_80_VALID = 79;
/** Planted recovery (Decision 19): charge cycle 46 starts 5 s late after a "timeout" session boundary, a 15 s gap then a 5 s one. */
const RECOVERY_CYCLE = 46;
const RECOVERY_DELAY_MS = 5_000;

const GROUP_DIDS = ["2AE1", "2AE2", "2AE3", "2AE4", "2AE5", "2AE6", "2AE7"];
// scanMode22Profile's commands for the decoded DIDs only (packages/obd-core/src/vehicles/scan.ts).
const CYCLE = [
  "ATSP7", "ATCP 18", "ATSH DA17F1", "ATCRA 18DAF117", "ATFCSH 18DA17F1", "ATFCSD 300000", "ATFCSM 1", "22 2414", "22 2885",
  "ATSH DACBF1", "ATCRA 18DAF1CB", "ATFCSH 18DACBF1", "22 27AF", "22 2B43", "22 2AF5", ...GROUP_DIDS.map((d) => `22 ${d}`),
];
const at = (command: string) => CYCLE.indexOf(command) * STEP_MS;

type Phase = "early" | "pre-rest" | "ramp" | "charge" | "post-rest";
interface Cycle { startMs: number; phase: Phase; amps: number; groupNoData?: string; not80?: true; recovery?: true }

function schedule(): Cycle[] {
  const cycles: Cycle[] = [];
  const add = (startMs: number, phase: Phase, amps: number, groupNoData?: string) =>
    cycles.push({ startMs, phase, amps, ...(groupNoData ? { groupNoData } : {}) });
  // Planted: a group set with 79 valid records, a 2AE3 NO DATA cycle, then a 15 s current gap, all before the pre-rest.
  // The 79-record cycle sits 5 s in, so the largest group-set gap stays the NO DATA one, which ends before the pre-rest.
  add(0, "early", REST_A);
  cycles.push({ startMs: 5_000, phase: "early", amps: REST_A, not80: true });
  add(10_000, "early", REST_A, "2AE3");
  add(20_000, "early", REST_A);
  let t = 35_000;
  for (let i = 0; i < 64; i++, t += CYCLE_MS) add(t, "pre-rest", REST_A); // 630 s
  for (let i = 0; i < 13; i++, t += CYCLE_MS) add(t, "ramp", -2.5 - 0.15 * i); // 120 s in the "other" class
  for (let i = 0; i < 91; i++, t += CYCLE_MS) { // 900 s
    if (i === RECOVERY_CYCLE) cycles.push({ startMs: t + RECOVERY_DELAY_MS, phase: "charge", amps: CHARGE_A, recovery: true });
    else add(t, "charge", CHARGE_A);
  }
  for (let i = 0; i < 184; i++, t += CYCLE_MS) add(t, "post-rest", REST_A); // 1830 s
  return cycles;
}

/** The true current is piecewise linear through the 2414 samples, so its integral is exact under the trapezoid rule. */
function trueSoc(samples: readonly { t: number; amps: number }[]): (t: number) => number {
  return (t: number) => {
    let ampSeconds = 0;
    for (let i = 1; i < samples.length && samples[i - 1].t < t; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const end = Math.min(t, b.t);
      const ampsAtEnd = a.amps + ((b.amps - a.amps) * (end - a.t)) / (b.t - a.t);
      ampSeconds += ((a.amps + ampsAtEnd) / 2) * (end - a.t);
    }
    return SOC_START - (100 * ampSeconds) / 3600 / CAPACITY_AH;
  };
}

const hex = (bytes: readonly number[]) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];

/** ISO-TP frames as the ELM prints them with ATH1 and ATS0 (see the P1 recording). */
function reply(module: string, did: string, data: readonly number[]): string {
  const header = `18DAF1${module}`;
  const payload = [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16), ...data];
  if (payload.length <= 7) return `${header}${hex([payload.length, ...payload])}\r\r>`;
  const lines = [`${header}${hex([0x10 | (payload.length >> 8), payload.length & 0xff, ...payload.slice(0, 6)])}`];
  for (let i = 6, n = 1; i < payload.length; i += 7, n++) lines.push(`${header}${hex([0x20 | (n & 0x0f), ...payload.slice(i, i + 7)])}`);
  return `${lines.join("\r")}\r\r>`;
}

function groupVolts(): number[] {
  return Array.from({ length: 80 }, (_, i) => i + 1 === WEAK_RECORD ? GROUP_V - WEAK_DROP_V : GROUP_V + (i % 5) * 0.0002);
}

export function generate(): { jsonl: string; label: string } {
  const cycles = schedule();
  const samples = cycles.map((c) => ({ t: (c.startMs + at("22 2414")) / 1000, amps: c.amps }));
  const soc = trueSoc(samples);
  const counts = groupVolts().map((v) => Math.round(v * 10000));
  const records = counts.flatMap((count, i) => [...u16(count), Math.floor(i / 8) + 1]);
  while (records.length < GROUP_DIDS.length * 36) records.push(0, 0, 0); // 84 records per set; the last 4 are zero
  const not80Records = records.map((b, i) => (i === 80 * 3 - 1 ? 0 : b));
  const avg = Math.round(counts.reduce((s, c) => s + c, 0) / counts.length);

  const lines: object[] = [
    { t: 0, dir: "meta", synthetic: true, car: "none", dongle: "none", script: "packages/obd-battery/scripts/synthetic-charge-log.ts", note: `synthetic charge log for T2.4 Stage A: ${String(CAPACITY_AH)} Ah synthetic capacity (not the car's), one cell group ${String(WEAK_DROP_V * 1000)} mV low, a 79-record group set, a 2AE3 NO DATA cycle and a 15 s current gap before the pre-rest, and a 15 s timeout-recovery gap with a session boundary during the charge (no timed-out command or re-init recorded); encodings follow the decoder's sourced scalings (docs/specs/T2.4-charge-logger.md, Sources); timestamps invented` },
    { t: 0, dir: "meta", event: "charge-log session", reason: "start" },
  ];
  for (const cycle of cycles) {
    // The boundary the phone writes before a new session's ATZ; this fixture's sessions have no init, like its first one.
    if (cycle.recovery) lines.push({ t: (cycle.startMs - 1_000) / 1000, dir: "meta", event: "charge-log session", reason: "timeout" });
    for (const command of CYCLE) {
      const txMs = cycle.startMs + at(command);
      const t = txMs / 1000;
      const did = /^22 (....)$/.exec(command)?.[1];
      let rx = "OK\r\r>";
      if (did === "2414") rx = reply("17", did, u16(Math.round(cycle.amps * 20) & 0xffff));
      if (did === "2885") rx = reply("17", did, u16(Math.round(PACK_V * 100)));
      if (did === "27AF") rx = reply("CB", did, u16(Math.round((CAPACITY_KWH * soc(t)) / 100 * 100)));
      if (did === "2B43") rx = reply("CB", did, [Math.round((soc(t) * 255) / 100)]);
      if (did === "2AF5") rx = reply("CB", did, [...u16(avg), ...u16(Math.min(...counts)), ...u16(Math.max(...counts))]);
      const group = did === undefined ? -1 : GROUP_DIDS.indexOf(did);
      if (did !== undefined && group >= 0) rx = cycle.groupNoData === did ? "NO DATA\r\r>" : reply("CB", did, (cycle.not80 ? not80Records : records).slice(group * 36, group * 36 + 36));
      lines.push({ t, dir: "tx", data: `${command}\r` }, { t: (txMs + REPLY_MS) / 1000, dir: "rx", data: rx });
    }
  }

  const sampleT = (phase: Phase, which: "first" | "last") => {
    const inPhase = cycles.filter((c) => c.phase === phase);
    const c = which === "first" ? inPhase[0] : inPhase[inPhase.length - 1];
    return (c.startMs + at("22 2414")) / 1000;
  };
  const postStart = sampleT("post-rest", "first");
  const socT = (window: { start: number; end: number }) =>
    cycles.map((c) => (c.startMs + at("22 2B43")) / 1000).filter((t) => t >= window.start && t <= window.end).at(-1) ?? NaN;
  const windows = {
    preRest: { start: sampleT("pre-rest", "first"), end: sampleT("pre-rest", "last") },
    charge: { start: sampleT("charge", "first"), end: sampleT("charge", "last") },
    postRest: { start: postStart, end: samples.filter((s) => s.t <= postStart + 1800).at(-1)?.t ?? NaN },
  };
  const early = samples.filter((_, i) => cycles[i].phase === "early");
  const groupT = (c: Cycle) => (c.startMs + at("22 2AE1")) / 1000;
  const recovery = cycles.findIndex((c) => c.recovery);
  const label = {
    car: "none",
    session: "charge",
    condition: "fault",
    reference: {
      method: "synthetic-generator",
      capacity_ah: CAPACITY_AH,
      capacity_kwh: CAPACITY_KWH,
      soc_start: Math.round(soc(socT(windows.preRest)) * 10000) / 10000,
      soc_end: Math.round(soc(socT(windows.postRest)) * 10000) / 10000,
    },
    fault: { id: "cell-imbalance", detail: `record ${String(WEAK_RECORD)} of 80 (module ${String(Math.floor((WEAK_RECORD - 1) / 8) + 1)}) held ${String(WEAK_DROP_V * 1000)} mV below the others`, injected_at_s: 0 },
    windows,
    weak_group: { index: WEAK_RECORD, module: Math.floor((WEAK_RECORD - 1) / 8) + 1 },
    planted: {
      current_gap: { seconds: 15, at: early[early.length - 1].t },
      group_gap: { seconds: 20, at: groupT(cycles[0]) },
      not_80_group_set: { at: groupT(cycles[1]), valid: NOT_80_VALID }, // schedule() plants it second
      recovery_gap: { seconds: (CYCLE_MS + RECOVERY_DELAY_MS) / 1000, at: samples[recovery - 1].t },
    },
    notes: "Generator truth for a synthetic charge log. The capacity is synthetic, not the car's; the scalings are the decoder's own, so only the P1 recording checks them.",
    synthetic: true,
  };
  return { jsonl: lines.map((line) => JSON.stringify(line)).join("\n") + "\n", label: JSON.stringify(label, null, 2) + "\n" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { jsonl, label } = generate();
  writeFileSync(resolve(root, FIXTURE), jsonl, "latin1");
  writeFileSync(resolve(root, LABEL), label, "utf8");
}
