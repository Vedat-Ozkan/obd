import { z } from "zod";
import { Elm327Session, ElmSessionError } from "obd-core/elm/session";
import { parseRecording } from "obd-core/recording";
import { codesReportFromRecording, renderCodesReport, type CodesReport } from "obd-core/report";
import { ReplayTransport } from "obd-core/transport/replay";
import { decodeObdbMode22, withEquinoxEv2024Evidence, type ObdbMode22Signal, type SignalReading } from "obd-core/vehicles";
import { BMS_LABEL, bmsEnergyCapacity } from "./capacity.js";
import { ChargeLogBuilder, REST_CURRENT_A } from "./session.js";
import { buildTwelveVoltReport, renderTwelveVoltReport, type TwelveVoltObservation, type TwelveVoltReport, type VehiclePowerState } from "./twelve-volt.js";

export interface ReportSource { recording: string; command: string; ecu: string }
export interface ObservedBatterySignal {
  id: string; name: string; value: number; unit: string;
  tier: "verified" | "community"; source: ReportSource;
}
export interface ParkedScan {
  groupVoltages?: { volts: readonly number[]; modules: readonly number[]; sources: readonly ReportSource[]; completeSets: number };
  bmsFigure?: { valueKwh: number; energyKwh: number; socPercent: number; tier: "verified"; energySource: ReportSource; socSource: ReportSource };
  temperatureRaw?: { payloadHex: string; source: ReportSource };
}
export interface BatteryDiagnosisReport {
  version: 1;
  garageVehicleId: string;
  catalogId: "chevrolet-equinox-ev-2024";
  scannedAt: string;
  recording: string;
  scanStatus: "complete" | "partial";
  signals: readonly ObservedBatterySignal[];
  parked?: ParkedScan;
  cellSpread?: { volts: number; tier: "community"; min: ReportSource; max: ReportSource };
  twelveVolt: TwelveVoltReport;
  codes: CodesReport;
  capacity: { status: "not-measured"; reason: string };
  health: { status: "not-assessed"; reason: string };
}

export type RedFlagOutcome = "no-red-flags" | "ask-about-this" | "red-flag" | "check-incomplete";
export interface RedFlagFinding {
  severity: "ask-about-this" | "red-flag";
  check: "cell-groups-at-rest" | "codes";
  detail: string;
}
export interface RedFlagCoverage {
  check: "cell-groups-at-rest" | "codes" | "bms-capacity-figure" | "twelve-volt-supply" | "raw-temperature";
  status: "checked" | "shown-only" | "not-checked";
  reason?: string;
}
export interface RedFlagScreen {
  outcome: RedFlagOutcome;
  headline: "No red flags found" | "Ask about this" | "Red flag: get it inspected" | "Check incomplete";
  findings: readonly RedFlagFinding[];
  coverage: readonly RedFlagCoverage[];
  scope: "Among the checks listed. This does not certify battery health.";
  policy: { groupAskMv: number; groupRedMv: number; spreadAskMv: number; spreadRedMv: number; label: "Project policy" };
  limitation: "Limits come from one car; self-comparison can miss even pack-wide degradation or reflect a sensor offset.";
}

export const REST_GROUP_ASK_MV = 5;
export const REST_GROUP_RED_MV = 10;
export const REST_SPREAD_ASK_MV = 6;
export const REST_SPREAD_RED_MV = 12;
const mvText = (ticks: number) => `${(ticks / 10).toFixed(1)} mV`;

