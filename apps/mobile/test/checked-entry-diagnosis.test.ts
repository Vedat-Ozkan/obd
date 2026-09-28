// T2.7: a garage entry tagged `checked` gets the same battery diagnosis as a `mine` entry. Case 1 persists the redacted
// Equinox spike report under the checked entry's ID and reads it back through fresh flow and history instances. Case 2 runs
// the production scan action for the checked entry over the labelled synthetic combined scan. Expected values are fixed
// literals read off `battery-diagnosis.ts <recording> --garage-id 2` output (spec §Sources), not re-derived from the report.
// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRecording } from "obd-core/recording";
import { ReplayTransport } from "obd-core/transport/replay";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis } from "../../../packages/obd-battery/src/report.js";
import { codesView, moduleRows, reportSummary, sectionDetail } from "../src/app/reportView.js";
import { runAndSaveBatteryDiagnosis } from "../src/batteryDiagnosisFlow.js";
import { createBatteryReportHistory } from "../src/batteryReports.js";
import { createGarageFlow } from "../src/garage/flow.js";
import { RecordingBuffer } from "../src/recording.js";

const read = readFileSync as (path: URL, encoding: "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const root = new URL("../../../", import.meta.url);
const signals = importObdbMode22(signalsetJson);
const catalogId = "chevrolet-equinox-ev-2024";
const spikePath = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl";

class Store {
  value?: string;
  read() { return Promise.resolve(this.value); }
  write(value: string) { this.value = value; return Promise.resolve(); }
}
const setup = async () => {
  const garageStore = new Store(); const historyStore = new Store();
  const garage = createGarageFlow(garageStore);
  const mine = (await garage.add(catalogId, "mine")).vehicles[0];
  const checked = (await garage.add(catalogId, "checked")).vehicles[1];
  return { garageStore, historyStore, garage, mine, checked, history: createBatteryReportHistory(historyStore, garage) };
};
const reload = (garageStore: Store, historyStore: Store) => {
  const garage = createGarageFlow(garageStore);
  return { garage, history: createBatteryReportHistory(historyStore, garage) };
};

describe("checked garage entry battery diagnosis", () => {
  it("saves the spike recording's report under the checked entry and shows every supported field after reload", async () => {
    const { garageStore, historyStore, mine, checked, history } = await setup();
    expect([mine.id, mine.ownership, checked.id, checked.ownership]).toEqual(["1", "mine", "2", "checked"]);
    const scannedAt = "2026-09-22T00:00:00.000Z";
    await history.save(await batteryDiagnosisFromRecording(read(new URL(spikePath, root), "latin1"), { garageVehicleId: checked.id, catalogId, scannedAt, recording: spikePath, scanStatus: "complete" }, signals));

    const fresh = reload(garageStore, historyStore);
    const under2 = await fresh.history.list("2"); const under1 = await fresh.history.list("1");
    expect(under2).toHaveLength(1);
    expect(under2[0].garageVehicleId).toBe("2");
    expect(under2[0].recording).toBe(spikePath);
    expect(under1).toHaveLength(0);
    const reloaded = await fresh.garage.load();
    expect(reloaded.vehicles.find((v) => v.id === "2")?.ownership).toBe("checked");
    const report = under2[0];

    const summary = reportSummary(report);
    expect(summary.soc?.percent).toBe(69.8);
    expect(summary.soc?.tier).toBe("verified");
    expect(summary.rows.map((row) => [row.section, row.value])).toEqual([["cells", "3.0 mV"], ["capacity", "Not measured"], ["twelveVolt", "12.7 V"], ["codes", "No codes"]]);
    expect(summary.rows[3].rating.rating).toBe("ok");

    const soc = sectionDetail(report, "soc");
    expect(soc.hero).toMatchObject({ value: "69.8", unit: "%", tag: "verified" });
    expect(soc.readings).toEqual([
      { label: "State of charge", value: "69.8039 %", tier: "verified" },
      { label: "State of charge (high resolution)", value: "69.6147 %", tier: "verified" },
    ]);
    const cells = sectionDetail(report, "cells");
    expect(cells.hero).toMatchObject({ value: "3.0", unit: "mV", tag: "community" });
    expect(cells.cellRange).toEqual({ minMv: 3928.7, avgMv: 3929.7, maxMv: 3931.7 });
    expect(cells.readings.at(-1)).toEqual({ label: "Spread", value: "3.0 mV", tier: "community" });
    expect(sectionDetail(report, "capacity").hero).toMatchObject({ value: "Not measured", tag: "neutral" });
    const twelve = sectionDetail(report, "twelveVolt");
    expect(twelve.hero).toMatchObject({ value: "12.7", unit: "V", tagLabel: "Not assessed" });
    expect(twelve.readings).toEqual([{ label: "Adapter supply (ATRV)", value: "12.7 V" }, { label: "Car power state", value: "ready" }]);

    const codes = codesView(report.codes);
    expect(codes.codeCount).toBe(0);
    expect(codes.legs.map((leg) => leg.result)).toEqual(["yes", "no", "unknown", "no"]);
    expect(codes.modules.map((m) => m.ecu)).toEqual(["17", "28", "40", "45", "CB"]);
    expect(report.codes.recentlyCleared.verdict).toBe("unknown");
    const rows17 = moduleRows(report.codes, "17") ?? [];
    const row = (label: string) => rows17.find((r) => r.label === label)?.value;
    expect(row("Time since codes cleared (PID 4E)")).toBe("not supported");
    expect(row("Permanent codes (Mode 0A)")).toBe("not answered (negative response 11)");
    expect(row("Warm-ups since codes cleared (PID 30)")).toBe("not read");

    expect(report.capacity.status).toBe("not-measured");
    expect(report.health.status).toBe("not-assessed");
    const rendered = renderBatteryDiagnosis(report);
    for (const phrase of ["Garage vehicle: 2", "capacity: NOT MEASURED", "battery health: not assessed", "Recently cleared: unknown"]) expect(rendered).toContain(phrase);

    write("/tmp/t2.7-checked-report.md", rendered);
    write("/tmp/t2.7-checked-real.json", `${JSON.stringify({
      garage: reloaded.vehicles.map((v) => ({ id: v.id, ownership: v.ownership })),
      reportCounts: { "1": under1.length, "2": under2.length },
      recording: report.recording,
      summaryRows: summary.rows.map((r) => ({ section: r.section, value: r.value, rating: r.rating.rating })),
      soc: summary.soc,
      recentlyCleared: { verdict: report.codes.recentlyCleared.verdict, legs: codes.legs.map((leg) => leg.result) },
      capacityStatus: report.capacity.status,
      healthStatus: report.health.status,
    }, null, 2)}\n`);
  });

  it("runs the production scan action for the checked entry over the synthetic combined scan", async () => {
    const { garageStore, historyStore, checked, history } = await setup();
    const fixture = parseRecording(read(new URL("fixtures/synthetic/battery-diagnosis-full-scan.jsonl", root), "latin1"));
    const buffer = new RecordingBuffer(() => 1);
    buffer.start({ car: catalogId, dongle: "veepeak-obdcheck-ble", note: "synthetic ready", writeChar: "fff1", notifyChar: "fff2", mtu: 23 });
    const label = "battery-scans/2/synthetic.jsonl";
    const keeps: { id: string; historyWritten: boolean }[] = [];
    const result = await runAndSaveBatteryDiagnosis({
      entry: checked, transport: new ReplayTransport(fixture), recording: buffer, scannedAt: "2026-09-24T00:00:00.000Z",
      keepScan: (id) => { keeps.push({ id, historyWritten: historyStore.value !== undefined }); return label; },
      history, importedSignals: signals, getInterruption: () => undefined, onProgress: () => undefined,
    });
    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;
    expect(keeps).toEqual([{ id: "2", historyWritten: false }]);
    expect(result.report.garageVehicleId).toBe("2");
    expect(result.report.recording).toBe(label);
    expect(result.report.scanStatus).toBe("complete");

    const fresh = reload(garageStore, historyStore);
    const under2 = await fresh.history.list("2"); const under1 = await fresh.history.list("1");
    expect(under2).toEqual([result.report]);
    expect(under1).toHaveLength(0);
    write("/tmp/t2.7-checked-action.json", `${JSON.stringify({
      synthetic: true, entryId: checked.id, ownership: checked.ownership, status: result.status,
      scanStatus: result.report.scanStatus, privateLabel: result.recording, reportCounts: { "1": under1.length, "2": under2.length },
    }, null, 2)}\n`);
  });
});
