// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRecording, type RecordingLine } from "obd-core/recording";
import { ReplayTransport } from "obd-core/transport/replay";
import type { Transport } from "obd-core/transport";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis } from "../../../packages/obd-battery/src/report.js";
import { runAndSaveBatteryDiagnosis } from "../src/batteryDiagnosisFlow.js";
import { createBatteryReportHistory } from "../src/batteryReports.js";
import { removeGarageVehicleWithReports } from "../src/batteryScan.js";
import { createGarageFlow, type GarageVehicle } from "../src/garage/flow.js";
import { RecordingBuffer } from "../src/recording.js";

const read = readFileSync as (path: URL, encoding: "utf8" | "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const root = new URL("../../../", import.meta.url);
const fixture = parseRecording(read(new URL("fixtures/synthetic/battery-diagnosis-full-scan.jsonl", root), "latin1"));
const signals = importObdbMode22(signalsetJson);
const at = "2026-09-24T00:00:00.000Z";
const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "synthetic ready", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
class Store {
  value?: string;
  fail = false;
  read() { return Promise.resolve(this.value); }
  write(value: string) { if (this.fail) return Promise.reject(new Error("disk full")); this.value = value; return Promise.resolve(); }
}
const setup = async () => {
  const garageStore = new Store(); const garage = createGarageFlow(garageStore);
  const first = (await garage.add("chevrolet-equinox-ev-2024", "mine")).vehicles[0];
  const second = (await garage.add("chevrolet-equinox-ev-2024", "checked")).vehicles[1];
  const historyStore = new Store(); const history = createBatteryReportHistory(historyStore, garage);
  return { garageStore, garage, first, second, historyStore, history };
};
function recording() { const buffer = new RecordingBuffer(() => 1); buffer.start(meta); return buffer; }
function noSoc(): RecordingLine[] {
  let strip = false;
  return fixture.flatMap((line) => {
    if (line.dir === "tx") strip = line.data === "22 27C6\r" || line.data === "22 2B43\r";
    if (strip && line.dir === "rx") return line.data.includes(">") ? [{ ...line, data: "NO DATA\r\r>" }] : [];
    return [line];
  });
}
function failureAt(command: string): RecordingLine[] {
  const index = fixture.findIndex((line) => line.dir === "tx" && line.data === `${command}\r`);
  return [...fixture.slice(0, index + 1), { t: fixture[index].t + 1, dir: "rx", data: "LV RESET\r\r>" }];
}
async function run(entry: GarageVehicle, lines: RecordingLine[], history: ReturnType<typeof createBatteryReportHistory>, keepScan: (id: string, time: string, jsonl: string) => string | Promise<string>) {
  return runAndSaveBatteryDiagnosis({ entry, transport: new ReplayTransport(lines), recording: recording(), scannedAt: at, keepScan, history, importedSignals: signals, getInterruption: () => undefined, onProgress: () => undefined });
}

class DeferredCloseReplay implements Transport {
  readonly startsIdle = true;
  readonly replay: ReplayTransport;
  readonly closeEntered: Promise<void>;
  private releaseClose!: () => void;
  private markCloseEntered!: () => void;
  private readonly closeGate: Promise<void>;

  constructor(lines: RecordingLine[]) {
    this.replay = new ReplayTransport(lines);
    this.closeEntered = new Promise((resolve) => { this.markCloseEntered = resolve; });
    this.closeGate = new Promise((resolve) => { this.releaseClose = resolve; });
  }
  write(bytes: Uint8Array) { return this.replay.write(bytes); }
  onData(callback: (bytes: Uint8Array) => void) { return this.replay.onData(callback); }
  async close() { this.markCloseEntered(); await this.closeGate; await this.replay.close(); }
  release() { this.releaseClose(); }
}

class RejectingCloseReplay extends DeferredCloseReplay {
  override async close() {
    await super.close();
    throw new Error("BLE close failed");
  }
}

function hasFinalResponse(jsonl: string): boolean {
  const kept = parseRecording(jsonl);
  const finalCommand = fixture.findLastIndex((line) => line.dir === "tx");
  const keptFinalCommand = kept.findLastIndex((line) => line.dir === "tx");
  const expected = fixture.slice(finalCommand + 1).filter((line) => line.dir === "rx").map((line) => line.data);
  const actual = kept.slice(keptFinalCommand + 1).filter((line) => line.dir === "rx").map((line) => line.data);
  return finalCommand >= 0 && keptFinalCommand >= 0 && expected.length > 0 && JSON.stringify(actual) === JSON.stringify(expected);
}

describe("selected-car battery diagnosis action", () => {
  it("keeps a complete scan before saving, then renders the persisted detail", async () => {
    const { garage, first, history, historyStore } = await setup();
    const events: string[] = []; const kept: string[] = [];
    const label = "battery-scans/1/synthetic.jsonl";
    const result = await run(first, fixture, history, (id, _, jsonl) => { events.push("keep"); kept.push(jsonl); expect(id).toBe("1"); expect(historyStore.value).toBeUndefined(); return label; });
    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;
    events.push("saved");
    expect(events).toEqual(["keep", "saved"]);
    expect(result.report.scanStatus).toBe("complete");
    expect(result.report.recording).toBe(label);
    expect(kept[0]).toContain("22 27C6");
    const reopened = createBatteryReportHistory(historyStore, garage);
    const [persisted] = await reopened.list("1");
    expect(persisted).toEqual(result.report);
    const detail = renderBatteryDiagnosis(persisted);
    for (const phrase of ["SoC", "community", "Cell spread", "adapter", "Diagnostic codes", "capacity: NOT MEASURED", "battery health: not assessed", label]) expect(detail).toContain(phrase);
    write("/tmp/t2.6d-synthetic-report.md", `# Synthetic fixture — not a verified full car run\n\n${detail}`);
    write("/tmp/t2.6d-synthetic-save.json", `${JSON.stringify({ synthetic: true, garageId: "1", status: result.status, scanStatus: persisted.scanStatus, recording: label, signals: persisted.signals.map(({ id, tier }) => ({ id, tier })), keptBeforeSave: true })}\n`);
  });

  it("keeps same-model garage histories isolated across reload and ownership change", async () => {
    const { garageStore, garage, first, second, historyStore, history } = await setup();
    const paths = ["fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl", "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike-2.redacted.jsonl"];
    for (const [entry, path] of [[first, paths[0]], [second, paths[1]]] as const) {
      await history.save(await batteryDiagnosisFromRecording(read(new URL(path, root), "latin1"), { garageVehicleId: entry.id, catalogId: "chevrolet-equinox-ev-2024", scannedAt: at, recording: path, scanStatus: "complete" }, signals));
    }
    await garage.changeOwnership(first.id, "checked");
    const reopened = createBatteryReportHistory(historyStore, createGarageFlow(garageStore));
    const firstReports = await reopened.list(first.id); const secondReports = await reopened.list(second.id);
    expect(firstReports).toHaveLength(1); expect(secondReports).toHaveLength(1);
    expect(firstReports[0].recording).toBe(paths[0]); expect(secondReports[0].recording).toBe(paths[1]);
    expect(renderBatteryDiagnosis(firstReports[0])).not.toContain(paths[1]);
    expect(renderBatteryDiagnosis(secondReports[0])).not.toContain(paths[0]);
    await expect(removeGarageVehicleWithReports(garage, reopened, first.id)).rejects.toThrow("retained");
    expect((await garage.load()).vehicles[0].ownership).toBe("checked");
    write("/tmp/t2.6d-per-car-history.json", `${JSON.stringify({ ids: [first.id, second.id], counts: [firstReports.length, secondReports.length], recordings: [firstReports[0].recording, secondReports[0].recording], ownership: "checked", removal: "refused" })}\n`);
  });

  it("keeps scans without CB SOC and labels SOC-backed interrupted scans partial", async () => {
    const { first, history } = await setup();
    const labels: string[] = [];
    const keep = () => { const label = `battery-scans/1/synthetic-${String(labels.length + 1)}.jsonl`; labels.push(label); return label; };
    const missing = await run(first, noSoc(), history, keep);
    expect(missing.status).toBe("no-fingerprint");
    expect(await history.list(first.id)).toHaveLength(0);
    write("/tmp/t2.6d-synthetic-no-fingerprint.json", `${JSON.stringify({ synthetic: true, result: missing, count: 0 })}\n`);
    const before = await run(first, failureAt("0120"), history, keep);
    const after = await run(first, failureAt("22 2AF5"), history, keep);
    expect(before.status).toBe("no-fingerprint");
    expect(before.status === "no-fingerprint" && before.scanStatus).toBe("partial");
    expect(after.status).toBe("saved");
    expect(after.status === "saved" && after.report.scanStatus).toBe("partial");
    expect(await history.list(first.id)).toHaveLength(1);
    write("/tmp/t2.6d-synthetic-partial.json", `${JSON.stringify({ synthetic: true, before, after: after.status === "saved" ? { status: after.status, scanStatus: after.report.scanStatus, recording: after.recording } : after, count: 1 })}\n`);
  });

  it("surfaces private and history write errors without a saved diagnosis", async () => {
    const { first, history, historyStore } = await setup();
    const privateError = await run(first, fixture, history, () => { throw new Error("private disk full"); }).then(() => "missing", (error: unknown) => error instanceof Error ? error.message : String(error));
    expect(privateError).toContain("private disk full");
    expect(await history.list(first.id)).toHaveLength(0);
    historyStore.fail = true;
    const historyError = await run(first, fixture, history, () => "battery-scans/1/kept.jsonl").then(() => "missing", (error: unknown) => error instanceof Error ? error.message : String(error));
    expect(historyError).toContain("disk full");
    expect(await history.list(first.id)).toHaveLength(0);
    write("/tmp/t2.6d-storage-errors.json", `${JSON.stringify({ synthetic: true, privateError, historyError, count: 0 })}\n`);
  });

  it("refuses unsupported or unverified selected entries before scanning", async () => {
    const { first, history, historyStore } = await setup();
    const invalid = { ...first, catalogId: "chevrolet-equinox-ev-2025" };
    let commands = 0; let keeps = 0;
    const replay = new ReplayTransport(fixture);
    const transport: Transport = { startsIdle: true, write(bytes) { commands++; return replay.write(bytes); }, onData(callback) { return replay.onData(callback); }, close() { return replay.close(); } };
    await expect(runAndSaveBatteryDiagnosis({ entry: invalid, transport, recording: recording(), scannedAt: at, keepScan: () => { keeps++; return "should-not-save"; }, history, importedSignals: signals, getInterruption: () => undefined, onProgress: () => undefined })).rejects.toThrow("verified");
    expect(commands).toBe(0); expect(keeps).toBe(0); expect(historyStore.value).toBeUndefined();
    write("/tmp/t2.6d-unsupported-entry.json", `${JSON.stringify({ synthetic: true, rejected: true, commands, keeps, historyWrites: 0 })}\n`);
  });

  it("retains a final reply but no report when Cancel is accepted during BLE close", async () => {
    const { first, history } = await setup();
    const transport = new DeferredCloseReplay(fixture);
    const interruption: { current: "cancelled" | "disconnected" | undefined } = { current: undefined };
    const kept: string[] = []; const progress: string[] = [];
    const label = "battery-scans/1/cancelled-synthetic.jsonl";
    const action = runAndSaveBatteryDiagnosis({ entry: first, transport, recording: recording(), scannedAt: at,
      keepScan: (_, __, jsonl) => { kept.push(jsonl); return label; }, history, importedSignals: signals,
      getInterruption: () => interruption.current, onProgress: (message) => { progress.push(message); },
    });
    await transport.closeEntered;
    interruption.current = "cancelled";
    transport.release();
    const result = await action;
    const savedReportCount = (await history.list(first.id)).length;
    const lines = parseRecording(kept[0] ?? "");
    const finalCommand = fixture.findLastIndex((line) => line.dir === "tx");
    const keptFinalCommand = lines.findLastIndex((line) => line.dir === "tx");
    const expectedFinalResponse = fixture.slice(finalCommand + 1).filter((line) => line.dir === "rx").map((line) => line.data);
    const keptFinalResponse = lines.slice(keptFinalCommand + 1).filter((line) => line.dir === "rx").map((line) => line.data);
    const finalResponsePresent = finalCommand >= 0 && keptFinalCommand >= 0 && expectedFinalResponse.length > 0 && JSON.stringify(keptFinalResponse) === JSON.stringify(expectedFinalResponse);
    const interruptionMarkerPresent = lines.some((line) => line.dir === "meta" && typeof line.note === "string" && line.note.includes("cancelled"));
    expect(result.status).toBe("stopped");
    if (result.status !== "stopped") throw new Error("Cancel must stop the diagnosis");
    expect(result.cause).toBe("cancelled");
    expect(result.recording).toBe(label);
    expect(result.reason).toContain("no report saved");
    expect(kept).toHaveLength(1);
    expect(finalResponsePresent).toBe(true);
    expect(interruptionMarkerPresent).toBe(true);
    expect(savedReportCount).toBe(0);
    expect(progress).not.toContain("Building battery diagnosis");
    expect(progress).not.toContain("Saving report to this car");
    write("/tmp/t2.6d-synthetic-cancellation.json", `${JSON.stringify({ synthetic: true, cause: "cancelled", finalResponsePresent, privateLabel: label, interruptionMarkerPresent, savedReportCount })}\n`);
  });

  it("retains the final response and interruption when BLE close rejects after disconnect", async () => {
    const { first, history } = await setup();
    const transport = new RejectingCloseReplay(fixture);
    const buffer = recording();
    const interruption: { current: "disconnected" | undefined } = { current: undefined };
    const kept: string[] = []; const progress: string[] = [];
    const label = "battery-scans/1/disconnected-close-error-synthetic.jsonl";
    const action = runAndSaveBatteryDiagnosis({ entry: first, transport, recording: buffer, scannedAt: at,
      keepScan: (_, __, jsonl) => { kept.push(jsonl); return label; }, history, importedSignals: signals,
      getInterruption: () => interruption.current, onProgress: (message) => { progress.push(message); },
    });
    await transport.closeEntered;
    interruption.current = "disconnected";
    transport.release();
    const result = await action;
    const lines = parseRecording(kept[0] ?? "");
    const finalResponsePresent = hasFinalResponse(kept[0] ?? "");
    const closeFailureMarkerPresent = lines.some((line) => line.dir === "meta" && typeof line.note === "string" && line.note.includes("BLE close failed"));
    const interruptionMarkerPresent = lines.some((line) => line.dir === "meta" && typeof line.note === "string" && line.note.includes("disconnected"));
    const savedReportCount = (await history.list(first.id)).length;
    expect(result).toEqual({ status: "stopped", cause: "disconnected", recording: label, reason: "Battery diagnosis stopped after disconnect; no report saved." });
    expect(kept).toHaveLength(1);
    expect(finalResponsePresent).toBe(true);
    expect(closeFailureMarkerPresent).toBe(true);
    expect(interruptionMarkerPresent).toBe(true);
    expect(savedReportCount).toBe(0);
    expect(progress).not.toContain("Building battery diagnosis");
    expect(progress).not.toContain("Saving report to this car");
    write("/tmp/t2.6d-synthetic-disconnect-close-error.json", `${JSON.stringify({ synthetic: true, cause: "disconnected", closeRejected: true, finalResponsePresent, closeFailureMarkerPresent, interruptionMarkerPresent, privateLabel: label, keepCount: kept.length, savedReportCount })}\n`);
  });

  it("retains an unsignaled BLE close rejection and surfaces its private label", async () => {
    const { first, history } = await setup();
    const transport = new RejectingCloseReplay(fixture);
    const kept: string[] = []; const progress: string[] = [];
    const label = "battery-scans/1/unsignaled-close-error-synthetic.jsonl";
    const action = runAndSaveBatteryDiagnosis({ entry: first, transport, recording: recording(), scannedAt: at,
      keepScan: (_, __, jsonl) => { kept.push(jsonl); return label; }, history, importedSignals: signals,
      getInterruption: () => undefined, onProgress: (message) => { progress.push(message); },
    });
    await transport.closeEntered;
    transport.release();
    const error = await action.then(() => "missing failure", (reason: unknown) => reason instanceof Error ? reason.message : String(reason));
    const lines = parseRecording(kept[0] ?? "");
    const finalResponsePresent = hasFinalResponse(kept[0] ?? "");
    const closeFailureMarkerPresent = lines.some((line) => line.dir === "meta" && typeof line.note === "string" && line.note.includes("BLE close failed"));
    const savedReportCount = (await history.list(first.id)).length;
    expect(error).toContain("BLE close failed");
    expect(error).toContain(label);
    expect(error).not.toMatch(/cancelled|disconnected|complete/i);
    expect(kept).toHaveLength(1);
    expect(finalResponsePresent).toBe(true);
    expect(closeFailureMarkerPresent).toBe(true);
    expect(savedReportCount).toBe(0);
    expect(progress).not.toContain("Building battery diagnosis");
    expect(progress).not.toContain("Saving report to this car");
    write("/tmp/t2.6d-synthetic-unsignaled-close-error.json", `${JSON.stringify({ synthetic: true, privateLabel: label, error, finalResponsePresent, closeFailureMarkerPresent, keepCount: kept.length, savedReportCount })}\n`);
  });
});