export function redFlagScreen(report: BatteryDiagnosisReport): RedFlagScreen {
  const findings: RedFlagFinding[] = [];
  const coverage: RedFlagCoverage[] = [];
  const groups = report.parked?.groupVoltages;
  if (groups) {
    const ticks = groups.volts.map((volts) => Math.round(volts * 10000));
    const sorted = [...ticks].sort((a, b) => a - b);
    const median = (sorted[39] + sorted[40]) / 2;
    ticks.forEach((value, index) => {
      const deviation = Math.abs(value - median);
      const severity = deviation > REST_GROUP_RED_MV * 10 ? "red-flag" : deviation > REST_GROUP_ASK_MV * 10 ? "ask-about-this" : undefined;
      if (severity) findings.push({ severity, check: "cell-groups-at-rest", detail: `Group ${String(index + 1)} (module ${String(groups.modules[index])}): ${mvText(deviation)} from set median; ${groups.volts[index].toFixed(4)} V.` });
    });
    const spread = sorted[79] - sorted[0];
    const severity = spread > REST_SPREAD_RED_MV * 10 ? "red-flag" : spread > REST_SPREAD_ASK_MV * 10 ? "ask-about-this" : undefined;
    if (severity) findings.push({ severity, check: "cell-groups-at-rest", detail: `80-group spread: ${mvText(spread)}.` });
    coverage.push({ check: "cell-groups-at-rest", status: "checked" });
  } else coverage.push({ check: "cell-groups-at-rest", status: "not-checked", reason: "No complete 80-group set with rest-bracketed current in this report recording." });

  const modes = ["stored", "pending", "permanent"] as const;
  const missing = modes.filter((mode) => !report.codes.modules.some((module) => module[mode].status === "read"));
  const seen = new Set<string>();
  for (const module of report.codes.modules) for (const mode of modes) {
    const result = module[mode];
    if (result.status !== "read") continue;
    for (const code of result.dtcs) {
      const key = `${mode}/${module.ecu}/${code}`;
      if (!seen.has(key)) {
        findings.push({ severity: "ask-about-this", check: "codes", detail: `${mode} code ${code} reported by ECU ${module.ecu}.` });
        seen.add(key);
      }
    }
  }
  if (report.codes.recentlyCleared.verdict === "indicated") findings.push({ severity: "ask-about-this", check: "codes", detail: "Recently cleared codes: indicated by the reported checks." });
  coverage.push(missing.length ? { check: "codes", status: "not-checked", reason: `No successful standard OBD read for ${missing.join(", ")} mode${missing.length === 1 ? "" : "s"}; other vehicle modules may also hold codes.` } : { check: "codes", status: "checked", reason: "Standard OBD stored, pending and permanent modes answered; this does not cover every vehicle module." });
  coverage.push(report.parked?.bmsFigure ? { check: "bms-capacity-figure", status: "shown-only", reason: "BMS figure is shown; no verified capacity verdict limit exists." } : { check: "bms-capacity-figure", status: "not-checked", reason: "BMS capacity figure was not recorded." });
  coverage.push(report.twelveVolt.observations.length ? { check: "twelve-volt-supply", status: "shown-only", reason: "12 V supply is shown; no 12 V verdict limit exists." } : { check: "twelve-volt-supply", status: "not-checked", reason: "12 V supply was not recorded." });
  coverage.push(report.parked?.temperatureRaw ? { check: "raw-temperature", status: "shown-only", reason: "Raw 2AF1 is shown; no decoded temperature verdict limit exists." } : { check: "raw-temperature", status: "not-checked", reason: "Raw 2AF1 was not recorded." });
  const outcome: RedFlagOutcome = findings.some((finding) => finding.severity === "red-flag") ? "red-flag" : findings.length ? "ask-about-this" : missing.length || !groups || report.scanStatus === "partial" ? "check-incomplete" : "no-red-flags";
  const headline = { "red-flag": "Red flag: get it inspected", "ask-about-this": "Ask about this", "check-incomplete": "Check incomplete", "no-red-flags": "No red flags found" } as const;
  return { outcome, headline: headline[outcome], findings, coverage,
    scope: "Among the checks listed. This does not certify battery health.",
    policy: { groupAskMv: REST_GROUP_ASK_MV, groupRedMv: REST_GROUP_RED_MV, spreadAskMv: REST_SPREAD_ASK_MV, spreadRedMv: REST_SPREAD_RED_MV, label: "Project policy" },
    limitation: "Limits come from one car; self-comparison can miss even pack-wide degradation or reflect a sensor offset." };
}

