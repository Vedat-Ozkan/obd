import { z } from "zod";
import { parseRecording, type RecordingLine } from "obd-core/recording";
import { codesReportFromRecording, type CodesReport } from "obd-core/report";
import type { ObdbMode22Signal } from "obd-core/vehicles";
import { groupsUnderLoad, type GroupsUnderLoad } from "./driveGroups.js";
import type { BatteryDiagnosisReport } from "./report.js";
import { chargeLogFromRecording } from "./session.js";

export const GROUP_RULE_STATUS: "unconfirmed" | "confirmed" = "unconfirmed";

export const UNCONFIRMED_LINE = "Group rule: not yet confirmed on a second healthy drive (project policy, set from one car).";
const NO_PRE_DRIVE = "No pre-drive scan to compare.";
const NO_RESCAN = "no codes rescan in this recording";

export interface CodeChange { new: readonly string[]; gone: readonly string[]; unchanged: readonly string[]; notCompared?: string; listed?: readonly string[] }
export interface ModuleCodesChange { ecu: string; note?: "not read before" | "not read after"; stored: CodeChange; pending: CodeChange; permanent: CodeChange }
export interface CodesComparison { status: "compared"; stoppedEarly?: string; modules: readonly ModuleCodesChange[] }
export type DriveCodes = CodesComparison | { status: "not-run"; reason: string };
export interface DriveReport {
  version: 1; garageVehicleId: string; catalogId: "chevrolet-equinox-ev-2024"; scannedAt: string; recording: string;
  minutes: 10 | 20; stopReason: string; groupRule: "unconfirmed" | "confirmed";
  groups: GroupsUnderLoad; codes: DriveCodes;
  preDrive?: { scannedAt: string; recording: string };
}

type DtcRead = CodesReport["modules"][number]["stored"];
const MODES = ["stored", "pending", "permanent"] as const;
const dtcs = (read: DtcRead | undefined): readonly string[] | undefined => read?.status === "read" ? read.dtcs : undefined;

function modeChange(before: DtcRead | undefined, after: DtcRead | undefined): CodeChange {
  const b = dtcs(before);
  const a = dtcs(after);
  if (a !== undefined && b !== undefined) return { new: a.filter((c) => !b.includes(c)), gone: b.filter((c) => !a.includes(c)), unchanged: a.filter((c) => b.includes(c)) };
  const empty = { new: [], gone: [], unchanged: [] };
  if (a !== undefined) return { ...empty, listed: a };
  return { ...empty, notCompared: b !== undefined ? "not read after" : "not read either time" };
}

export function compareCodes(before: CodesReport | undefined, after: CodesReport): CodesComparison {
  const ecus = [...new Set([...(before?.modules ?? []).map((m) => m.ecu), ...after.modules.map((m) => m.ecu)])];
  return {
    status: "compared",
    modules: ecus.map((ecu) => {
      const b = before?.modules.find((m) => m.ecu === ecu);
      const a = after.modules.find((m) => m.ecu === ecu);
      const note = before === undefined ? undefined : b === undefined ? "not read before" as const : a === undefined ? "not read after" as const : undefined;
      return { ecu, ...(note === undefined ? {} : { note }), stored: modeChange(b?.stored, a?.stored), pending: modeChange(b?.pending, a?.pending), permanent: modeChange(b?.permanent, a?.permanent) };
    }),
  };
}

const isMeta = (line: RecordingLine, event: string): boolean => line.dir === "meta" && line.event === event;
const CAR_OFF = /^no current for 60 s/;

async function rescanCodes(lines: readonly RecordingLine[], stopReason: string, preDrive: BatteryDiagnosisReport | undefined): Promise<DriveCodes> {
  const start = lines.findIndex((line) => isMeta(line, "codes rescan"));
  if (start < 0) return { status: "not-run", reason: CAR_OFF.test(stopReason) ? "car off" : /^(\d+ min recorded|disconnect pressed)$/.test(stopReason) ? NO_RESCAN : stopReason };
  const rescan = lines.slice(start + 1);
  const stop = rescan.find((line) => isMeta(line, "codes rescan stopped"));
  const stoppedBy = stop?.dir === "meta" && typeof stop.reason === "string" ? stop.reason : undefined;
  const after = await codesReportFromRecording(rescan);
  if (stoppedBy !== undefined && !after.modules.some((m) => MODES.some((mode) => m[mode].status === "read"))) return { status: "not-run", reason: stoppedBy };
  const compared = compareCodes(preDrive?.codes, after);
  return stoppedBy === undefined ? compared : { ...compared, stoppedEarly: stoppedBy };
}

export async function driveReportFromRecording(jsonl: string, input: { garageVehicleId: string; scannedAt: string; recording: string; minutes: 10 | 20; stopReason: string; signals: readonly ObdbMode22Signal[] }, preDrive?: BatteryDiagnosisReport): Promise<DriveReport> {
  const lines = parseRecording(jsonl);
  const rescanAt = lines.findIndex((line) => isMeta(line, "codes rescan"));
  const driveLines = rescanAt < 0 ? lines : lines.slice(0, rescanAt);
  const log = await chargeLogFromRecording(driveLines, input.recording, input.signals);
  return parseDriveReport({
    version: 1, garageVehicleId: input.garageVehicleId, catalogId: "chevrolet-equinox-ev-2024", scannedAt: input.scannedAt, recording: input.recording,
    minutes: input.minutes, stopReason: input.stopReason, groupRule: GROUP_RULE_STATUS,
    groups: groupsUnderLoad(log), codes: await rescanCodes(lines, input.stopReason, preDrive),
    ...(preDrive === undefined ? {} : { preDrive: { scannedAt: preDrive.scannedAt, recording: preDrive.recording } }),
  });
}

