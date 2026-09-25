import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Elm327Session, ElmSessionError } from "../../obd-core/src/elm/session.js";
import { decodePid } from "../../obd-core/src/obd/j1979.js";
import { parseRecording, type RecordingLine } from "../../obd-core/src/recording/format.js";
import { ReplayTransport } from "../../obd-core/src/transport/replay.js";
import { buildTwelveVoltReport, renderTwelveVoltReport, type TwelveVoltObservation, type TwelveVoltReport, type VehiclePowerState } from "../src/twelve-volt.js";

export async function reportFromRecording(lines: readonly RecordingLine[], recording: string): Promise<TwelveVoltReport> {
  const powerState: VehiclePowerState = lines.some((line) => line.dir === "meta" && typeof line.note === "string" && /(?:^|[, ]+)ready(?:[, ]+|$)/i.test(line.note)) ? "ready" : "unknown";
  const session = new Elm327Session(new ReplayTransport(lines));
  const observations: TwelveVoltObservation[] = [];
  try {
    for (const line of lines) {
      if (line.dir !== "tx") continue;
      const command = line.data.endsWith("\r") ? line.data.slice(0, -1) : line.data;
      try {
        const response = await session.send(command, { retry: false, timeoutMs: 500 });
        if (command === "ATRV" && response.kind === "data") {
          for (const content of response.lines) {
            const match = /^(\d+(?:\.\d+)?)V$/.exec(content.trim());
            if (match) observations.push({ source: "adapter-supply", command: "ATRV", volts: Number(match[1]), powerState, recording });
          }
        }
        if (command === "0142") {
          for (const frame of response.frames) {
            const decoded = decodePid(0x42, frame);
            if (decoded.ok) observations.push({ source: "module-supply", command: "0142", volts: decoded.value, ecu: decoded.ecu, powerState, recording });
          }
        }
      } catch (error) {
        if (!(error instanceof ElmSessionError && error.kind === "timeout")) throw error;
      }
    }
  } finally {
    await session.close();
  }
  return buildTwelveVoltReport(observations);
}

export async function renderRecordings(paths: readonly string[]): Promise<string> {
  const blocks: string[] = [];
  for (const path of paths) {
    if (!path.endsWith(".redacted.jsonl") && !path.startsWith("fixtures/synthetic/")) {
      throw new Error(`expected a redacted or explicitly synthetic JSONL path: ${path}`);
    }
    const report = await reportFromRecording(parseRecording(readFileSync(resolve(path), "latin1")), path);
    blocks.push(`## ${path}\n\n${renderTwelveVoltReport(report)}`);
  }
  return blocks.join("\n\n") + "\n";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) {
    process.stderr.write("usage: twelve-volt-report <*.redacted.jsonl|fixtures/synthetic/*.jsonl>...\n");
    process.exitCode = 1;
  } else {
    renderRecordings(process.argv.slice(2)).then((output) => process.stdout.write(output)).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
