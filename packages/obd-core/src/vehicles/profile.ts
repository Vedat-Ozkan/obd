/** What the session needs from a vehicle today. T2.1 adds headers, setup commands, and signal decoders. */
export interface VehicleProfile {
  /** ATSP argument: "0" auto search, "6" ISO 15765-4 CAN 11-bit/500k, "7" ISO 15765-4 CAN 29-bit/500k (docs/ELM327.md §Init sequence, §Per-car notes). */
  protocol: "0" | "6" | "7";
}

/** Auto search. The Equinox EV uses this; its search lands on 29-bit (spike line 32). */
export const genericProfile: VehicleProfile = { protocol: "0" };
