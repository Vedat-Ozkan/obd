import { redFlagScreen, type BatteryDiagnosisReport, type ObservedBatterySignal } from "obd-battery/report";
import { codesRating, codesRead, distinctCodes, reportRatings, type RatingView } from "obd-battery/rating";
import { LOW_COUNTER, type CodesReport, type Tri } from "obd-core/report";

type Section = "soc" | "cells" | "capacity" | "twelveVolt";
type Module = CodesReport["modules"][number];
export type { RatingView };

export function socHero(report: BatteryDiagnosisReport): { percent: number; tier: "verified" | "community"; scannedAt: string } | undefined {
  const soc = report.signals.filter((signal) => signal.id === "EQUINOXEV_SOC").at(-1);
  return soc ? { percent: Math.round(soc.value * 10) / 10, tier: soc.tier, scannedAt: report.scannedAt } : undefined;
}

export function findReport(reports: readonly BatteryDiagnosisReport[], key: { scannedAt: string; recording: string }): BatteryDiagnosisReport | undefined {
  return reports.find((report) => report.scannedAt === key.scannedAt && report.recording === key.recording);
}

const num = (value: number) => String(Math.round(value * 10000) / 10000);
const UNITS: Partial<Record<string, string>> = { percent: "%", volts: "V" };
const withUnit = (signal: ObservedBatterySignal) => `${num(signal.value)} ${UNITS[signal.unit] ?? signal.unit}`;
const mv = (volts: number) => Math.round(volts * 10000) / 10;

function cellReply(report: BatteryDiagnosisReport): { min: ObservedBatterySignal; avg: ObservedBatterySignal; max: ObservedBatterySignal } | undefined {
  const spread = report.cellSpread;
  if (!spread) return undefined;
  const s = report.signals;
  const cell = (signal: ObservedBatterySignal | undefined, id: string, ecu: string) =>
    signal?.source.command === "22 2AF5" && signal.id === `EQUINOXEV_HVBAT_C_V_${id}` && signal.source.ecu === ecu;
  const at = s.findIndex((signal, i) => cell(signal, "MIN", signal.source.ecu) && cell(s[i + 1], "MAX", signal.source.ecu));
  if (at < 0) return undefined;
  const [avg, min, max] = [s[at - 1], s[at], s[at + 1]];
  return cell(avg, "AVG", min.source.ecu) && max.value - min.value === spread.volts ? { min, avg, max } : undefined;
}

const lastTwelveVolt = (report: BatteryDiagnosisReport) => report.twelveVolt.observations.at(-1);

function codeList(module: Module): string[] {
  return [module.stored, module.pending, module.permanent].flatMap((read) => read.status === "read" ? read.dtcs : []);
}

function codesValue(codes: CodesReport): string {
  const count = distinctCodes(codes.modules).length;
  if (count > 0) return `${String(count)} code${count === 1 ? "" : "s"}`;
  return codesRead(codes.modules) ? "No codes" : "Not read";
}

