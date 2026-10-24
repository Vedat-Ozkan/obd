import { readFileSync, writeFileSync } from "node:fs";
import { importObdbMode22 } from "../../packages/obd-core/src/vehicles/index.js";
import type { ChargeSessionSummary } from "../../packages/obd-battery/src/chargeSummary.js";
import { saveChargeLogSummary } from "../../apps/mobile/src/chargeSummaries.js";

const [out, garageVehicleId = "1"] = process.argv.slice(2);
if (out === undefined) throw new Error("usage: seed-trend.ts <out charge-summaries.json> [garage vehicle id]");
const signals = importObdbMode22(JSON.parse(readFileSync("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", "utf8")));
const text = readFileSync("fixtures/synthetic/charge-log-rested.jsonl", "utf8");
const sessions: { garageVehicleId: string; summary: ChargeSessionSummary }[] = [];
const history = { save: (id: string, summary: ChargeSessionSummary) => { sessions.push({ garageVehicleId: id, summary }); return Promise.resolve(); } };
for (const [file, at] of [["simulated-charge-log-a.jsonl", "2026-09-01T08:00:00.000Z"], ["simulated-charge-log-b.jsonl", "2026-10-01T08:00:00.000Z"]] as const) {
  await saveChargeLogSummary(history, { garageVehicleId, file, text, at, signals });
}
writeFileSync(out, JSON.stringify({ version: 1, sessions }));
console.log(`seeded ${String(sessions.length)} synthetic charge summaries for vehicle ${garageVehicleId}`);
