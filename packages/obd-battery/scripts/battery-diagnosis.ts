import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importObdbMode22 } from "obd-core/vehicles";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis } from "../src/report.js";

async function main(args: string[]): Promise<void> {
  if (args.length !== 5 || args[1] !== "--garage-id" || args[3] !== "--scanned-at" || !/^fixtures\/recordings\/chevrolet-equinox-ev-2024\/[^/]+\.redacted\.jsonl$/.test(args[0])) throw new Error("usage: battery-diagnosis <committed Equinox *.redacted.jsonl> --garage-id <id> --scanned-at <ISO timestamp>");
  const [path, , garageVehicleId, , scannedAt] = args;
  const source = resolve(path);
  const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  if (!source.startsWith(`${root}/fixtures/recordings/chevrolet-equinox-ev-2024/`)) throw new Error("recording must be in the Equinox fixture directory");
  try { execFileSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd: root, stdio: "ignore" }); }
  catch { throw new Error("recording must be a committed redacted fixture"); }
  const imported = importObdbMode22(JSON.parse(readFileSync(resolve(root, "packages/obd-core/vehicles/chevrolet-equinox-ev/default.json"), "utf8")));
  const report = await batteryDiagnosisFromRecording(readFileSync(source, "latin1"), { garageVehicleId, catalogId: "chevrolet-equinox-ev-2024", scannedAt, recording: path, scanStatus: "complete" }, imported);
  process.stdout.write(renderBatteryDiagnosis(report));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
