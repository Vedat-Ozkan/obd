import type { BatteryDiagnosisReport, ObservedBatterySignal } from "obd-battery/report";
import { LOW_COUNTER, type CodesReport, type Tri } from "obd-core/report";
import type { Rating } from "../ui/theme.js";

type Section = "soc" | "cells" | "capacity" | "twelveVolt";
type Module = CodesReport["modules"][number];
export interface RatingView { rating: Rating; basis: string }

/**
 * The SoC hero: the latest EQUINOXEV_SOC (22 2B43) reading with one decimal, as in the approved mockups
 * (docs/specs/X-2026-09-28-app-redesign.md Decision 2; signal from packages/obd-core/vehicles/chevrolet-equinox-ev/default.json).
 */
export function socHero(report: BatteryDiagnosisReport): { percent: number; tier: "verified" | "community"; scannedAt: string } | undefined {
  const soc = report.signals.filter((signal) => signal.id === "EQUINOXEV_SOC").at(-1);
  return soc ? { percent: Math.round(soc.value * 10) / 10, tier: soc.tier, scannedAt: report.scannedAt } : undefined;
}

/** The route names its report by scannedAt and recording; shared screen state would show whichever report was opened last. */
export function findReport(reports: readonly BatteryDiagnosisReport[], key: { scannedAt: string; recording: string }): BatteryDiagnosisReport | undefined {
  return reports.find((report) => report.scannedAt === key.scannedAt && report.recording === key.recording);
}

// Spec §Design Rating rules: cells, capacity and 12 V have no threshold yet.
const NOT_RATED: RatingView = { rating: "not-rated", basis: "No threshold yet" };
// Report precision, as renderBatteryDiagnosis prints it.
const num = (value: number) => String(Math.round(value * 10000) / 10000);
const UNITS: Partial<Record<string, string>> = { percent: "%", volts: "V" };
const withUnit = (signal: ObservedBatterySignal) => `${num(signal.value)} ${UNITS[signal.unit] ?? signal.unit}`;
const mv = (volts: number) => Math.round(volts * 10000) / 10;

/**
 * The MIN/AVG/MAX reply behind the report's cell spread. buildBatteryDiagnosis pairs MIN and MAX from one 22 2AF5 reply,
 * and the decoder emits AVG, MIN, MAX per reply, so each AVG starts a reply. The pair must reproduce cellSpread exactly.
 */
function cellReply(report: BatteryDiagnosisReport): { min: ObservedBatterySignal; avg: ObservedBatterySignal; max: ObservedBatterySignal } | undefined {
  const spread = report.cellSpread;
  if (!spread) return undefined;
  let reply: Partial<Record<"min" | "avg" | "max", ObservedBatterySignal>> = {};
  for (const signal of report.signals) {
    if (signal.source.command !== "22 2AF5") continue;
    if (signal.id === "EQUINOXEV_HVBAT_C_V_AVG") reply = { avg: signal };
    if (signal.id === "EQUINOXEV_HVBAT_C_V_MIN") reply.min = signal;
    if (signal.id === "EQUINOXEV_HVBAT_C_V_MAX") reply.max = signal;
    const { min, avg, max } = reply;
    if (min && avg && max && min.source.ecu === max.source.ecu && max.value - min.value === spread.volts) return { min, avg, max };
  }
  return undefined;
}

const lastTwelveVolt = (report: BatteryDiagnosisReport) => report.twelveVolt.observations.at(-1);

function codeList(module: Module): string[] {
  return [module.stored, module.pending, module.permanent].flatMap((read) => read.status === "read" ? read.dtcs : []);
}
const distinctCodes = (modules: readonly Module[]) => [...new Set(modules.flatMap(codeList))];
const codesRead = (modules: readonly Module[]) => modules.some((m) => [m.stored, m.pending, m.permanent].some((read) => read.status === "read"));

/** Spec §Decisions 1 (owner, 2026-09-28): the codes rating, in this order of precedence. */
function codesRating(codes: CodesReport): RatingView {
  if (distinctCodes(codes.modules).length > 0) return { rating: "poor", basis: "Project policy: a reported code is Poor" };
  if (codes.recentlyCleared.verdict === "indicated") return { rating: "poor", basis: "Project policy (T0.7): the recently-cleared check says yes" };
  if (!codesRead(codes.modules)) return { rating: "not-rated", basis: "No module answered a code read" };
  if (codes.recentlyCleared.verdict === "not-indicated") return { rating: "good", basis: "Project policy: no codes reported, and the recently-cleared check says no" };
  return { rating: "ok", basis: "Project policy: no codes reported, and whether codes were cleared recently is unknown" };
}

function codesValue(codes: CodesReport): string {
  const count = distinctCodes(codes.modules).length;
  if (count > 0) return `${String(count)} code${count === 1 ? "" : "s"}`;
  return codesRead(codes.modules) ? "No codes" : "Not read";
}

