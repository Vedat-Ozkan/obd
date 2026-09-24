export interface Mode22Module {
  readonly target: string;
  readonly dids: readonly string[];
}

export interface VehicleProfile {
  /** ATSP argument: "0" auto search, "6" ISO 15765-4 CAN 11-bit/500k, "7" ISO 15765-4 CAN 29-bit/500k (docs/ELM327.md §Init sequence, §Per-car notes). */
  protocol: "0" | "6" | "7";
  mode22?: readonly Mode22Module[];
}

/** Auto search. The Equinox EV uses this; its search lands on 29-bit (spike line 32). */
export const genericProfile: VehicleProfile = { protocol: "0" };

/** Recorded scan plan: 2026-09-22-spike.redacted.jsonl lines 129–171; spike-2 lines 129–173. */
export const equinoxEv2024Profile: VehicleProfile = {
  protocol: "7",
  mode22: [
    { target: "1D", dids: ["33E5"] },
    { target: "CB", dids: ["27C6", "2AF5", "2B43"] },
  ],
};