export function reportSummary(report: BatteryDiagnosisReport): { soc: ReturnType<typeof socHero>; verdict: ReturnType<typeof redFlagScreen>; rows: readonly { section: "cells" | "capacity" | "twelveVolt" | "codes"; label: string; value: string; rating: RatingView }[] } {
  const twelve = lastTwelveVolt(report);
  const ratings = reportRatings(report);
  return {
    soc: socHero(report),
    verdict: redFlagScreen(report),
    rows: [
      { section: "cells", label: "Cell balance", value: report.cellSpread ? `${(report.cellSpread.volts * 1000).toFixed(1)} mV` : "Not read", rating: ratings.cells },
      { section: "capacity", label: "Capacity", value: "Not measured", rating: ratings.capacity },
      { section: "twelveVolt", label: "12 V battery", value: twelve ? `${String(twelve.volts)} V` : "Not recorded", rating: ratings.twelveVolt },
      { section: "codes", label: "Diagnostic codes", value: codesValue(report.codes), rating: ratings.codes },
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
  const ratings = reportRatings(report);
  if (section === "cells") {
    const cells = cellReply(report);
    const spread = report.cellSpread;
    const groups = report.parked?.groupVoltages;
    const raw = report.parked?.temperatureRaw;
    return {
      hero: spread ? { value: (spread.volts * 1000).toFixed(1), unit: "mV", tag: "community", tagLabel: TAG_LABEL.community } : { value: "Not read", tag: "neutral", tagLabel: "Not read" },
      rating: ratings.cells,
      readings: [ ...(spread && cells ? [reading("Lowest cell", cells.min), reading("Average cell", cells.avg), reading("Highest cell", cells.max)] : []), { label: "Group voltages at rest", value: groups ? `80 values, modules 1–10, ${String(groups.completeSets)} complete sets, ${num(Math.min(...groups.volts))}–${num(Math.max(...groups.volts))} V` : "Not available at rest" }, ...(groups ? Array.from({ length: 10 }, (_, index) => ({ label: `Module ${String(index + 1)}`, value: groups.volts.filter((_, i) => groups.modules[i] === index + 1).map((volts) => `${num(volts)} V`).join(", ") })) : []), { label: "Raw 2AF1 response", value: raw?.payloadHex ?? "Not read" }, ...(spread ? [{ label: "Spread", value: `${(spread.volts * 1000).toFixed(1)} mV`, tier: spread.tier }] : []) ],
      meaning: `${report.health.reason}${spread ? " The legacy min/average/max and spread use a community signal definition not verified on this car." : ""}${groups ? " The 80 cell-group voltages come from recorded 2AE1–2AE7 replies at rest." : ""}`,
      source: [ ...(spread ? [spread.min, spread.max] : []), ...(groups?.sources ?? []), ...(raw ? [raw.source] : []) ].length ? [...new Set([ ...(spread ? [spread.min, spread.max] : []), ...(groups?.sources ?? []), ...(raw ? [raw.source] : []) ].map((source) => `${source.command} from ECU ${source.ecu} (${source.recording})`))].join("; ") : "Not read in this check",
      ...(cells ? { cellRange: { minMv: mv(cells.min.value), avgMv: mv(cells.avg.value), maxMv: mv(cells.max.value) } } : {}),
    };
  }
  if (section === "capacity") {
    const figure = report.parked?.bmsFigure;
    return {
      hero: { value: "Not measured", tag: "neutral", tagLabel: "Not measured" },
      rating: ratings.capacity,
      readings: figure ? [{ label: "BMS figure", value: `${num(figure.valueKwh)} kWh`, tier: figure.tier }, { label: "BMS energy remaining", value: `${num(figure.energyKwh)} kWh` }, { label: "BMS SOC", value: `${num(figure.socPercent)} %` }] : [{ label: "BMS figure", value: "Not read" }],
      meaning: `${report.capacity.reason} Capacity stays not measured until a completed charge log and a reviewed estimator exist.${figure ? " The BMS figure is a comparison from the car's reported energy and SOC; its absolute energy level and implied capacity remain unverified." : ""}`,
      source: figure ? `${figure.energySource.command} from ECU ${figure.energySource.ecu} (${figure.energySource.recording}); ${figure.socSource.command} from ECU ${figure.socSource.ecu} (${figure.socSource.recording})` : "Not measured; needs a completed charge log",
    };
  }
  const twelve = lastTwelveVolt(report);
  const count = report.twelveVolt.observations.length;
  return {
    hero: twelve ? { value: String(twelve.volts), unit: "V", tag: "neutral", tagLabel: "Not assessed" } : { value: "Not recorded", tag: "neutral", tagLabel: "Not assessed" },
    rating: ratings.twelveVolt,
    readings: twelve ? [
      { label: twelve.source === "adapter-supply" ? "Adapter supply (ATRV)" : `Module supply (0142, ECU ${twelve.ecu ?? ""})`, value: `${String(twelve.volts)} V` },
      { label: "Car power state", value: twelve.powerState },
      ...(count > 1 ? [{ label: "Readings in this check", value: String(count) }] : []),
    ] : [],
    meaning: `${report.twelveVolt.reason} This is a supply voltage seen through the OBD port, not a battery test.`,
    source: twelve ? twelve.source === "adapter-supply" ? "ATRV: the adapter's supply voltage at the OBD port" : `0142: control-module supply voltage from ECU ${twelve.ecu ?? ""}` : "Not recorded in this check",
  };
}

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

export function codesView(codes: CodesReport): { rating: RatingView; codeCount: number; legs: readonly { label: string; result: Tri }[]; thresholds: typeof LOW_COUNTER; modules: readonly { ecu: string; summary: string }[] } {
  return {
    rating: codesRating(codes),
    codeCount: distinctCodes(codes.modules).length,
    legs: LEGS.map(([key, label]) => ({ label, result: codes.recentlyCleared.legs[key] })),
    thresholds: LOW_COUNTER,
    modules: codes.modules.map((module) => ({ ecu: module.ecu, summary: moduleSummary(module) })),
  };
}

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

export function historyPoints(reports: readonly BatteryDiagnosisReport[]): readonly { scannedAt: string; percent: number }[] {
  return reports.flatMap((report) => {
    const hero = socHero(report);
    return hero ? [{ scannedAt: hero.scannedAt, percent: hero.percent }] : [];
  }).sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));
}