const nonempty = z.string().trim().min(1);
const finite = z.number();
const sourceSchema = z.strictObject({ recording: nonempty, command: nonempty, ecu: nonempty });
const parkedSchema = z.strictObject({
  groupVoltages: z.strictObject({ volts: z.array(finite.positive()).length(80), modules: z.array(z.number().int().min(1).max(10)).length(80), sources: z.array(sourceSchema).length(7), completeSets: z.number().int().positive() }).optional(),
  bmsFigure: z.strictObject({ valueKwh: finite.positive(), energyKwh: finite.positive(), socPercent: finite.positive(), tier: z.literal("verified"), energySource: sourceSchema, socSource: sourceSchema }).optional(),
  temperatureRaw: z.strictObject({ payloadHex: z.string().regex(/^(?:[0-9A-F]{2})+$/), source: sourceSchema }).optional(),
});
const observationSchema = z.strictObject({ id: nonempty, name: nonempty, value: finite, unit: nonempty, tier: z.enum(["verified", "community"]), source: sourceSchema });
const twelveObservation = z.strictObject({ source: z.enum(["adapter-supply", "module-supply"]), command: z.enum(["ATRV", "0142"]), volts: finite.positive(), ecu: nonempty.optional(), powerState: z.enum(["ready", "other", "unknown"]), recording: nonempty });
const statusFailure = z.strictObject({ status: z.literal("failed"), reason: z.enum(["negative", "echo", "length", "format", "unknown-pid"]), code: z.number().int().optional() });
const notRead = z.strictObject({ status: z.literal("not-read") });
const unsupported = z.strictObject({ status: z.literal("unsupported") });
const dtc = z.union([z.strictObject({ status: z.literal("read"), dtcs: z.array(z.string()) }), statusFailure, notRead]);
const pid = z.union([z.strictObject({ status: z.literal("read"), value: finite, unit: z.string() }), statusFailure, notRead, unsupported]);
const readiness = z.union([z.strictObject({ status: z.literal("read"), mil: z.boolean(), dtcCount: z.number().int(), monitors: z.array(z.looseObject({ id: z.string(), complete: z.boolean() })) }), statusFailure, notRead, unsupported]);
const freeze = z.union([z.strictObject({ status: z.literal("none-stored") }), z.strictObject({ status: z.literal("stored"), dtc: z.string(), readings: z.array(z.looseObject({ id: z.string(), value: finite })) }), statusFailure, notRead]);
const tri = z.enum(["yes", "no", "unknown"]);
const codesSchema = z.strictObject({
  modules: z.array(z.strictObject({ ecu: nonempty, stored: dtc, pending: dtc, permanent: dtc, readiness, pids: z.strictObject({ "21": pid, "30": pid, "31": pid, "4D": pid, "4E": pid }), freezeFrame: freeze })),
  recentlyCleared: z.strictObject({ verdict: z.enum(["indicated", "not-indicated", "unknown"]), strong: z.boolean(), legs: z.strictObject({ noStoredDtcs: tri, monitorsIncomplete: tri, countersLow: tri, permanentDtcs: tri }) }),
});
const schema = z.strictObject({
  version: z.literal(1), garageVehicleId: nonempty, catalogId: z.literal("chevrolet-equinox-ev-2024"),
  scannedAt: z.iso.datetime({ offset: true }), recording: nonempty, scanStatus: z.enum(["complete", "partial"]),
  signals: z.array(observationSchema),
  parked: parkedSchema.optional(),
  cellSpread: z.strictObject({ volts: finite.nonnegative(), tier: z.literal("community"), min: sourceSchema, max: sourceSchema }).optional(),
  twelveVolt: z.strictObject({ observations: z.array(twelveObservation), batteryHealth: z.literal("not-assessed"), rechargeAdvice: z.enum(["not-assessed", "recharge-and-retest", "no-recharge-flag"]), reason: nonempty }),
  codes: codesSchema, capacity: z.strictObject({ status: z.literal("not-measured"), reason: nonempty }), health: z.strictObject({ status: z.literal("not-assessed"), reason: nonempty }),
});

export function parseBatteryDiagnosis(value: unknown): BatteryDiagnosisReport {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`invalid battery diagnosis: ${z.prettifyError(result.error)}`);
  const report = result.data;
  if (report.signals.some((s) => s.source.recording !== report.recording) ||
    report.twelveVolt.observations.some((o) => o.recording !== report.recording) ||
    (report.cellSpread !== undefined && (report.cellSpread.min.recording !== report.recording || report.cellSpread.max.recording !== report.recording)) ||
    (report.parked?.groupVoltages?.sources.some((s) => s.recording !== report.recording) ?? false) ||
    (report.parked?.bmsFigure !== undefined && (report.parked.bmsFigure.energySource.recording !== report.recording || report.parked.bmsFigure.socSource.recording !== report.recording)) ||
    (report.parked?.temperatureRaw !== undefined && report.parked.temperatureRaw.source.recording !== report.recording)) {
    throw new Error("invalid battery diagnosis: mixed recording sources");
  }
  if (report.parked?.groupVoltages !== undefined && report.parked.groupVoltages.sources.some((source, i) => source.command !== `22 2AE${String(i + 1)}` || source.ecu !== "CB")) throw new Error("invalid battery diagnosis: group sources");
  return report as BatteryDiagnosisReport;
}

