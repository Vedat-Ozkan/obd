import { z } from "zod";
import { Elm327Session, ElmSessionError } from "obd-core/elm/session";
import { parseRecording } from "obd-core/recording";
import { codesReportFromRecording, renderCodesReport, type CodesReport } from "obd-core/report";
import { ReplayTransport } from "obd-core/transport/replay";
import { decodeObdbMode22, withEquinoxEv2024Evidence, type ObdbMode22Signal, type SignalReading } from "obd-core/vehicles";
import { buildTwelveVoltReport, renderTwelveVoltReport, type TwelveVoltObservation, type TwelveVoltReport, type VehiclePowerState } from "./twelve-volt.js";

export interface ReportSource { recording: string; command: string; ecu: string }
export interface ObservedBatterySignal {
  id: string; name: string; value: number; unit: string;
  tier: "verified" | "community"; source: ReportSource;
}
export interface BatteryDiagnosisReport {
  version: 1;
  garageVehicleId: string;
  catalogId: "chevrolet-equinox-ev-2024";
  scannedAt: string;
  recording: string;
  scanStatus: "complete" | "partial";
  signals: readonly ObservedBatterySignal[];
  cellSpread?: { volts: number; tier: "community"; min: ReportSource; max: ReportSource };
  twelveVolt: TwelveVoltReport;
  codes: CodesReport;
  capacity: { status: "not-measured"; reason: string };
  health: { status: "not-assessed"; reason: string };
}

const nonempty = z.string().trim().min(1);
const finite = z.number();
const sourceSchema = z.strictObject({ recording: nonempty, command: nonempty, ecu: nonempty });
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
    (report.cellSpread !== undefined && (report.cellSpread.min.recording !== report.recording || report.cellSpread.max.recording !== report.recording))) {
    throw new Error("invalid battery diagnosis: mixed recording sources");
  }
  return report as BatteryDiagnosisReport;
}

export function buildBatteryDiagnosis(input: {
  garageVehicleId: string; catalogId: "chevrolet-equinox-ev-2024"; scannedAt: string; recording: string; scanStatus: "complete" | "partial";
  signalReadings: readonly { reading: SignalReading; command: string }[]; twelveVolt: TwelveVoltReport; codes: CodesReport;
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
  return parseBatteryDiagnosis({ version: 1, garageVehicleId: input.garageVehicleId, catalogId: input.catalogId, scannedAt: input.scannedAt, recording: input.recording, scanStatus: input.scanStatus, signals, ...(cellSpread ? { cellSpread } : {}), twelveVolt: input.twelveVolt, codes: input.codes, capacity: { status: "not-measured", reason: "No completed charge log and reviewed capacity estimator are available." }, health: { status: "not-assessed", reason: "A single scan and community cell readings cannot establish battery health." } });
}

const num = (value: number) => String(Math.round(value * 10000) / 10000);
export function renderBatteryDiagnosis(report: BatteryDiagnosisReport): string {
  const lines = [
    "# Battery diagnosis", "", `Garage vehicle: ${report.garageVehicleId}`, `Vehicle: ${report.catalogId}`,
    `Scan timestamp (caller replay label; not verified car-session time): ${report.scannedAt}`,
    `Recording: ${report.recording}`, `Scan status: ${report.scanStatus}`, "", "## Battery observations", "",
    ...(report.signals.length ? report.signals.map((s) => `- ${s.name}: ${num(s.value)} ${s.unit} | ${s.tier} | ${s.source.command} | ECU ${s.source.ecu} | ${s.source.recording}`) : ["Battery observations: not read"]),
    report.cellSpread ? `- Cell spread: ${num(report.cellSpread.volts)} volts | community | min ${report.cellSpread.min.command} ECU ${report.cellSpread.min.ecu} ${report.cellSpread.min.recording} | max ${report.cellSpread.max.command} ECU ${report.cellSpread.max.ecu} ${report.cellSpread.max.recording}` : "- Cell spread: unavailable",
    "", "## Capacity and health", "", "capacity: NOT MEASURED", `Reason: ${report.capacity.reason}`, "battery health: not assessed", `Reason: ${report.health.reason}`, "", "## 12 V observations", "", renderTwelveVoltReport(report.twelveVolt), "", renderCodesReport(report.codes),
  ];
  return lines.join("\n") + "\n";
}

export async function batteryDiagnosisFromRecording(jsonl: string, input: { garageVehicleId: string; catalogId: "chevrolet-equinox-ev-2024"; scannedAt: string; recording: string; scanStatus: "complete" | "partial" }, importedSignals: readonly ObdbMode22Signal[]): Promise<BatteryDiagnosisReport> {
  const lines = parseRecording(jsonl);
  const sessionCars = lines.flatMap((line) => line.dir === "meta" && "car" in line ? [line.car] : []);
  if (sessionCars.length > 1) throw new Error("expected a single recording session");
  if (sessionCars[0] !== "chevrolet-equinox-ev-2024") throw new Error("Equinox recording meta is missing");
  const powerState: VehiclePowerState = lines.some((line) => line.dir === "meta" && typeof line.note === "string" && /(?:^|[, ]+)ready(?:[, ]+|$)/i.test(line.note)) ? "ready" : "unknown";
  const session = new Elm327Session(new ReplayTransport(lines));
  const signalReadings: { reading: SignalReading; command: string }[] = [];
  const observations: TwelveVoltObservation[] = [];
  const signals = withEquinoxEv2024Evidence(importedSignals);
  let module = "";
  try {
    for (const line of lines) {
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
        if (did && signals.some((s) => s.did === did && s.module === module)) {
          for (const frame of response.frames) for (const reading of decodeObdbMode22(did, frame, signals.filter((s) => s.module === module))) signalReadings.push({ reading, command });
        }
      } catch (error) {
        if (!(error instanceof ElmSessionError && error.kind === "timeout")) throw error;
      }
    }
  } finally { await session.close(); }
  const codes = await codesReportFromRecording(lines);
  return buildBatteryDiagnosis({ ...input, signalReadings, twelveVolt: buildTwelveVoltReport(observations), codes });
}
