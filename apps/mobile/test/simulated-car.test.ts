// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { latin1Decode } from "obd-core/recording";
import type { Transport } from "obd-core/transport";
import { SimulatedTransport, type SimTable } from "obd-core/transport/simulated";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { renderBatteryDiagnosis } from "../../../packages/obd-battery/src/report.js";
import { runAndSaveBatteryDiagnosis } from "../src/batteryDiagnosisFlow.js";
import { createBatteryReportHistory } from "../src/batteryReports.js";
import { CAPTURE_COMMANDS, runCapture } from "../src/capture.js";
import { CODES_SCAN_COMMANDS, codesScanStop } from "../src/codesScan.js";
import { ConsoleSession } from "../src/console.js";
import { createGarageFlow } from "../src/garage/flow.js";
import { runModuleDtcCapture } from "../src/moduleDtcCapture.js";
import { RecordingBuffer } from "../src/recording.js";

const read = readFileSync as (path: URL, encoding: "utf8") => string;
const write = writeFileSync as (path: string, text: string) => void;
const table = JSON.parse(read(new URL("../src/sim/equinox.table.json", import.meta.url), "utf8")) as SimTable;
const signals = importObdbMode22(signalsetJson);
const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "simulated" as const, note: "SIMULATED", writeChar: "simulated", notifyChar: "simulated", mtu: 0 };
const HEADER = "SIMULATED: no car, no dongle; closes no OWNER-QUEUE item";

class Store {
  value?: string;
  read() { return Promise.resolve(this.value); }
  write(value: string) { this.value = value; return Promise.resolve(); }
}

async function diagnose(scenario: "equinox" | "wrong-model") {
  const garage = createGarageFlow(new Store());
  const entry = (await garage.add("chevrolet-equinox-ev-2024", "mine")).vehicles[0];
  const history = createBatteryReportHistory(new Store(), garage);
  const sim = new SimulatedTransport(table, scenario);
  const sent: string[] = [];
  const spy: Transport = { startsIdle: sim.startsIdle, write: (bytes) => { sent.push(latin1Decode(bytes).trim()); return sim.write(bytes); }, onData: (cb) => sim.onData(cb), close: () => sim.close() };
  const recording = new RecordingBuffer(); recording.start(meta);
  const stem = "battery-scans/1/simulated-2026-10-24.jsonl";
  const result = await runAndSaveBatteryDiagnosis({ entry, transport: spy, recording, scannedAt: "2026-10-24T00:00:00.000Z", keepScan: () => stem, history, importedSignals: signals, getInterruption: () => undefined, onProgress: () => undefined });
  return { result, sent, history, entry, sim };
}

describe("simulated car through the app entry points", () => {
  it("equinox: the battery scan saves a report read from the recorded CB module", async () => {
    const { result, history, entry, sim } = await diagnose("equinox");
    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;
    expect(sim.misses).toEqual([]);
    expect(result.report.recording).toContain("simulated-");
    expect(new Set(result.report.signals.map((signal) => signal.source.ecu))).toContain("CB");
    expect(await history.list(entry.id)).toHaveLength(1);
    write("/tmp/sim-battery-report.md", `# ${HEADER}\n\n${renderBatteryDiagnosis(result.report)}`);
  });

  it("wrong-model: the mismatch ends the scan, saves nothing, sends no battery Mode 22 command", async () => {
    const { result, sent, history, entry } = await diagnose("wrong-model");
    expect(result.status).toBe("model-not-confirmed");
    expect(await history.list(entry.id)).toHaveLength(0);
    expect(sent).toContain("0902");
    expect(sent.filter((command) => command.startsWith("22"))).toEqual([]);
  });

  it("capture and codes scan are fully recorded; the module DTC capture misses 19 02 FF loudly", async () => {
    const capture = new SimulatedTransport(table);
    const buffer = new RecordingBuffer(); buffer.start(meta);
    const result = await runCapture(new ConsoleSession(capture, buffer), buffer, () => undefined);
    expect(result).toEqual({ sent: CAPTURE_COMMANDS.length, total: CAPTURE_COMMANDS.length });
    expect(capture.misses).toEqual([]);
    const codes = new SimulatedTransport(table);
    const codesBuffer = new RecordingBuffer(); codesBuffer.start(meta);
    const codesResult = await runCapture(new ConsoleSession(codes, codesBuffer), codesBuffer, () => undefined, { commands: CODES_SCAN_COMMANDS, stopAfter: codesScanStop });
    expect(codesResult.sent).toBe(CODES_SCAN_COMMANDS.length);
    expect(codes.misses).toEqual([]);
    const dtc = new SimulatedTransport(table);
    const dtcBuffer = new RecordingBuffer(); dtcBuffer.start(meta);
    await runModuleDtcCapture(dtc, dtcBuffer, () => undefined).catch(() => undefined);
    expect(dtc.misses).toEqual(["DA17F1|19 02 FF"]);
  });
});