export function buildBatteryDiagnosis(input: {
  garageVehicleId: string; catalogId: "chevrolet-equinox-ev-2024"; scannedAt: string; recording: string; scanStatus: "complete" | "partial";
  signalReadings: readonly { reading: SignalReading; command: string }[]; twelveVolt: TwelveVoltReport; codes: CodesReport;
  parked?: ParkedScan;
}): BatteryDiagnosisReport {
  const signals: ObservedBatterySignal[] = input.signalReadings.flatMap(({ reading, command }) => reading.ok ? [{ id: reading.id, name: reading.name, value: reading.value, unit: reading.unit, tier: reading.tier, source: { recording: input.recording, command, ecu: reading.ecu } }] : []);
  // The decoder emits the three 2AF5 definitions together for each reply frame.
  // Restart at AVG so MIN and MAX cannot be paired across replies.
  let min: ObservedBatterySignal | undefined;
  let max: ObservedBatterySignal | undefined;
  let pair: { min: ObservedBatterySignal; max: ObservedBatterySignal } | undefined;
  for (const { reading, command } of input.signalReadings) {
    if (command !== "22 2AF5") continue;
    if (reading.id === "EQUINOXEV_HVBAT_C_V_AVG") { min = undefined; max = undefined; }
    if (!reading.ok) continue;
    const signal = signals.find((s) => s.id === reading.id && s.source.command === command && s.source.ecu === reading.ecu && s.value === reading.value);
    if (reading.id === "EQUINOXEV_HVBAT_C_V_MIN") min = signal;
    if (reading.id === "EQUINOXEV_HVBAT_C_V_MAX") max = signal;
    if (!pair && min && max && min.source.ecu === max.source.ecu) pair = { min, max };
  }
  min = pair?.min;
  max = pair?.max;
  const cellSpread = min && max && max.value >= min.value ? { volts: max.value - min.value, tier: "community" as const, min: min.source, max: max.source } : undefined;
  return parseBatteryDiagnosis({ version: 1, garageVehicleId: input.garageVehicleId, catalogId: input.catalogId, scannedAt: input.scannedAt, recording: input.recording, scanStatus: input.scanStatus, signals, ...(input.parked ? { parked: input.parked } : {}), ...(cellSpread ? { cellSpread } : {}), twelveVolt: input.twelveVolt, codes: input.codes, capacity: { status: "not-measured", reason: "No completed charge log and reviewed capacity estimator are available." }, health: { status: "not-assessed", reason: "A single scan and community cell readings cannot establish battery health." } });
}

