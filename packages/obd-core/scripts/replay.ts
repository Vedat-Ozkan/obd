// `pnpm replay <recording.jsonl>`: Node-only CLI, kept outside src/ so obd-core/src stays pure.
// Output format: docs/specs/T0.4-elm327-session.md "packages/obd-core/scripts/replay.ts".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ElmSessionError, Elm327Session, type ElmResponse } from "../src/elm/session.js";
import { parseRecording, type RecordingLine } from "../src/recording/format.js";
import { ReplayTransport } from "../src/transport/replay.js";

const hex = (bytes: Iterable<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");

function count(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

const listCounts = (map: Map<string, number>) => [...map].map(([k, n]) => `${k}=${String(n)}`).join(", ");

// ADR-014/ADR-017: the VIN stays on the device. Commands whose replies carry it, mapped to the number of
// leading bytes kept (service + PID/DID echo): 0902 -> 49 02; 22 4193 -> 62 41 93 (spec amendment 2026-09-23).
const VIN_REPLIES: Readonly<Record<string, number>> = { "0902": 2, "224193": 3 };
const vinKeep = (cmd: string) => VIN_REPLIES[cmd.replace(/ /g, "").toUpperCase()] as number | undefined;

/** afterVin: the previous command was a VIN command, so leftover VIN frames can land in this response's drops. */
function formatBlock(lineNo: number, cmd: string, r: ElmResponse, afterVin: boolean): string[] {
  const keep = vinKeep(cmd);
  const vin = keep !== undefined;
  let head = `L${String(lineNo)} ${cmd} -> ${r.kind}`;
  if (r.kind === "error") head += ` ${r.error.kind}`;
  if (r.searching) head += " searching";
  if (r.attempts === 2) head += " attempts=2";
  const out = [head];
  for (const f of r.frames) {
    if (keep !== undefined) {
      out.push(`  ${f.header} ${hex(f.data.slice(0, keep))} <${String(Math.max(f.data.length - keep, 0))} bytes redacted>`);
      continue;
    }
    const neg = f.negative ? ` negative service=${hex([f.negative.service])} code=${hex([f.negative.code])}` : "";
    out.push(`  ${f.header} ${hex(f.data)}${neg}`);
  }
  for (const d of r.dropped) out.push(`  dropped ${d.reason} ${vin || afterVin ? `${d.header} <redacted>` : d.line}`);
  for (const t of r.lines) out.push(`  text ${vin ? "<redacted>" : t}`);
  return out;
}

/** Runs every tx of a recording through Elm327Session.send (retry: false, timeoutMs: 500) and formats the result. */
export async function replayRecording(lines: readonly RecordingLine[]): Promise<string[]> {
  const session = new Elm327Session(new ReplayTransport(lines));
  const out: string[] = [];
  const kinds = new Map<string, number>();
  const errors = new Map<string, number>();
  const dropped = new Map<string, number>();
  let commands = 0;
  let frames = 0;
  let afterVin = false;
  for (const [i, line] of lines.entries()) {
    if (line.dir !== "tx") continue;
    commands++;
    const cmd = line.data.endsWith("\r") ? line.data.slice(0, -1) : line.data;
    const redactDropped = afterVin;
    afterVin = vinKeep(cmd) !== undefined;
    let r: ElmResponse;
    try {
      r = await session.send(cmd, { retry: false, timeoutMs: 500 });
    } catch (e) {
      if (!(e instanceof ElmSessionError && e.kind === "timeout")) throw e;
      out.push(`L${String(i + 1)} ${cmd} -> timeout`);
      count(kinds, "timeout");
      continue;
    }
    out.push(...formatBlock(i + 1, cmd, r, redactDropped));
    count(kinds, r.kind);
    if (r.kind === "error") count(errors, r.error.kind);
    frames += r.frames.length;
    for (const d of r.dropped) count(dropped, d.reason);
  }
  await session.close();
  const n = (k: string) => String(kinds.get(k) ?? 0);
  const errorDetail = errors.size > 0 ? ` (${listCounts(errors)})` : "";
  out.push(
    `summary: ${String(commands)} commands; data ${n("data")}, ok ${n("ok")}, nodata ${n("nodata")}, ` +
      `error ${n("error")}${errorDetail}, timeout ${n("timeout")}; frames ${String(frames)}; ` +
      `dropped ${dropped.size > 0 ? listCounts(dropped) : "none"}`,
  );
  return out;
}

async function main(): Promise<number> {
  const path = process.argv.at(2);
  if (path === undefined) {
    process.stderr.write("usage: pnpm replay <recording.jsonl>\n");
    return 2;
  }
  try {
    const output = await replayRecording(parseRecording(readFileSync(path, "latin1")));
    process.stdout.write(output.join("\n") + "\n");
    return 0;
  } catch (e) {
    // Parse errors and ReplayMismatchError both land here.
    if (e instanceof Error) {
      process.stderr.write(`${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

const entry = process.argv.at(1);
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = await main();
}
