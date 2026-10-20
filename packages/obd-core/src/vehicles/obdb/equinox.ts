import type { ObdbMode22Signal } from "./import.js";

export interface EquinoxSignalEvidence {
  readonly recording: string;
  readonly check: string;
}

export const equinoxEv2024Evidence: Readonly<Record<string, EquinoxSignalEvidence>> = {
  EQUINOXEV_SOC_HD: {
    recording: "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl",
    check: "CB/27C6 decodes to 69.6147%, which rounds to the recorded 70% dash SOC in Ready/Park",
  },
  EQUINOXEV_SOC: {
    recording: "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl",
    check: "CB/2B43 decodes to 69.8039%, which rounds to the recorded 70% dash SOC in Ready/Park",
  },
  EQUINOXEV_BMS_ENERGY_REMAINING: {
    recording: "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-23-discovery-targeted.redacted.jsonl",
    check: "CB/27AF unsigned 16-bit / 100 kWh changed with load and charging in the targeted watch; absolute energy level and capacity inferred from SOC remain unverified",
  },
};

export function withEquinoxEv2024Evidence(imported: readonly ObdbMode22Signal[]): readonly ObdbMode22Signal[] {
  if (imported.some((signal) => signal.id === "EQUINOXEV_BMS_ENERGY_REMAINING" || (signal.module === "CB" && signal.did === "27AF"))) {
    throw new Error("duplicate Equinox first-party 27AF signal");
  }
  return [...imported.map((signal) => {
    const supported = signal.module === "CB" && (
      (signal.id === "EQUINOXEV_SOC_HD" && signal.did === "27C6") ||
      (signal.id === "EQUINOXEV_SOC" && signal.did === "2B43")
    );
    return supported ? { ...signal, tier: "verified" as const } : { ...signal };
  }), { id: "EQUINOXEV_BMS_ENERGY_REMAINING", name: "BMS energy remaining", module: "CB", did: "27AF", bix: 0, len: 16, mul: 1, div: 100, add: 0, unit: "kWh", tier: "verified" as const }];
}