const num = (value: number) => String(Math.round(value * 10000) / 10000);
export function renderBatteryDiagnosis(report: BatteryDiagnosisReport): string {
  const screen = redFlagScreen(report);
  const lines = [
    "# Battery diagnosis", "", `Garage vehicle: ${report.garageVehicleId}`, `Vehicle: ${report.catalogId}`,
    `Scan timestamp (caller replay label; not verified car-session time): ${report.scannedAt}`,
    `Recording: ${report.recording}`, `Scan status: ${report.scanStatus}`, "", "## Red-flag screen", "", screen.headline, screen.scope,
    ...(report.scanStatus === "partial" ? ["Partial scan: some checks may be missing."] : []),
    ...(screen.findings.length ? screen.findings.map((finding) => `- ${finding.severity}: ${finding.detail}`) : ["- No findings among completed checks."]),
    `Project policy: group ask >${String(screen.policy.groupAskMv)} mV, group red >${String(screen.policy.groupRedMv)} mV; spread ask >${String(screen.policy.spreadAskMv)} mV, spread red >${String(screen.policy.spreadRedMv)} mV.`,
    screen.limitation, "Coverage:", ...screen.coverage.map((item) => `- ${item.check}: ${item.status}${item.reason ? ` — ${item.reason}` : ""}`),
    "", "## Battery observations", "",
    ...(report.signals.length ? report.signals.map((s) => `- ${s.name}: ${num(s.value)} ${s.unit} | ${s.tier} | ${s.source.command} | ECU ${s.source.ecu} | ${s.source.recording}`) : ["Battery observations: not read"]),
    report.cellSpread ? `- Cell spread: ${num(report.cellSpread.volts)} volts | community | min ${report.cellSpread.min.command} ECU ${report.cellSpread.min.ecu} ${report.cellSpread.min.recording} | max ${report.cellSpread.max.command} ECU ${report.cellSpread.max.ecu} ${report.cellSpread.max.recording}` : "- Cell spread: unavailable",
    "", "## Parked observations", "",
    report.parked?.groupVoltages ? `- Group voltages at rest: 80 values across modules 1–10; ${String(report.parked.groupVoltages.completeSets)} complete sets; range ${num(Math.min(...report.parked.groupVoltages.volts))}–${num(Math.max(...report.parked.groupVoltages.volts))} V | ${report.parked.groupVoltages.sources.map((s) => `${s.command} ECU ${s.ecu} ${s.recording}`).join("; ")}` : "- Group voltages: not available at rest",
    ...(report.parked?.groupVoltages?.volts.map((volts, index) => `  - Module ${String(report.parked?.groupVoltages?.modules[index])}: ${num(volts)} V (record ${String(index + 1)})`) ?? []),
    report.parked?.bmsFigure ? `- ${BMS_LABEL} ${num(report.parked.bmsFigure.valueKwh)} kWh from ${num(report.parked.bmsFigure.energyKwh)} kWh energy remaining (${report.parked.bmsFigure.energySource.command} ECU ${report.parked.bmsFigure.energySource.ecu} ${report.parked.bmsFigure.energySource.recording}) / ${num(report.parked.bmsFigure.socPercent)}% SOC (${report.parked.bmsFigure.socSource.command} ECU ${report.parked.bmsFigure.socSource.ecu} ${report.parked.bmsFigure.socSource.recording}) | verified-on-car measurement direction and changes; absolute energy level and implied capacity unverified` : "- BMS figure: not read",
    report.parked?.temperatureRaw ? `- Raw 2AF1 response: ${report.parked.temperatureRaw.payloadHex} | ${report.parked.temperatureRaw.source.command} ECU ${report.parked.temperatureRaw.source.ecu} ${report.parked.temperatureRaw.source.recording}` : "- Raw 2AF1 response: not read",
    "", "## Capacity and health", "", "capacity: NOT MEASURED", `Reason: ${report.capacity.reason}`, "battery health: not assessed", `Reason: ${report.health.reason}`, "", "## 12 V observations", "", renderTwelveVoltReport(report.twelveVolt), "", renderCodesReport(report.codes),
  ];
  return lines.join("\n") + "\n";
}

