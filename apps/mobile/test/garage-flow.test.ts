// Vitest runs in Node; Expo's mobile typecheck intentionally omits Node typings.
// @ts-expect-error Node built-in types are not part of the mobile compilation target.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_VEHICLES, canUseEquinoxConsole, vehicleAvailability, vehicleEvidence } from "../src/garage/catalog.js";
import { LOCAL_INTEREST_NOTICE, createGarageFlow, type TextStore } from "../src/garage/flow.js";

const expectedIds = [
  ...[2024, 2025, 2026].map((year) => `chevrolet-equinox-ev-${String(year)}`),
  ...[2024, 2025, 2026].map((year) => `chevrolet-blazer-ev-${String(year)}`),
  ...[2024, 2025, 2026].map((year) => `chevrolet-silverado-ev-${String(year)}`),
  ...[2024, 2025, 2026].map((year) => `gmc-sierra-ev-${String(year)}`),
  ...[2023, 2024, 2025, 2026].map((year) => `gmc-hummer-ev-pickup-${String(year)}`),
  ...[2024, 2025, 2026].map((year) => `gmc-hummer-ev-suv-${String(year)}`),
  ...[2023, 2024, 2025, 2026].map((year) => `cadillac-lyriq-${String(year)}`),
  ...[2025, 2026].map((year) => `cadillac-optiq-${String(year)}`),
  ...[2024, 2025, 2026].map((year) => `honda-prologue-${String(year)}`),
  "acura-zdx-ev-2024",
];

class MemoryStore implements TextStore {
  writes = 0;
  failWrite = false;
  constructor(public value?: string) {}
  read() { return Promise.resolve(this.value); }
  write(text: string) {
    if (this.failWrite) return Promise.reject(new Error("disk full"));
    this.value = text;
    this.writes++;
    return Promise.resolve();
  }
}

describe("garage user flow", () => {
  it("replays picker, garage changes, and reopened local interest", async () => {
    const store = new MemoryStore();
    let flow = createGarageFlow(store);
    expect(await flow.load()).toEqual({ version: 1, nextId: 1, vehicles: [], interests: [] });
    expect(SUPPORTED_VEHICLES.map((vehicle) => vehicle.id)).toEqual(expectedIds);
    expect(SUPPORTED_VEHICLES.find((vehicle) => vehicle.id === "tesla-model-3-2024")).toBeUndefined();
    expect(SUPPORTED_VEHICLES.find((vehicle) => vehicle.id === "ford-f150-2024")).toBeUndefined();
    const verified = SUPPORTED_VEHICLES.filter((vehicle) => vehicle.tier === "verified");
    expect(verified).toEqual([{ id: "chevrolet-equinox-ev-2024", make: "Chevrolet", model: "Equinox EV", year: 2024, tier: "verified", recording: "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl" }]);
    expect(vehicleEvidence(verified[0])).toContain(verified[0].recording);
    expect(canUseEquinoxConsole(verified[0])).toBe(true);
    expect(SUPPORTED_VEHICLES.filter((vehicle) => vehicle.tier === "beta")).toHaveLength(expectedIds.length - 1);
    expect(SUPPORTED_VEHICLES.filter((vehicle) => vehicle.tier === "beta").every((vehicle) => !canUseEquinoxConsole(vehicle))).toBe(true);
    expect(SUPPORTED_VEHICLES.every((vehicle) => vehicle.tier === "verified" || vehicleAvailability(vehicle).includes("Battery data unavailable"))).toBe(true);

    await flow.add("chevrolet-equinox-ev-2024", "mine");
    await flow.add("chevrolet-blazer-ev-2025", "checked");
    flow = createGarageFlow(store);
    const reloaded = await flow.load();
    expect(reloaded.vehicles).toEqual([{ id: "1", catalogId: "chevrolet-equinox-ev-2024", ownership: "mine" }, { id: "2", catalogId: "chevrolet-blazer-ev-2025", ownership: "checked" }]);
    const beta = SUPPORTED_VEHICLES.find((vehicle) => vehicle.id === reloaded.vehicles[1]?.catalogId);
    expect(beta).toBeDefined();
    if (!beta) throw new Error("Beta catalog entry missing");
    expect([beta.make, beta.model, beta.year, beta.tier]).toEqual(["Chevrolet", "Blazer EV", 2025, "beta"]);
    expect(vehicleAvailability(beta)).toContain("Battery data unavailable");
    expect(canUseEquinoxConsole(beta)).toBe(false);
    await flow.changeOwnership("2", "mine");
    flow = createGarageFlow(store); expect((await flow.load()).vehicles[1]?.ownership).toBe("mine");
    await flow.remove("1");
    flow = createGarageFlow(store);
    expect((await flow.load()).vehicles).toEqual([{ id: "2", catalogId: "chevrolet-blazer-ev-2025", ownership: "mine" }]);
    const writesBefore = store.writes;
    await expect(flow.add("tesla-model-3-2024", "mine")).rejects.toThrow();
    expect(store.writes).toBe(writesBefore);
    expect((await flow.load()).vehicles).toHaveLength(1);
    await flow.saveInterest({ make: "Rivian", model: "R1T", year: 2025, joinBeta: true });
    flow = createGarageFlow(store);
    const finalState = await flow.load();
    expect(finalState.interests).toEqual([{ make: "Rivian", model: "R1T", year: 2025, joinBeta: true }]);
    expect(LOCAL_INTEREST_NOTICE).toBe("Saved on this phone; no request sent");
    const artifact = { catalogCount: expectedIds.length, verified: verified[0]?.id, evidence: vehicleEvidence(verified[0]), verifiedConsoleAllowed: canUseEquinoxConsole(verified[0]), betaConsoleAllowed: canUseEquinoxConsole(beta), added: reloaded.vehicles, changed: { id: "2", ownership: "mine" }, remaining: finalState.vehicles, reopenedInterest: finalState.interests[0], notice: LOCAL_INTEREST_NOTICE };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- Vitest has Node's fs at runtime; Expo omits its typings.
    writeFileSync("/tmp/t28-garage-flow.json", `${JSON.stringify(artifact)}\n`);
    expect(JSON.parse(store.value ?? "null")).toEqual(finalState);
  });

  it("preserves invalid or future data and rejects a failed write", async () => {
    for (const value of ["{broken", JSON.stringify({ version: 2, nextId: 1, vehicles: [], interests: [] })]) {
      const store = new MemoryStore(value);
      await expect(createGarageFlow(store).load()).rejects.toThrow();
      expect(store.value).toBe(value); expect(store.writes).toBe(0);
    }
    const store = new MemoryStore(); const flow = createGarageFlow(store);
    await flow.load(); await flow.add("chevrolet-equinox-ev-2024", "mine");
    store.failWrite = true;
    await expect(flow.add("chevrolet-blazer-ev-2025", "checked")).rejects.toThrow("disk full");
    expect((await createGarageFlow(store).load()).vehicles).toEqual([{ id: "1", catalogId: "chevrolet-equinox-ev-2024", ownership: "mine" }]);
  });
});
