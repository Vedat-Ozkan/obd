// @ts-expect-error Node built-in types are not part of the mobile target.
import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseRecording, type RecordingLine } from "obd-core/recording";
import { ReplayTransport } from "obd-core/transport/replay";
import { Elm327Session } from "obd-core/elm/session";
import { decodeObdbMode22, equinoxEv2024Profile, importObdbMode22, scanMode22Profile, withEquinoxEv2024Evidence } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { codesReportFromRecording } from "obd-core/report";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis } from "../../../packages/obd-battery/src/report.js";
import { runBatteryDiagnosisScan, hasEquinoxSocFingerprint } from "../src/batteryScan.js";
import { RecordingBuffer } from "../src/recording.js";

const read = readFileSync as (path: URL, encoding: "utf8" | "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const file = (relative: string) => new URL(`../../../${relative}`, import.meta.url);
const fixture = "fixtures/synthetic/battery-diagnosis-full-scan.jsonl";
const spikeDir = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const signalset = importObdbMode22(signalsetJson);
const recordingLabel = "synthetic/battery-diagnosis-full-scan.jsonl";
const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "synthetic ready", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
const input = (status: "complete" | "partial") => ({ garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024" as const, scannedAt: "2026-09-24T00:00:00.000Z", recording: recordingLabel, scanStatus: status });
function fresh() { const recording = new RecordingBuffer(() => 1); recording.start(meta); return recording; }

function replyChangedAt(command: string, reply: string): RecordingLine[] {
  const lines = parseRecording(read(file(fixture), "latin1"));
  const at = lines.findIndex((line) => line.dir === "tx" && line.data === `${command}\r`);
  if (at < 0) throw new Error(`fixture lacks ${command}`);
  const end = lines.findIndex((line, index) => index > at && line.dir === "tx");
  return [...lines.slice(0, at + 1), { t: lines[at].t + 1, dir: "rx", data: `${reply}\r\r>` }, ...lines.slice(end < 0 ? lines.length : end)];
}

function retryRepliesAt(command: string, replies: readonly string[]): RecordingLine[] {
  const lines = parseRecording(read(file(fixture), "latin1"));
  const at = lines.findIndex((line) => line.dir === "tx" && line.data === `${command}\r`);
  if (at < 0) throw new Error(`fixture lacks ${command}`);
  const end = lines.findIndex((line, index) => index > at && line.dir === "tx");
  const original = lines.slice(at + 1, end < 0 ? lines.length : end);
  const first = { t: lines[at].t + 1, dir: "rx" as const, data: `${replies[0]}\r\r>` };
  const retryTx = { ...lines[at], t: lines[at].t + 2 };
  const retryRx = replies.length === 1 ? original : [{ t: lines[at].t + 3, dir: "rx" as const, data: `${replies[1]}\r\r>` }];
  return [...lines.slice(0, at + 1), first, retryTx, ...retryRx, ...lines.slice(end < 0 ? lines.length : end)];
}

for (const [name, replies, recovered, artifactPath] of [
  ["CAN ERROR recovered", ["CAN ERROR"], true, "/tmp/t2.6c-can-error-recovered.json"],
  ["CAN ERROR exhausted", ["CAN ERROR", "CAN ERROR"], false, "/tmp/t2.6c-can-error-exhausted.json"],
  ["DATA ERROR recovered", ["DATA ERROR"], true, "/tmp/t2.6c-data-error-recovered.json"],
  ["<DATA ERROR recovered", ["<DATA ERROR"], true, "/tmp/t2.6c-less-than-data-error-recovered.json"],
  ["DATA ERROR exhausted", ["DATA ERROR", "DATA ERROR"], false, "/tmp/t2.6c-data-error-exhausted.json"],
] as const) {
  it(`applies final init retry policy for ${name} at ATDPN`, async () => {
    const result = await runBatteryDiagnosisScan(new ReplayTransport(retryRepliesAt("ATDPN", replies)), fresh(), () => undefined);
    const lines = parseRecording(result.jsonl);
    const commands = lines.filter((line) => line.dir === "tx").map((line) => line.data.trim());
    const artifact = {
      synthetic: true,
      injectedCommand: "ATDPN",
      injectedReplies: replies,
      txSequence: commands,
      atdpnTxCount: commands.filter((command) => command === "ATDPN").length,
      scanStatus: result.scanStatus,
      finalReason: result.stopReason ?? null,
      sentNext: commands.includes("ATRV"),
      retainedReplies: lines.filter((line) => line.dir === "rx" && replies.some((reply) => line.data.includes(reply))).length,
    };
    write(artifactPath, `${JSON.stringify(artifact)}\n`);
    expect(artifact.atdpnTxCount).toBe(2);
    expect(artifact.scanStatus).toBe(recovered ? "complete" : "partial");
    expect(artifact.sentNext).toBe(recovered);
    expect(artifact.retainedReplies).toBe(replies.length);
    if (recovered) expect(result.stopReason).toBeUndefined();
    else expect(result.stopReason).toContain(replies.at(-1));
  });
}

for (const [command, reply, next, artifactName] of [
  ["0120", "LV RESET", "0140", "lv-reset"],
  ["22 2AF5", "UNABLE TO CONNECT", "22 2B43", "unable-to-connect"],
] as const) {
  it(`stops the fresh scan after ${reply} at ${command}`, async () => {
    const recording = fresh();
    const result = await runBatteryDiagnosisScan(new ReplayTransport(replyChangedAt(command, reply)), recording, () => undefined);
    const commands = parseRecording(result.jsonl).filter((line) => line.dir === "tx").map((line) => line.data.trim());
    const artifact = { synthetic: true, injectedAt: command, reply, scanStatus: result.scanStatus, stopReason: result.stopReason, lastCommand: commands.at(-1), sentNext: commands.includes(next) };
    write(`/tmp/t2.6b-synthetic-${artifactName}.json`, `${JSON.stringify(artifact)}\n`);
    expect(result.scanStatus).toBe("partial");
    expect(result.stopReason).toContain(reply);
    expect(commands.at(-1)).toBe(command);
    expect(commands).not.toContain(next);
  });
}

for (const [command, next] of [
  ["ATI", "ATE0"],
  ["ATDPN", "ATRV"],
  ["ATRV", "0100"],
] as const) {
  it(`keeps the partial recording and stops after LV RESET during init at ${command}`, async () => {
    const recording = fresh();
    const result = await runBatteryDiagnosisScan(new ReplayTransport(replyChangedAt(command, "LV RESET")), recording, () => undefined);
    const lines = parseRecording(result.jsonl);
    const commands = lines.filter((line) => line.dir === "tx").map((line) => line.data.trim());
    const artifact = {
      synthetic: true,
      injectedAt: command,
      scanStatus: result.scanStatus,
      stopReason: result.stopReason,
      lastCommand: commands.at(-1),
      sentNext: commands.includes(next),
      retainedReply: lines.some((line) => line.dir === "rx" && line.data.includes("LV RESET")),
    };
    write(`/tmp/t2.6b-synthetic-init-lv-reset-${command.toLowerCase()}.json`, `${JSON.stringify(artifact)}\n`);
    expect(artifact).toMatchObject({ scanStatus: "partial", lastCommand: command, sentNext: false, retainedReply: true });
    expect(result.stopReason).toContain("LV RESET");
  });
}

it("replays the labeled synthetic combined scan and renders a deterministic diagnosis", async () => {
  const source = parseRecording(read(file(fixture), "latin1"));
  const recording = fresh();
  const result = await runBatteryDiagnosisScan(new ReplayTransport(source), recording, () => undefined);
  expect(result.scanStatus).toBe("complete");
  const actual = parseRecording(result.jsonl);
  expect(actual.filter((line) => line.dir === "tx").map((line) => line.data)).toEqual(source.filter((line) => line.dir === "tx").map((line) => line.data));
  expect(actual.filter((line) => line.dir === "rx").map((line) => line.data)).toEqual(source.filter((line) => line.dir === "rx").map((line) => line.data));
  const codes = await codesReportFromRecording(actual);
  const report = await batteryDiagnosisFromRecording(result.jsonl, input(result.scanStatus), signalset);
  expect(report.codes).toEqual(codes);
  expect(hasEquinoxSocFingerprint(report), JSON.stringify(report.signals)).toBe(true);
  expect(report.capacity.status).toBe("not-measured");
  const artifact = `# Synthetic fixture — not a verified full car run\n\n${renderBatteryDiagnosis(report)}`;
  write("/tmp/t2.6b-synthetic-diagnosis.md", artifact);
  expect(artifact).toContain("capacity: NOT MEASURED");
});

it("refuses a selected-car report when the CB SOC fingerprint is missing", async () => {
  const source = parseRecording(read(file(fixture), "latin1"));
  let removing = false;
  const missing: RecordingLine[] = source.flatMap((line) => {
    if (line.dir === "tx") removing = line.data === "22 27C6\r" || line.data === "22 2B43\r";
    if (removing && line.dir === "rx") return line.data.includes(">") ? [{ ...line, data: "NO DATA\r\r>" }] : [];
    return [line];
  });
  const recording = fresh();
  const result = await runBatteryDiagnosisScan(new ReplayTransport(missing), recording, () => undefined);
  const report = await batteryDiagnosisFromRecording(result.jsonl, input(result.scanStatus), signalset);
  expect(hasEquinoxSocFingerprint(report)).toBe(false);
  write("/tmp/t2.6b-synthetic-mismatch.json", `${JSON.stringify({ synthetic: true, scanStatus: result.scanStatus, canSave: hasEquinoxSocFingerprint(report) })}\n`);
});

it("keeps a partial recording on a disconnected replay", async () => {
  const source = parseRecording(read(file(fixture), "latin1"));
  const cut = source.findIndex((line) => line.dir === "tx" && line.data === "0120\r");
  const recording = fresh();
  const result = await runBatteryDiagnosisScan(new ReplayTransport(source.slice(0, cut)), recording, () => undefined);
  expect(result.scanStatus).toBe("partial");
  expect(parseRecording(result.jsonl).some((line) => line.dir === "tx")).toBe(true);
  expect(result.stopReason).toBeDefined();
  write("/tmp/t2.6b-synthetic-partial.json", `${JSON.stringify({ synthetic: true, scanStatus: result.scanStatus, stopReason: result.stopReason })}\n`);
});

for (const name of ["2026-09-22-spike.redacted.jsonl", "2026-09-22-spike-2.redacted.jsonl"]) {
  it(`replays contiguous real Mode 22 tail from ${name}`, async () => {
    const lines = parseRecording(read(file(spikeDir + name), "latin1"));
    const start = lines.findIndex((line) => line.dir === "tx" && line.data === "ATSP7\r");
    expect(start).toBeGreaterThan(0);
    const replay = new ReplayTransport(lines.slice(start));
    const session = new Elm327Session(replay);
    const outcomes = await scanMode22Profile(session, equinoxEv2024Profile);
    expect(outcomes.filter((outcome) => outcome.target === "CB" && (outcome.did === "27C6" || outcome.did === "2B43") && outcome.response.kind === "data")).toHaveLength(2);
    const decoded = outcomes.flatMap(({ did, response }) => response.frames.flatMap((frame) => decodeObdbMode22(did, frame, withEquinoxEv2024Evidence(signalset))));
    expect(decoded.filter((signal) => signal.ok && signal.ecu === "CB" && signal.id.includes("SOC"))).toHaveLength(2);
    write(`/tmp/t2.6b-${name.replace(".redacted.jsonl", "")}-tail.json`, `${JSON.stringify({ recording: spikeDir + name, outcomes: outcomes.map(({ target, did, response }) => ({ target, did, kind: response.kind })), soc: decoded.filter((signal) => signal.ok && signal.ecu === "CB" && signal.id.includes("SOC")) })}\n`);
    await session.close();
  });
}
