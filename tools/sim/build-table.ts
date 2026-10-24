import { readFileSync, writeFileSync } from "node:fs";
import { parseRecording } from "../../packages/obd-core/src/recording/format.js";
import { buildSimTable, isErrorReply, simKey, SimulatedTransport, type SimTable } from "../../packages/obd-core/src/transport/simulated.js";
import { CAPTURE_COMMANDS } from "../../apps/mobile/src/capture.js";
import { CODES_SCAN_COMMANDS } from "../../apps/mobile/src/codesScan.js";
import { runBatteryDiagnosisScan } from "../../apps/mobile/src/batteryScan.js";
import { runModuleDtcCapture } from "../../apps/mobile/src/moduleDtcCapture.js";
import { RecordingBuffer } from "../../apps/mobile/src/recording.js";

const DIR = "fixtures/recordings/chevrolet-equinox-ev-2024";
const SOURCES = ["2026-09-22-spike", "2026-09-22-spike-2", "2026-09-23-discovery-targeted", "2026-09-24-phone-console", "2026-09-24-phone-console-2", "2026-09-28-phone-console-2", "2026-09-30-test-drive", "2026-09-30-test-drive-2"].map((name) => `${DIR}/${name}.redacted.jsonl`);
const SYNTHETIC = "fixtures/synthetic/battery-diagnosis-wrong-model.jsonl";
const OUT = "apps/mobile/src/sim/equinox.table.json";
const MAX_PER_KEY = 64;
const MAX_BYTES = 1_000_000;

const load = (path: string) => ({ path, lines: parseRecording(readFileSync(path, "latin1")) });

const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "simulated" as const, note: "sim:coverage", writeChar: "simulated", notifyChar: "simulated", mtu: 0 };
const recording = () => { const buffer = new RecordingBuffer(); buffer.start(meta); return buffer; };
const stopped = (error: unknown) => `stopped: ${error instanceof Error ? error.message : String(error)}`;

async function coverage(table: SimTable): Promise<void> {
  console.log("SIMULATED: no car, no dongle; closes no OWNER-QUEUE item");
  const hasData = (key: string) => (table.replies[key] ?? []).some((reply) => !isErrorReply(reply, key.slice(key.indexOf("|") + 1)));
  const noDataOnly = (name: string, keys: readonly string[]) => {
    console.log(`${name} NO DATA-only: ${keys.filter((key) => table.replies[key] !== undefined && !hasData(key)).join(", ") || "none"}`);
  };
  const staticMisses = (name: string, commands: readonly string[]) => {
    const keys = commands.map((command) => simKey("", command));
    const missing = commands.filter((command) => table.replies[simKey("", command)] === undefined);
    console.log(`${name}: ${String(commands.length - missing.length)}/${String(commands.length)} keys recorded; missing: ${missing.length === 0 ? "none" : missing.join(", ")}`);
    noDataOnly(name, keys);
  };
  staticMisses("capture", CAPTURE_COMMANDS);
  staticMisses("codes scan", CODES_SCAN_COMMANDS);
  const battery = new SimulatedTransport(table);
  const scan = await runBatteryDiagnosisScan(battery, recording(), () => undefined, () => ({ status: "match" }) as never).then((run) => run.scanStatus, stopped);
  console.log(`battery scan: ${scan}; misses: ${battery.misses.join(", ") || "none"}`);
  noDataOnly("battery scan", battery.requested);
  const dtc = new SimulatedTransport(table);
  const modules = await runModuleDtcCapture(dtc, recording(), () => undefined).then((run) => run.status, stopped);
  console.log(`module DTC capture: ${modules}; misses: ${dtc.misses.join(", ") || "none"} (the first miss ends the run)`);
}

const table = buildSimTable(SOURCES.map(load), load(SYNTHETIC), MAX_PER_KEY);
if (process.argv.includes("--coverage")) await coverage(table);
else {
  const text = `${JSON.stringify(table)}\n`;
  if (text.length > MAX_BYTES) throw new Error(`table is ${String(text.length)} bytes, over ${String(MAX_BYTES)}`);
  writeFileSync(OUT, text);
  console.log(`SIMULATED table: ${String(Object.keys(table.replies).length)} keys, ${String(text.length)} bytes -> ${OUT}`);
}