/** Report summary (spec §Screens 3): the SoC hero and four rows in fixed order. */
export function reportSummary(report: BatteryDiagnosisReport): { soc: ReturnType<typeof socHero>; rows: readonly { section: "cells" | "capacity" | "twelveVolt" | "codes"; label: string; value: string; rating: RatingView }[] } {
  const twelve = lastTwelveVolt(report);
  return {
    soc: socHero(report),
    rows: [
      { section: "cells", label: "Cell balance", value: report.cellSpread ? `${(report.cellSpread.volts * 1000).toFixed(1)} mV` : "Not read", rating: NOT_RATED },
      { section: "capacity", label: "Capacity", value: "Not measured", rating: NOT_RATED },
      { section: "twelveVolt", label: "12 V battery", value: twelve ? `${String(twelve.volts)} V` : "Not recorded", rating: NOT_RATED },
      { section: "codes", label: "Diagnostic codes", value: codesValue(report.codes), rating: codesRating(report.codes) },
    ],
  };
}

type Reading = { label: string; value: string; tier?: "verified" | "community" };
type Detail = {
  hero: { value: string; unit?: string; tag: "verified" | "community" | "neutral"; tagLabel: string }; rating?: RatingView;
  readings: readonly Reading[]; meaning: string; source: string; cellRange?: { minMv: number; avgMv: number; maxMv: number };
};
const TAG_LABEL = { verified: "Verified", community: "Community" };
const reading = (label: string, signal: ObservedBatterySignal): Reading => ({ label, value: withUnit(signal), tier: signal.tier });
const sourceOf = (signals: readonly ObservedBatterySignal[]) => [...new Set(signals.map((s) => `${s.source.command} from ECU ${s.source.ecu}`))].join("; ");

/**
 * A section detail (spec §Screens 4). "What this means" is the report's own reason string plus at most two fixed sentences,
 * each backed by ADR-018 §Evidence and limits or the spec's §Sources row for that value.
 */
export function sectionDetail(report: BatteryDiagnosisReport, section: Section): Detail {
  if (section === "soc") {
    const soc = report.signals.filter((s) => s.id === "EQUINOXEV_SOC").at(-1);
    const hd = report.signals.filter((s) => s.id === "EQUINOXEV_SOC_HD").at(-1);
    const hero = socHero(report);
    return {
      hero: hero ? { value: hero.percent.toFixed(1), unit: "%", tag: hero.tier, tagLabel: TAG_LABEL[hero.tier] } : { value: "Not read", tag: "neutral", tagLabel: "Not read" },
      readings: [...(soc ? [reading("State of charge", soc)] : []), ...(hd ? [reading("State of charge (high resolution)", hd)] : [])],
      meaning: "This is the charge level the battery reported during this check. A snapshot like this does not certify battery health.",
      source: soc || hd ? sourceOf([soc, hd].filter((s) => s !== undefined)) : "Not read in this check",
    };
  }
  if (section === "cells") {
    const cells = cellReply(report);
    const spread = report.cellSpread;
    return {
      hero: spread ? { value: (spread.volts * 1000).toFixed(1), unit: "mV", tag: "community", tagLabel: TAG_LABEL.community } : { value: "Not read", tag: "neutral", tagLabel: "Not read" },
      rating: NOT_RATED,
      readings: cells && spread ? [reading("Lowest cell", cells.min), reading("Average cell", cells.avg), reading("Highest cell", cells.max), { label: "Spread", value: `${(spread.volts * 1000).toFixed(1)} mV`, tier: spread.tier }] : [],
      meaning: `${report.health.reason} These cell voltages come from a community signal definition, not one verified on this car.`,
      source: cells ? sourceOf([cells.min, cells.avg, cells.max]) : "Not read in this check",
      ...(cells ? { cellRange: { minMv: mv(cells.min.value), avgMv: mv(cells.avg.value), maxMv: mv(cells.max.value) } } : {}),
    };
  }
  if (section === "capacity") {
    return {
      hero: { value: "Not measured", tag: "neutral", tagLabel: "Not measured" },
      rating: NOT_RATED,
      readings: [],
      meaning: `${report.capacity.reason} Capacity stays not measured until a completed charge log and a reviewed estimator exist.`,
      source: "A completed charge log (Log a charge)",
    };
  }
  const twelve = lastTwelveVolt(report);
  const count = report.twelveVolt.observations.length;
  return {
    hero: twelve ? { value: String(twelve.volts), unit: "V", tag: "neutral", tagLabel: "Not assessed" } : { value: "Not recorded", tag: "neutral", tagLabel: "Not assessed" },
    rating: NOT_RATED,
    readings: twelve ? [
      { label: twelve.source === "adapter-supply" ? "Adapter supply (ATRV)" : `Module supply (0142, ECU ${twelve.ecu ?? ""})`, value: `${String(twelve.volts)} V` },
      { label: "Car power state", value: twelve.powerState },
      ...(count > 1 ? [{ label: "Readings in this check", value: String(count) }] : []),
    ] : [],
    meaning: `${report.twelveVolt.reason} This is a supply voltage seen through the OBD port, not a battery test.`,
    source: twelve ? twelve.source === "adapter-supply" ? "ATRV: the adapter's supply voltage at the OBD port" : `0142: control-module supply voltage from ECU ${twelve.ecu ?? ""}` : "Not recorded in this check",
  };
}

