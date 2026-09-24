import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Elm327Session } from "../src/elm/session.js";
import { latin1Decode, parseRecording, type RecordingLine } from "../src/recording/format.js";
import { ReplayTransport } from "../src/transport/replay.js";
import type { Transport } from "../src/transport/types.js";
import { equinoxEv2024Profile } from "../src/vehicles/profile.js";
import { scanMode22Profile } from "../src/vehicles/scan.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const recordingRoot = resolve(repoRoot, "fixtures/recordings/chevrolet-equinox-ev-2024");

function recordingPath(input: string | undefined): string {
  if (input === undefined) throw new Error("usage: profile-scan-replay <Equinox *.redacted.jsonl>");
  const path = resolve(input);
  const within = relative(recordingRoot, path);
  if (within.startsWith("..") || isAbsolute(within) || !/^[^/]+\.redacted\.jsonl$/.test(within)) {
    throw new Error("expected a committed Equinox redacted recording");
  }
  return path;
}

function tail(lines: RecordingLine[]): RecordingLine[] {
  const start = lines.findIndex((line) => line.dir === "tx" && line.data === "ATSP7\r");
  if (start < 0) throw new Error("recording has no ATSP7 profile tail");
  return lines.slice(start);
}

async function main(): Promise<void> {
  const lines = tail(parseRecording(readFileSync(recordingPath(process.argv[2]), "latin1")));
  const recordedCommands = lines.filter((line) => line.dir === "tx").map((line) => line.data.slice(0, -1));
  const replay = new ReplayTransport(lines);
  const writes: string[] = [];
  const transport: Transport = {
    write(bytes) { writes.push(latin1Decode(bytes).slice(0, -1)); return replay.write(bytes); },
    onData: (cb) => replay.onData(cb),
    close: () => replay.close(),
    startsIdle: true, // forwards a ReplayTransport; the tail starts at ATSP7
  };
  const session = new Elm327Session(transport);
  try {
    const outcomes = await scanMode22Profile(session, equinoxEv2024Profile);
    if (writes.length !== recordedCommands.length || writes.some((cmd, i) => cmd !== recordedCommands[i])) {
      throw new Error("profile scan did not consume the complete recorded command tail");
    }
    for (const cmd of writes) {
      if (cmd.startsWith("AT")) console.log(`${cmd} status=ok`);
    }
    for (const { target, did, response } of outcomes) {
      const frame = response.frames.at(0);
      const detail = frame === undefined ? "" : ` ecu=${frame.header} length=${String(frame.data.length)}`;
      console.log(`22 ${did} target=${target} status=${response.kind}${detail}`);
    }
    const data = outcomes.filter((outcome) => outcome.response.kind === "data").length;
    const nodata = outcomes.filter((outcome) => outcome.response.kind === "nodata").length;
    const errors = outcomes.filter((outcome) => outcome.response.kind === "error").length;
    const dropped = outcomes.reduce((count, outcome) => count + outcome.response.dropped.length, 0);
    console.log(`summary outcomes=${String(outcomes.length)} data=${String(data)} nodata=${String(nodata)} error=${String(errors)} dropped=${String(dropped)}`);
  } finally {
    await session.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "profile scan failed");
  process.exitCode = 1;
});
