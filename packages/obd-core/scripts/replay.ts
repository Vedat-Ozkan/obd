// `pnpm replay <recording.jsonl>`: Node-only CLI, kept outside src/ so obd-core/src stays pure.
// Output format: docs/specs/T0.4-elm327-session.md "packages/obd-core/scripts/replay.ts"; `decoded` lines:
// docs/specs/T0.5-standard-decoding.md "scripts/replay.ts".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Frame } from "../src/elm/isotp.js";
import { ElmSessionError, Elm327Session, type ElmResponse } from "../src/elm/session.js";
import { decodeDtcList, type DtcMode } from "../src/obd/dtc.js";
import { decodeFreezeDtc, decodeFreezePid, decodeFreezeSupported } from "../src/obd/freeze.js";
import { decodePid, MODE01_PIDS, type PidReading } from "../src/obd/j1979.js";
import { decodeReadiness } from "../src/obd/readiness.js";
import type { DecodeFailure } from "../src/obd/response.js";
import { BITMAP_PIDS, decodeSupported } from "../src/obd/supported.js";
import { decodeCalIds, decodeEcuName, decodeVin } from "../src/obd/vin.js";
import { parseRecording, type RecordingLine } from "../src/recording/format.js";
import { ReplayTransport } from "../src/transport/replay.js";
import { decodeObdbMode22 } from "../src/vehicles/obdb/decode.js";
import { withEquinoxEv2024Evidence } from "../src/vehicles/obdb/equinox.js";
import { importObdbMode22, type ObdbMode22Signal } from "../src/vehicles/obdb/import.js";

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
function formatBlock(lineNo: number, cmd: string, r: ElmResponse, afterVin: boolean, signals: readonly ObdbMode22Signal[]): string[] {
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
  for (const f of r.frames) {
    const text = decodeText(cmd, f);
    if (text !== undefined) out.push(`  decoded ${f.ecu} ${text}`);
    const did = /^22([0-9A-F]{4})$/.exec(cmd.replace(/ /g, "").toUpperCase())?.[1];
    if (did !== undefined) {
      for (const reading of decodeObdbMode22(did, f, signals)) {
        if (reading.ok) out.push(`  decoded ${reading.ecu} ${reading.id} ${String(Number(reading.value.toFixed(4)))} ${reading.unit} tier=${reading.tier} ecu=${reading.ecu}`);
      }
    }
  }
  return out;
}

const hexList = (pids: readonly number[], none: string) => (pids.length > 0 ? hex(pids) : none);

function failureText(f: DecodeFailure): string {
  return f.reason === "negative" ? `negative code=${hex([f.code ?? 0])}` : `invalid ${f.reason}`;
}

function readingText(r: PidReading): string {
  if (r.unit === "enum") return `${r.id} ${String(r.value)}${r.label === undefined ? "" : ` (${r.label})`}`;
  return `${r.id} ${String(Math.round(r.value * 1000) / 1000)} ${r.unit}`;
}

/** Mode 02 `02 <pid> <frame#>`: bitmap, PID 02 DTC, or a MODE01_PIDS value, each prefixed `freeze <frame#>`. */
function freezeText(pid: number, frameNo: number, frame: Frame): string | undefined {
  const head = `freeze ${String(frameNo)}`;
  if (BITMAP_PIDS.includes(pid)) {
    const r = decodeFreezeSupported(pid, frameNo, frame);
    return r.ok ? `${head} supported ${hexList(r.pids, "none")}` : failureText(r);
  }
  if (pid === 0x02) {
    const r = decodeFreezeDtc(frameNo, frame);
    return r.ok ? `${head} dtc ${r.dtc ?? "none"}` : failureText(r);
  }
  if (MODE01_PIDS.some((d) => d.pid === pid)) {
    const r = decodeFreezePid(pid, frameNo, frame);
    return r.ok ? `${head} ${readingText(r)}` : failureText(r);
  }
  return undefined;
}

/** The `decoded` text for one frame, or undefined when the command has no decoder (T0.5 spec, replay table).
 *  VIN: status only, never a character (ADR-014, ADR-017). */
function decodeText(cmd: string, frame: Frame): string | undefined {
  const c = cmd.replace(/ /g, "").toUpperCase();
  const m01 = /^01([0-9A-F]{2})$/.exec(c);
  const pid = m01 ? parseInt(m01[1], 16) : undefined;
  if (pid !== undefined && BITMAP_PIDS.includes(pid)) {
    const r = decodeSupported(pid, frame);
    return r.ok ? `supported ${hexList(r.pids, "none")}` : failureText(r);
  }
  if (pid === 0x01 || pid === 0x41) {
    const r = decodeReadiness(pid, frame);
    if (!r.ok) return failureText(r);
    const head = r.mil === undefined ? "" : ` mil=${r.mil ? "on" : "off"} dtcs=${String(r.dtcCount)}`;
    const monitors = r.monitors.map((m) => ` ${m.id}=${m.complete ? "complete" : "incomplete"}`).join("");
    return `readiness pid=${hex([pid])}${head} ignition=${r.ignition}${monitors}`;
  }
  if (pid !== undefined && MODE01_PIDS.some((d) => d.pid === pid)) {
    const r = decodePid(pid, frame);
    return r.ok ? readingText(r) : failureText(r);
  }
  const m02 = /^02([0-9A-F]{2})([0-9A-F]{2})$/.exec(c);
  if (m02) return freezeText(parseInt(m02[1], 16), parseInt(m02[2], 16), frame);
  if (c === "03" || c === "07" || c === "0A") {
    const r = decodeDtcList(parseInt(c, 16) as DtcMode, frame);
    return r.ok ? `dtcs ${r.dtcs.length > 0 ? r.dtcs.join(" ") : "none"}` : failureText(r);
  }
  if (c === "0902") {
    const r = decodeVin(frame);
    return r.ok ? `vin status=${r.status}` : `vin ${failureText(r)}`;
  }
  if (c === "0904") {
    const r = decodeCalIds(frame);
    return r.ok ? `cal-ids ${r.calIds.length > 0 ? r.calIds.join(" ") : "none"}` : failureText(r);
  }
  if (c === "090A") {
    const r = decodeEcuName(frame);
    return r.ok ? `ecu-name ${r.name}` : failureText(r);
  }
  return undefined;
}

/** Runs every tx of a recording through Elm327Session.send (retry: false, timeoutMs: 500) and formats the result. */
export async function replayRecording(lines: readonly RecordingLine[], options: { signals?: readonly ObdbMode22Signal[] } = {}): Promise<string[]> {
  const session = new Elm327Session(new ReplayTransport(lines));
  const signals = lines.some((line) => line.dir === "meta" && line.car === "chevrolet-equinox-ev-2024")
    ? withEquinoxEv2024Evidence(options.signals ?? [])
    : options.signals ?? [];
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
    out.push(...formatBlock(i + 1, cmd, r, redactDropped, signals));
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
    const lines = parseRecording(readFileSync(path, "latin1"));
    const signals = lines.some((line) => line.dir === "meta" && line.car === "chevrolet-equinox-ev-2024")
      ? importObdbMode22(JSON.parse(readFileSync(new URL("../vehicles/chevrolet-equinox-ev/default.json", import.meta.url), "utf8")) as unknown)
      : undefined;
    const output = await replayRecording(lines, { signals });
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