const text = z.string().min(1);
const strings = z.array(z.string());
const change = z.strictObject({ new: strings, gone: strings, unchanged: strings, notCompared: text.optional(), listed: strings.optional() });
const schema = z.strictObject({
  version: z.literal(1), garageVehicleId: text, catalogId: z.literal("chevrolet-equinox-ev-2024"),
  scannedAt: z.iso.datetime({ offset: true }), recording: text, minutes: z.union([z.literal(10), z.literal(20)]), stopReason: text,
  groupRule: z.enum(["unconfirmed", "confirmed"]),
  groups: z.strictObject({
    status: z.enum(["checked", "not-checked"]), reason: text.optional(),
    completeSets: z.number().int(), steadySets: z.number().int(), loadedSets: z.number().int(),
    currentRange: z.strictObject({ min: z.number(), max: z.number() }).optional(),
    groups: z.array(z.strictObject({ index: z.number().int(), module: z.number().int(), excessMohm: z.number(), seMohm: z.number(), lowerMohm: z.number(), flagged: z.boolean() })),
    flagged: z.array(z.number().int()), medianGroupMohm: z.number().optional(),
  }),
  codes: z.union([
    z.strictObject({ status: z.literal("compared"), stoppedEarly: text.optional(), modules: z.array(z.strictObject({ ecu: text, note: z.enum(["not read before", "not read after"]).optional(), stored: change, pending: change, permanent: change })) }),
    z.strictObject({ status: z.literal("not-run"), reason: text }),
  ]),
  preDrive: z.strictObject({ scannedAt: z.iso.datetime({ offset: true }), recording: text }).optional(),
});

export function parseDriveReport(data: unknown): DriveReport {
  return schema.parse(data);
}

const list = (codes: readonly string[]): string => codes.length === 0 ? "none" : codes.join(", ");

function describe(name: string, change: CodeChange): string {
  if (change.notCompared !== undefined) return `${name}: not compared (${change.notCompared})`;
  if (change.listed !== undefined) return `${name}: ${list(change.listed)} (not compared)`;
  const parts = [["new", change.new], ["gone", change.gone], ["unchanged", change.unchanged]].flatMap(([label, codes]) => (codes as string[]).length === 0 ? [] : [`${label as string} ${list(codes as string[])}`]);
  return `${name}: ${parts.length === 0 ? "none" : parts.join("; ")}`;
}

function renderGroups(report: DriveReport): string[] {
  const { groups } = report;
  const unconfirmed = report.groupRule === "unconfirmed";
  const finding = groups.status === "not-checked"
    ? `Groups not checked: ${groups.reason ?? "not enough loaded sets"}.`
    : groups.flagged.length === 0
      ? `No group stood out in this drive.${unconfirmed ? " Provisional until the rule is confirmed." : ""}`
      : groups.flagged.map((index) => `Group ${String(index + 1)} (module ${String(groups.groups[index]?.module ?? "?")}) sagged more than the others.${unconfirmed ? " Provisional until the rule is confirmed; get it inspected." : " Get it inspected."}`).join(" ");
  const range = groups.currentRange === undefined ? "" : `; current ${groups.currentRange.min.toFixed(1)} to ${groups.currentRange.max.toFixed(1)} A`;
  return [
    "## Cell groups under load", "",
    ...(unconfirmed ? [UNCONFIRMED_LINE] : []), finding, "",
    `Sets: ${String(groups.completeSets)} complete, ${String(groups.steadySets)} steady, ${String(groups.loadedSets)} loaded${range}.`,
  ];
}

function renderCodes(report: DriveReport): string[] {
  const { codes } = report;
  const pre = report.preDrive === undefined ? NO_PRE_DRIVE : `Compared with the parked scan of ${report.preDrive.scannedAt} (${report.preDrive.recording}).`;
  if (codes.status === "not-run") return ["## Trouble codes after the drive", "", `Rescan not run: ${codes.reason}.`, pre];
  return [
    "## Trouble codes after the drive", "", pre,
    ...(codes.stoppedEarly === undefined ? [] : [`The rescan stopped early (${codes.stoppedEarly}); only the modules it read are compared.`]),
    "",
    ...codes.modules.flatMap((m) => [`- Module ${m.ecu}${m.note === undefined ? "" : `: ${m.note}`}`, ...MODES.map((mode) => `  - ${describe(mode, m[mode])}`)]),
  ];
}

export function renderDriveReport(report: DriveReport): string {
  return [
    "# Drive report", "",
    `Scanned ${report.scannedAt}. Recording ${report.recording}; ${String(report.minutes)} min capture, stopped: ${report.stopReason}.`, "",
    ...renderGroups(report), "",
    ...renderCodes(report), "",
  ].join("\n");
}
