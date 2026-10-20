export interface Mode22Module {
  readonly target: string;
  readonly dids: readonly string[];
}

export interface VehicleProfile {
  protocol: "0" | "6" | "7";
  mode22?: readonly Mode22Module[];
}

export const genericProfile: VehicleProfile = { protocol: "0" };

export const equinoxEv2024Profile: VehicleProfile = {
  protocol: "7",
  mode22: [
    { target: "1D", dids: ["33E5"] },
    { target: "CB", dids: ["27C6", "2AF5", "2B43"] },
  ],
};
