import type { ObdbMode22Signal } from "./import.js";

export interface EquinoxSignalEvidence {
  readonly recording: string;
  readonly check: string;
}

// The first September 22 capture records the owner's 70% dash observation in Ready/Park.
// The second capture repeats the same observation; a distinct-SOC check remains T2.2b.
export const equinoxEv2024Evidence: Readonly<Record<string, EquinoxSignalEvidence>> = {
  EQUINOXEV_SOC_HD: {
    recording: "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl",
    check: "CB/27C6 decodes to 69.6147%, which rounds to the recorded 70% dash SOC in Ready/Park",
  },
  EQUINOXEV_SOC: {
    recording: "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl",
    check: "CB/2B43 decodes to 69.8039%, which rounds to the recorded 70% dash SOC in Ready/Park",
  },
};

/** Apply the fixed 2024 Equinox evidence to matching imported signal definitions only. */
export function withEquinoxEv2024Evidence(imported: readonly ObdbMode22Signal[]): readonly ObdbMode22Signal[] {
  return imported.map((signal) => {
    const supported = signal.module === "CB" && (
      (signal.id === "EQUINOXEV_SOC_HD" && signal.did === "27C6") ||
      (signal.id === "EQUINOXEV_SOC" && signal.did === "2B43")
    );
    return supported ? { ...signal, tier: "verified" } : { ...signal };
  });
}
