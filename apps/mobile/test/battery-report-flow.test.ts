// @ts-expect-error Node built-in types are not part of the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importObdbMode22 } from "obd-core/vehicles";
import { batteryDiagnosisFromRecording, type BatteryDiagnosisReport } from "../../../packages/obd-battery/src/report.js";
import { createBatteryReportHistory } from "../src/batteryReports.js";
import { createGarageFlow } from "../src/garage/flow.js";
import { batteryReportRows, removeGarageVehicleWithReports } from "../src/batteryScan.js";

const read = readFileSync as unknown as (path: URL, encoding: string) => string;
const write = writeFileSync as unknown as (path: string, text: string) => void;

class MemoryStore {
  value?: string;
  writes = 0;
  fail = false;
  read() { return Promise.resolve(this.value); }
  write(text: string) { if (this.fail) return Promise.reject(new Error("disk full")); this.value = text; this.writes++; return Promise.resolve(); }
}

const root = new URL("../../../", import.meta.url);
const recording = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl";
const signalset = importObdbMode22(JSON.parse(read(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")));
const scan = (garageVehicleId: string, scannedAt: string, source = recording): Promise<BatteryDiagnosisReport> => batteryDiagnosisFromRecording(
  read(new URL(source, root), "latin1"),
  { garageVehicleId, catalogId: "chevrolet-equinox-ev-2024", scannedAt, recording: source, scanStatus: "complete" }, signalset,
);

describe("battery report garage history", () => {
  it("presents each saved report under its own garage ID and protects retained reports", async () => {
    const garageStore = new MemoryStore(); const garage = createGarageFlow(garageStore);
    await garage.add("chevrolet-equinox-ev-2024", "mine");
    await garage.add("chevrolet-equinox-ev-2024", "checked");
    const store = new MemoryStore();
    const history = createBatteryReportHistory(store, garage);
    const first = await scan("1", "2026-09-22T00:00:00.000Z");
    const second = await scan("2", "2026-09-23T00:00:00.000Z", "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike-2.redacted.jsonl");
    await history.save(first); await history.save(second);
    await garage.changeOwnership("1", "checked");
    const reopened = createBatteryReportHistory(store, createGarageFlow(garageStore));
    const rows1 = batteryReportRows(await reopened.list("1"));
    const rows2 = batteryReportRows(await reopened.list("2"));
    expect(rows1).toHaveLength(1); expect(rows2).toHaveLength(1);
    expect(rows1[0]?.detail).toContain("Garage vehicle: 1");
    expect(rows2[0]?.detail).toContain("Garage vehicle: 2");
    expect(rows1[0]?.detail).toContain(first.recording);
    expect(rows2[0]?.detail).toContain(second.recording);
    expect(rows1[0]?.detail).not.toContain(second.recording);
    expect(rows2[0]?.detail).not.toContain(first.recording);
    await expect(removeGarageVehicleWithReports(garage, reopened, "1")).rejects.toThrow("retained");
    expect((await garage.load()).vehicles).toHaveLength(2);
    write("/tmp/t2.6b-report-history.json", `${JSON.stringify({ ids: ["1", "2"], rows: [rows1.map(({ label }) => label), rows2.map(({ label }) => label)], ownership: (await garage.load()).vehicles[0]?.ownership, removal: "retained" })}\n`);
  });
  it("keeps a saved report when an overlapping initial load finishes late", async () => {
    const garage = createGarageFlow(new MemoryStore());
    await garage.add("chevrolet-equinox-ev-2024", "mine");
    let releaseRead: ((value: string | undefined) => void) | undefined;
    const store = new MemoryStore();
    const read = store.read.bind(store);
    store.read = () => releaseRead === undefined
      ? new Promise<string | undefined>((resolve) => { releaseRead = resolve; })
      : read();
    const history = createBatteryReportHistory(store, garage);
    const overlappingLoad = history.load();
    const firstSave = history.save(await scan("1", "2026-09-22T00:00:00.000Z"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseRead?.(undefined);
    await firstSave;
    await overlappingLoad;
    await history.save(await scan("1", "2026-09-23T00:00:00.000Z"));
    const reloaded = createBatteryReportHistory(store, garage);
    const timestamps = (await reloaded.list("1")).map((report) => report.scannedAt);
    write("/tmp/t2.6a-battery-report-overlap.json", `${JSON.stringify({ garageId: "1", timestamps, writes: store.writes })}\n`);
    expect(timestamps).toEqual(["2026-09-23T00:00:00.000Z", "2026-09-22T00:00:00.000Z"]);
  });

  it("orders offset timestamps by instant and keeps newest save first at equal instants", async () => {
    const garage = createGarageFlow(new MemoryStore());
    await garage.add("chevrolet-equinox-ev-2024", "mine");
    const store = new MemoryStore();
    const history = createBatteryReportHistory(store, garage);
    for (const timestamp of ["2026-09-22T10:00:00.000+02:00", "2026-09-22T11:00:00.000+02:00", "2026-09-22T09:00:00.000Z"]) {
      await history.save(await scan("1", timestamp));
    }
    const timestamps = (await createBatteryReportHistory(store, garage).list("1")).map((report) => report.scannedAt);
    write("/tmp/t2.6a-battery-report-order.json", `${JSON.stringify({ garageId: "1", timestamps })}\n`);
    expect(timestamps).toEqual(["2026-09-22T09:00:00.000Z", "2026-09-22T11:00:00.000+02:00", "2026-09-22T10:00:00.000+02:00"]);
  });

  it("keeps identical catalog models separate, ordered and durable", async () => {
    const garageStore = new MemoryStore(); const garage = createGarageFlow(garageStore);
    await garage.add("chevrolet-equinox-ev-2024", "mine");
    await garage.add("chevrolet-equinox-ev-2024", "checked");
    const store = new MemoryStore(); let history = createBatteryReportHistory(store, garage);
    await history.load();
    await history.save(await scan("1", "2026-09-22T00:00:00.000Z"));
    await history.save(await scan("2", "2026-09-23T00:00:00.000Z"));
    await history.save(await scan("1", "2026-09-24T00:00:00.000Z"));
    history = createBatteryReportHistory(store, garage); await history.load();
    expect((await history.list("1")).map((r) => r.scannedAt)).toEqual(["2026-09-24T00:00:00.000Z", "2026-09-22T00:00:00.000Z"]);
    expect(await history.list("2")).toHaveLength(1);
    expect(await history.hasReports("1")).toBe(true);
    const before = store.value; const writes = store.writes;
    await expect(history.save(await scan("99", "2026-09-24T00:00:00.000Z"))).rejects.toThrow();
    await garage.add("chevrolet-blazer-ev-2024", "mine");
    await expect(history.save(await scan("3", "2026-09-24T00:00:00.000Z"))).rejects.toThrow();
    expect(store.value).toBe(before); expect(store.writes).toBe(writes);
    store.fail = true;
    await expect(history.save(await scan("1", "2026-09-25T00:00:00.000Z"))).rejects.toThrow("disk full");
    expect(await history.list("1")).toHaveLength(2);
    store.fail = false;
    write("/tmp/t2.6a-battery-report-flow.json", `${JSON.stringify({ garageIds: ["1", "2"], counts: [2, 1] })}\n`);
    for (const corrupt of ["{bad", JSON.stringify({ version: 2, reports: [] })]) {
      const badStore = new MemoryStore(); badStore.value = corrupt;
      await expect(createBatteryReportHistory(badStore, garage).load()).rejects.toThrow();
      expect(badStore.value).toBe(corrupt); expect(badStore.writes).toBe(0);
    }
  });
});