// Labels as renderCodesReport prints them (packages/obd-core/src/report/render.ts).
const LEGS: readonly [keyof CodesReport["recentlyCleared"]["legs"], string][] = [
  ["noStoredDtcs", "No stored codes (Mode 03)"],
  ["monitorsIncomplete", "A readiness monitor incomplete (PID 01)"],
  ["countersLow", "A counter since codes cleared below policy (PIDs 30, 31, 4E)"],
  ["permanentDtcs", "Permanent codes present (Mode 0A)"],
];

function moduleSummary(module: Module): string {
  const codes = [...new Set(codeList(module))];
  if (codes.length > 0) return `${String(codes.length)} code${codes.length === 1 ? "" : "s"}: ${codes.join(", ")}`;
  return codesRead([module]) ? "No codes" : "Codes not read";
}

/** Codes (spec §Screens 5). */
export function codesView(codes: CodesReport): { rating: RatingView; codeCount: number; legs: readonly { label: string; result: Tri }[]; thresholds: typeof LOW_COUNTER; modules: readonly { ecu: string; summary: string }[] } {
  return {
    rating: codesRating(codes),
    codeCount: distinctCodes(codes.modules).length,
    legs: LEGS.map(([key, label]) => ({ label, result: codes.recentlyCleared.legs[key] })),
    thresholds: LOW_COUNTER,
    modules: codes.modules.map((module) => ({ ecu: module.ecu, summary: moduleSummary(module) })),
  };
}

// Module detail wording follows renderCodesReport's module section (render.ts), so each value reads as the module reported it.
const round3 = (v: number) => String(Math.round(v * 1000) / 1000);
type Status = { status: "not-read" } | { status: "unsupported" } | { status: "failed"; reason: string; code?: number };
function statusWord(s: Status): string {
  if (s.status === "not-read") return "not read";
  if (s.status === "unsupported") return "not supported";
  if (s.reason === "negative") return `not answered (negative response ${(s.code ?? 0).toString(16).padStart(2, "0").toUpperCase()})`;
  return `unreadable reply (${s.reason})`;
}
const dtcText = (d: Module["stored"]) => d.status === "read" ? (d.dtcs.length > 0 ? d.dtcs.join(", ") : "none") : statusWord(d);
const pidText = (v: Module["pids"]["21"]) => v.status === "read" ? `${round3(v.value)}${v.unit === "count" ? "" : ` ${v.unit}`}` : statusWord(v);
function freezeText(f: Module["freezeFrame"]): string {
  if (f.status === "none-stored") return "none stored";
  if (f.status !== "stored") return statusWord(f);
  const readings = f.readings.map((r) => r.unit === "enum" ? `${r.id} ${String(r.value)}${r.label === undefined ? "" : ` (${r.label})`}` : `${r.id} ${round3(r.value)} ${r.unit}`);
  return [`stored for ${f.dtc}`, ...readings].join("; ");
}

/** Module detail (spec §Screens 5): modes 03/07/0A, readiness, PIDs 30/31/4E/21/4D and the freeze frame. */
export function moduleRows(codes: CodesReport, ecu: string): readonly { label: string; value: string }[] | undefined {
  const m = codes.modules.find((module) => module.ecu === ecu);
  if (!m) return undefined;
  const r = m.readiness;
  const monitors = r.status === "read" ? r.monitors.map((x) => `${x.id} ${x.complete ? "complete" : "incomplete"}`).join(", ") : "";
  return [
    { label: "Stored codes (Mode 03)", value: dtcText(m.stored) },
    { label: "Pending codes (Mode 07)", value: dtcText(m.pending) },
    { label: "Permanent codes (Mode 0A)", value: dtcText(m.permanent) },
    ...(r.status === "read" ? [
      { label: "MIL (PID 01)", value: `${r.mil ? "on" : "off"}; stored emission codes: ${String(r.dtcCount)}` },
      { label: "Readiness monitors (PID 01)", value: monitors === "" ? "none available" : monitors },
    ] : [{ label: "Readiness (PID 01)", value: statusWord(r) }]),
    { label: "Warm-ups since codes cleared (PID 30)", value: pidText(m.pids["30"]) },
    { label: "Distance since codes cleared (PID 31)", value: pidText(m.pids["31"]) },
    { label: "Time since codes cleared (PID 4E)", value: pidText(m.pids["4E"]) },
    { label: "Distance with MIL on (PID 21)", value: pidText(m.pids["21"]) },
    { label: "Time with MIL on (PID 4D)", value: pidText(m.pids["4D"]) },
    { label: "Freeze frame (Mode 02)", value: freezeText(m.freezeFrame) },
  ];
}

/** Chart 2 (scan history): one SoC point per check that read one, oldest first. */
export function historyPoints(reports: readonly BatteryDiagnosisReport[]): readonly { scannedAt: string; percent: number }[] {
  return reports.flatMap((report) => {
    const hero = socHero(report);
    return hero ? [{ scannedAt: hero.scannedAt, percent: hero.percent }] : [];
  }).sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));
}
