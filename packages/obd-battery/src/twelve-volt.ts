export type VehiclePowerState = "ready" | "other" | "unknown";

export interface TwelveVoltObservation {
  source: "adapter-supply" | "module-supply";
  command: "ATRV" | "0142";
  volts: number;
  ecu?: string;
  powerState: VehiclePowerState;
  recording: string;
}

export interface RestedAgmOcv {
  source: "independent-terminal-voltmeter";
  chemistry: "AGM";
  volts: number;
  restHours: number;
  vehicleOff: true;
  noChargerOrLoad: true;
  surfaceChargeRemoved: true;
  temperatureC: number;
  measurementNote: string;
}

export interface TwelveVoltReport {
  observations: readonly TwelveVoltObservation[];
  batteryHealth: "not-assessed";
  rechargeAdvice: "not-assessed" | "recharge-and-retest" | "no-recharge-flag";
  reason: string;
}

const validVolts = (volts: number): boolean => Number.isFinite(volts) && volts > 0;

export function buildTwelveVoltReport(
  observations: readonly TwelveVoltObservation[],
  restedOcv?: RestedAgmOcv,
): TwelveVoltReport {
  for (const observation of observations) {
    if (!validVolts(observation.volts) ||
      (observation.source === "adapter-supply" && (observation.command !== "ATRV" || observation.ecu !== undefined)) ||
      (observation.source === "module-supply" && (observation.command !== "0142" || !observation.ecu)) ||
      !["ready", "other", "unknown"].includes(observation.powerState) || !observation.recording) {
      throw new Error("invalid 12 V observation");
    }
  }

  if (restedOcv === undefined) {
    return {
      observations,
      batteryHealth: "not-assessed",
      rechargeAdvice: "not-assessed",
      reason: "In-car adapter and control-module supply voltage are not rested battery-terminal measurements; a load test or service assessment is needed for battery health.",
    };
  }
  const conditions = restedOcv as unknown as Record<string, unknown>;
  if (conditions.source !== "independent-terminal-voltmeter" || conditions.chemistry !== "AGM" ||
    !validVolts(restedOcv.volts) || !Number.isFinite(restedOcv.restHours) || restedOcv.restHours < 0 ||
    !Number.isFinite(restedOcv.temperatureC) || conditions.vehicleOff !== true ||
    conditions.noChargerOrLoad !== true || conditions.surfaceChargeRemoved !== true ||
    typeof conditions.measurementNote !== "string" || !conditions.measurementNote.trim()) {
    throw new Error("invalid rested AGM terminal-voltage conditions");
  }
  if (restedOcv.restHours < 24) {
    return {
      observations,
      batteryHealth: "not-assessed",
      rechargeAdvice: "not-assessed",
      reason: `Independent AGM terminal voltage rested ${String(restedOcv.restHours)} h at ${String(restedOcv.temperatureC)} C; at least 24 h is required for OCV screening. A load test or service assessment is needed for battery health.`,
    };
  }
  return {
    observations,
    batteryHealth: "not-assessed",
    rechargeAdvice: restedOcv.volts < 12.64 ? "recharge-and-retest" : "no-recharge-flag",
    reason: `Independent AGM terminal OCV ${String(restedOcv.volts)} V after ${String(restedOcv.restHours)} h rest at ${String(restedOcv.temperatureC)} C (${restedOcv.measurementNote}); this is recharge screening only. A load test or service assessment is needed for battery health.`,
  };
}

export function renderTwelveVoltReport(report: TwelveVoltReport): string {
  const lines = report.observations.length === 0
    ? ["12 V voltage: not recorded"]
    : report.observations.map((o) =>
      `12 V voltage: ${String(o.volts)} V | ${o.source === "adapter-supply" ? "ELM adapter supply" : "control-module supply"} | ${o.command}${o.ecu ? ` | ECU ${o.ecu}` : ""} | state ${o.powerState} | ${o.recording}`);
  lines.push("12 V battery health: not assessed");
  lines.push(`Reason: ${report.reason}`);
  if (report.rechargeAdvice === "recharge-and-retest") lines.push("OCV advice: recharge and retest; no health or replacement verdict.");
  else if (report.rechargeAdvice === "no-recharge-flag") lines.push("OCV advice: no recharge flag from this screening value; no health verdict.");
  else lines.push("OCV advice: not assessed.");
  return lines.join("\n");
}