export async function batteryDiagnosisFromRecording(jsonl: string, input: { garageVehicleId: string; catalogId: "chevrolet-equinox-ev-2024"; scannedAt: string; recording: string; scanStatus: "complete" | "partial" }, importedSignals: readonly ObdbMode22Signal[]): Promise<BatteryDiagnosisReport> {
  const lines = parseRecording(jsonl);
  const sessionCars = lines.flatMap((line) => line.dir === "meta" && "car" in line ? [line.car] : []);
  if (sessionCars.length > 1) throw new Error("expected a single recording session");
  if (sessionCars[0] !== "chevrolet-equinox-ev-2024") throw new Error("Equinox recording meta is missing");
  // The app's battery-scan key (X-2026-09-27-power-state-meta) wins; older files carry the power state only in a note.
  const start = lines.find((line) => line.dir === "meta" && "car" in line);
  const key = start?.dir === "meta" ? start.powerState : undefined;
  if (key !== undefined && key !== "ready" && key !== "unknown") throw new Error("battery scan power state meta is invalid");
  const powerState: VehiclePowerState = key ?? (lines.some((line) => line.dir === "meta" && typeof line.note === "string" && /(?:^|[, ]+)ready(?:[, ]+|$)/i.test(line.note)) ? "ready" : "unknown");
  const session = new Elm327Session(new ReplayTransport(lines));
  const signalReadings: { reading: SignalReading; command: string }[] = [];
  const observations: TwelveVoltObservation[] = [];
  const signals = withEquinoxEv2024Evidence(importedSignals);
  const marker = lines.findIndex((line) => line.dir === "meta" && line.note === "parked scan start");
  const builder = new ChargeLogBuilder(input.recording, lines.some((line) => line.dir === "meta" && line.synthetic === true), signals);
  const groupSources: { t: number; sources: ReportSource[] }[] = [];
  let openGroup: { t: number; sources: ReportSource[] } | undefined;
  let temperatureRaw: ParkedScan["temperatureRaw"];
  let module = "";
  try {
    for (const [index, line] of lines.entries()) {
      if (line.dir !== "tx") continue;
      const command = line.data.replace(/\r$/, "");
      try {
        const response = await session.send(command, { retry: false, timeoutMs: 500 });
        if (command.startsWith("ATSH ")) module = command.slice(-4, -2);
        if (command === "ATRV" && response.kind === "data") for (const content of response.lines) {
          const match = /^(\d+(?:\.\d+)?)V$/.exec(content.trim());
          if (match) observations.push({ source: "adapter-supply", command: "ATRV", volts: Number(match[1]), powerState, recording: input.recording });
        }
        const did = /^22 ([0-9A-F]{4})$/.exec(command)?.[1];
        if (did && response.kind !== "error") builder.add(line.t, module, did, response.frames);
        if (did && module === "CB" && /^2AE[1-7]$/.test(did)) {
          const part = Number(did.at(-1));
          if (part === 1) openGroup = { t: line.t, sources: [] };
          if (openGroup && openGroup.sources.length === part - 1) openGroup.sources.push({ recording: input.recording, command, ecu: module });
          else openGroup = undefined;
          if (part === 7 && openGroup) { groupSources.push(openGroup); openGroup = undefined; }
        }
        if (did === "2AF1" && module === "CB") for (const frame of response.frames) {
          if (frame.header.toUpperCase() === "18DAF1CB" && frame.negative === undefined && frame.data.length === 27 && frame.data[0] === 0x62 && frame.data[1] === 0x2a && frame.data[2] === 0xf1) {
            temperatureRaw = { payloadHex: Array.from(frame.data.subarray(3), (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(""), source: { recording: input.recording, command, ecu: module } };
          }
        }
        if (did && (marker < 0 || index < marker) && did !== "27AF" && signals.some((s) => s.did === did && s.module === module)) {
          for (const frame of response.frames) for (const reading of decodeObdbMode22(did, frame, signals.filter((s) => s.module === module))) signalReadings.push({ reading, command });
        }
      } catch (error) {
        if (!(error instanceof ElmSessionError && error.kind === "timeout")) throw error;
      }
    }
  } finally { await session.close(); }
  const log = builder.log();
  const atRest = log.groups.filter((group) => {
    const before = log.current.filter((point) => point.t < group.t).at(-1);
    const after = log.current.find((point) => point.t > group.t);
    return before !== undefined && after !== undefined && Math.abs(before.value) <= REST_CURRENT_A && Math.abs(after.value) <= REST_CURRENT_A;
  }).at(-1);
  const sources = groupSources.find((group) => group.t === atRest?.t)?.sources;
  const groupVoltages = atRest && sources ? { volts: atRest.volts, modules: atRest.modules, sources, completeSets: log.groups.length } : undefined;
  const last = bmsEnergyCapacity(log).last;
  const soc = last.status === "estimated" ? log.soc.find((point) => point.t === last.t) : undefined;
  const energy = soc ? log.energyKwh.filter((point) => point.t <= soc.t).at(-1) : undefined;
  const bmsFigure = last.status === "estimated" && soc && energy ? { valueKwh: last.value, energyKwh: energy.value, socPercent: soc.value, tier: "verified" as const, energySource: { recording: input.recording, command: "22 27AF", ecu: "CB" }, socSource: { recording: input.recording, command: "22 2B43", ecu: "CB" } } : undefined;
  const parked: ParkedScan = { ...(groupVoltages ? { groupVoltages } : {}), ...(bmsFigure ? { bmsFigure } : {}), ...(temperatureRaw ? { temperatureRaw } : {}) };
  const codes = await codesReportFromRecording(lines);
  return buildBatteryDiagnosis({ ...input, signalReadings, ...(Object.keys(parked).length ? { parked } : {}), twelveVolt: buildTwelveVoltReport(observations), codes });
}
