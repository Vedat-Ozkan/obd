export type Tier = "verified" | "beta";
export type CatalogVehicle = { id: string; make: string; model: string; year: number; tier: Tier; recording?: string };

// Exact model years and manufacturer sources are recorded in docs/specs/T2.8a-garage-picker-local.md.
const models = [
  { slug: "chevrolet-equinox-ev", make: "Chevrolet", model: "Equinox EV", years: [2024, 2025, 2026] },
  { slug: "chevrolet-blazer-ev", make: "Chevrolet", model: "Blazer EV", years: [2024, 2025, 2026] },
  { slug: "chevrolet-silverado-ev", make: "Chevrolet", model: "Silverado EV", years: [2024, 2025, 2026] },
  { slug: "gmc-sierra-ev", make: "GMC", model: "Sierra EV", years: [2024, 2025, 2026] },
  { slug: "gmc-hummer-ev-pickup", make: "GMC", model: "Hummer EV Pickup", years: [2023, 2024, 2025, 2026] },
  { slug: "gmc-hummer-ev-suv", make: "GMC", model: "Hummer EV SUV", years: [2024, 2025, 2026] },
  { slug: "cadillac-lyriq", make: "Cadillac", model: "LYRIQ", years: [2023, 2024, 2025, 2026] },
  { slug: "cadillac-optiq", make: "Cadillac", model: "OPTIQ", years: [2025, 2026] },
  { slug: "honda-prologue", make: "Honda", model: "Prologue", years: [2024, 2025, 2026] },
  { slug: "acura-zdx-ev", make: "Acura", model: "ZDX EV", years: [2024] },
] as const;

export const SUPPORTED_VEHICLES: readonly CatalogVehicle[] = models.flatMap(({ slug, make, model, years }) => years.map((year) => {
  const verified = slug === "chevrolet-equinox-ev" && year === 2024;
  return verified
    ? { id: `${slug}-${String(year)}`, make, model, year, tier: "verified" as const, recording: "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl" }
    : { id: `${slug}-${String(year)}`, make, model, year, tier: "beta" as const };
}));

export function vehicleAvailability(vehicle: CatalogVehicle): string {
  return vehicle.tier === "verified"
    ? "Verified model year by a recorded 2024 Equinox EV session; battery data is not shown in this garage."
    : "Beta model year. Battery data unavailable pending a vehicle profile and live-car checks.";
}

export function vehicleEvidence(vehicle: CatalogVehicle): string {
  return vehicle.recording ? `Recording: ${vehicle.recording}` : "No verified model-year recording; battery signals unavailable.";
}

export function canUseEquinoxConsole(vehicle: CatalogVehicle): boolean {
  return vehicle.id === "chevrolet-equinox-ev-2024" && vehicle.tier === "verified" && !!vehicle.recording;
}
