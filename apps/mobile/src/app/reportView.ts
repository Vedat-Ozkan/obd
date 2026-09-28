import type { BatteryDiagnosisReport } from "obd-battery/report";

/**
 * The SoC hero: the latest EQUINOXEV_SOC (22 2B43) reading with one decimal, as in the approved mockups
 * (docs/specs/X-2026-09-28-app-redesign.md Decision 2; signal from packages/obd-core/vehicles/chevrolet-equinox-ev/default.json).
 */
export function socHero(report: BatteryDiagnosisReport): { percent: number; tier: "verified" | "community"; scannedAt: string } | undefined {
  const soc = report.signals.filter((signal) => signal.id === "EQUINOXEV_SOC").at(-1);
  return soc ? { percent: Math.round(soc.value * 10) / 10, tier: soc.tier, scannedAt: report.scannedAt } : undefined;
}
