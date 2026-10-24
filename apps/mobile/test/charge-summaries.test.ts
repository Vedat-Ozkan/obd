// @ts-expect-error Node built-in types are not part of the mobile compilation target.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importObdbMode22 } from "obd-core/vehicles";
import type { ChargeSessionSummary } from "../../../packages/obd-battery/src/chargeSummary.js";
import { createChargeSummaryHistory, saveChargeLogSummary } from "../src/chargeSummaries.js";
import { trendCaptions } from "../src/app/trendView.js";
import { createGarageFlow } from "../src/garage/flow.js";

const read = readFileSync as unknown as (path: URL, encoding: string) => string;

class MemoryStore {
  value?: string;
  read() { return Promise.resolve(this.value); }
  write(text: string) { this.value = text; return Promise.resolve(); }
}

const root = new URL("../../../", import.meta.url);
const file = "fixtures/synthetic/charge-log-rested.jsonl";
const signals = importObdbMode22(JSON.parse(read(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")));
const request = (garageVehicleId: string, at: string) => ({ garageVehicleId, file, text: read(new URL(file, root), "latin1"), at, signals });

async function setup() {
  const garage = createGarageFlow(new MemoryStore());
  await garage.add("chevrolet-equinox-ev-2024", "mine");
  await garage.add("chevrolet-equinox-ev-2024", "checked");
  const store = new MemoryStore();
  return { garage, store, history: createChargeSummaryHistory(store, garage) };
}

describe("charge log summaries on the phone", () => {
  it("keeps a saved charge log under its own car and after reopening", async () => {
    const { garage, store, history } = await setup();
    const saved = await saveChargeLogSummary(history, request("1", "2026-10-01T10:00:00.000Z"));
    expect(saved.recording).toBe(file);
    expect(await history.list("2")).toEqual([]);
    const reopened = createChargeSummaryHistory(store, garage);
    const [summary] = await reopened.list("1");
    expect(summary?.id).toBe(file);
    expect(summary?.at).toBe("2026-10-01T10:00:00.000Z");
    expect(summary?.synthetic).toBe(true);
    expect(trendCaptions([], await reopened.list("1"))).toEqual(["BMS-referenced capacity index (Ah), not state of health: Not enough data yet: 1 sessions over 0 days."]);
  });

  it("refuses a charge log for a car that is not in the garage", async () => {
    const { history } = await setup();
    await expect(saveChargeLogSummary(history, request("9", "2026-10-01T10:00:00.000Z"))).rejects.toThrow("garage vehicle");
  });

  it("does not overwrite a malformed history file", async () => {
    const { garage, store } = await setup();
    store.value = "{not json";
    const history = createChargeSummaryHistory(store, garage);
    await expect(history.list("1")).rejects.toThrow("malformed");
    expect(store.value).toBe("{not json");
  });

  it("writes a trend caption sentence once ten sessions over a year are gate-passing", async () => {
    const { history } = await setup();
    const base = await saveChargeLogSummary(history, request("1", "2026-01-01T00:00:00.000Z"));
    const series: ChargeSessionSummary[] = Array.from({ length: 10 }, (_, i) => ({
      ...base, id: `s${String(i)}`, at: new Date(Date.UTC(2026, 0, 1) + i * 40 * 86_400_000).toISOString(), gateFailures: [],
      capacity: { ah: 100 * (1 - 0.03 * (i * 40) / 365), bandAh: 0.2, deltaSoc: 40 },
    }));
    const [caption] = trendCaptions([], series);
    expect(caption).toMatch(/^BMS-referenced capacity index \(Ah\), not state of health: 0\.9\d, change −\d\.\d %\/yr ± \d\.\d \(2 standard errors\) over 10 sessions; significant\.$/);
  });
});
