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
import { createBatteryReportHistory } from "../src/batteryReports.js";
import { SUPPORTED_VEHICLES, checkVehicleIdentity } from "../src/garage/catalog.js";
import { createGarageFlow } from "../src/garage/flow.js";
import { CHARGE_LOG_PROFILE } from "obd-battery/session";

const read = readFileSync as (path: URL, encoding: "utf8" | "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const file = (relative: string) => new URL(`../../../${relative}`, import.meta.url);
const fixture = "fixtures/synthetic/battery-diagnosis-full-scan.jsonl";
const spikeDir = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const signalset = importObdbMode22(signalsetJson);
const recordingLabel = "synthetic/battery-diagnosis-full-scan.jsonl";
const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "synthetic ready", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };
const input = (status: "complete" | "partial") => ({ garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024" as const, scannedAt: "2026-09-24T00:00:00.000Z", recording: recordingLabel, scanStatus: status });
const equinox = SUPPORTED_VEHICLES.find((vehicle) => vehicle.id === "chevrolet-equinox-ev-2024");
if (!equinox) throw new Error("catalog lacks the verified Equinox entry");
const confirmEquinox = (vins: string[]) => checkVehicleIdentity(equinox, vins);
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
    const result = await runBatteryDiagnosisScan(new ReplayTransport(retryRepliesAt("ATDPN", replies)), fresh(), () => undefined, confirmEquinox);
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
    const result = await runBatteryDiagnosisScan(new ReplayTransport(replyChangedAt(command, reply)), recording, () => undefined, confirmEquinox);
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
    const result = await runBatteryDiagnosisScan(new ReplayTransport(replyChangedAt(command, "LV RESET")), recording, () => undefined, confirmEquinox);
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
  const result = await runBatteryDiagnosisScan(new ReplayTransport(source), recording, () => undefined, confirmEquinox);
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

it("records three parked cycles and saves the synthetic parked observations", async () => {
  const source = parseRecording(read(file(fixture), "latin1"));
  let clock = 0;
  const recording = new RecordingBuffer(() => clock++);
  recording.start(meta);
  const result = await runBatteryDiagnosisScan(new ReplayTransport(source), recording, () => undefined, confirmEquinox);
  const lines = parseRecording(result.jsonl);
  const marker = lines.findIndex((line) => line.dir === "meta" && line.note === "parked scan start");
  const tail = lines.slice(marker + 1).filter((line) => line.dir === "tx").map((line) => line.data.trim());
  const cycle = ["ATSP7", "ATCP 18", "ATSH DA17F1", "ATCRA 18DAF117", "ATFCSH 18DA17F1", "ATFCSD 300000", "ATFCSM 1", ...(CHARGE_LOG_PROFILE.mode22?.[0]?.dids ?? []).map((did) => `22 ${did}`), "ATSH DACBF1", "ATCRA 18DAF1CB", "ATFCSH 18DACBF1", ...(CHARGE_LOG_PROFILE.mode22?.[1]?.dids ?? []).map((did) => `22 ${did}`)];
  const report = await batteryDiagnosisFromRecording(result.jsonl, input(result.scanStatus), signalset);
  const artifact = { synthetic: true, scanStatus: result.scanStatus, cycles: 3, parked: report.parked, capacity: report.capacity.status, health: report.health.status };
  write("/tmp/t2.14-synthetic-scan.json", `${JSON.stringify(artifact, null, 2)}\n`);
  write("/tmp/t2.14-synthetic-parked-report.md", `# Synthetic fixture — no car run\n\n${renderBatteryDiagnosis(report)}`);
  expect(result.scanStatus).toBe("complete");
  expect(marker).toBeGreaterThan(0);
  expect(lines.filter((line) => line.dir === "meta" && line.note === "parked scan start")).toHaveLength(1);
  expect(tail).toEqual([...cycle, ...cycle, ...cycle]);
  expect(report.parked?.groupVoltages?.volts).toHaveLength(80);
  expect(report.parked?.groupVoltages?.modules).toHaveLength(80);
  expect(renderBatteryDiagnosis(report)).toContain(`Module ${String(report.parked?.groupVoltages?.modules[0])}: ${String(report.parked?.groupVoltages?.volts[0])} V`);
  expect(read(file("fixtures/synthetic/battery-diagnosis-full-scan.jsonl"), "latin1")).toContain("parked scan start");
  expect(report.parked?.bmsFigure?.valueKwh).toBeGreaterThan(0);
  expect(report.parked?.temperatureRaw?.payloadHex).toMatch(/^(61){20}(00){4}$/);
  expect(report.capacity.status).toBe("not-measured");
  expect(report.health.status).toBe("not-assessed");
});

it("keeps missing parked observations absent across complete synthetic scans", async () => {
  const original = parseRecording(read(file(fixture), "latin1"));
  const cases = [
    { name: "incomplete-group", command: "22 2AE7", reply: "NO DATA\r\r>", missing: "groupVoltages" },
    { name: "over-rest-current", command: "22 2414", reply: "18DAF117056224140102\r\r>", missing: "groupVoltages" },
    { name: "missing-energy", command: "22 27AF", reply: "NO DATA\r\r>", missing: "bmsFigure" },
    { name: "zero-soc", command: "22 2B43", reply: "18DAF1CB04622B4300\r\r>", missing: "bmsFigure" },
    { name: "missing-raw", command: "22 2AF1", reply: "NO DATA\r\r>", missing: "temperatureRaw" },
    { name: "negative-raw", command: "22 2AF1", reply: "18DAF1CB037F2211\r\r>", missing: "temperatureRaw" },
  ] as const;
  const results = [];
  for (const variant of cases) {
    let parked = false;
    let replacing = false;
    const changed: RecordingLine[] = [];
    for (const line of original) {
      if (line.dir === "meta" && line.note === "parked scan start") parked = true;
      if (line.dir === "tx") replacing = parked && line.data.trim() === variant.command;
      if (line.dir !== "rx" || !replacing) { changed.push(line); continue; }
      if (line.data.includes(">")) changed.push({ ...line, data: variant.reply });
    }
    let clock = 0;
    const recording = new RecordingBuffer(() => clock++);
    recording.start(meta);
    const result = await runBatteryDiagnosisScan(new ReplayTransport(changed), recording, () => undefined, confirmEquinox);
    const report = await batteryDiagnosisFromRecording(result.jsonl, input(result.scanStatus), signalset);
    results.push({ name: variant.name, scanStatus: result.scanStatus, absent: report.parked?.[variant.missing] === undefined, parked: report.parked });
    expect(result.scanStatus).toBe("complete");
    expect(report.parked?.[variant.missing]).toBeUndefined();
  }
  write("/tmp/t2.14-synthetic-branches.json", `${JSON.stringify({ synthetic: true, results }, null, 2)}\n`);
});

it("rejects invalid nested parked reports through saved history without losing the prior report", async () => {
  const garageStore = { value: undefined as string | undefined, read() { return Promise.resolve(this.value); }, write(value: string) { this.value = value; return Promise.resolve(); } };
  const reportStore = { value: undefined as string | undefined, read() { return Promise.resolve(this.value); }, write(value: string) { this.value = value; return Promise.resolve(); } };
  const garage = createGarageFlow(garageStore);
  await garage.add("chevrolet-equinox-ev-2024", "mine");
  const history = createBatteryReportHistory(reportStore, garage);
  const valid = await batteryDiagnosisFromRecording(read(file(fixture), "latin1"), input("complete"), signalset);
  await history.save(valid);
  const before = reportStore.value;
  const wrongSource = { ...valid, parked: { ...valid.parked, temperatureRaw: { ...valid.parked?.temperatureRaw, source: { ...valid.parked?.temperatureRaw?.source, recording: "other" } } } };
  const wrongValue = { ...valid, parked: { ...valid.parked, groupVoltages: { ...valid.parked?.groupVoltages, volts: [0] } } };
  const malformedRaw = { ...valid, parked: { ...valid.parked, temperatureRaw: { ...valid.parked?.temperatureRaw, payloadHex: "A" } } };
  await expect(history.save(wrongSource as typeof valid)).rejects.toThrow();
  await expect(history.save(wrongValue as typeof valid)).rejects.toThrow();
  await expect(history.save(malformedRaw as typeof valid)).rejects.toThrow();
  expect(reportStore.value).toBe(before);
  expect(await createBatteryReportHistory(reportStore, garage).list("1")).toEqual([valid]);
  write("/tmp/t2.14-history-validation.json", `${JSON.stringify({ synthetic: true, rejected: ["nested source", "malformed group", "malformed raw hex"], priorReadable: true })}\n`);
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
  const result = await runBatteryDiagnosisScan(new ReplayTransport(missing), recording, () => undefined, confirmEquinox);
  const report = await batteryDiagnosisFromRecording(result.jsonl, input(result.scanStatus), signalset);
  expect(hasEquinoxSocFingerprint(report)).toBe(false);
  write("/tmp/t2.6b-synthetic-mismatch.json", `${JSON.stringify({ synthetic: true, scanStatus: result.scanStatus, canSave: hasEquinoxSocFingerprint(report) })}\n`);
});

it("keeps a partial recording on a disconnected replay", async () => {
  const source = parseRecording(read(file(fixture), "latin1"));
  const cut = source.findIndex((line) => line.dir === "tx" && line.data === "0120\r");
  const recording = fresh();
  const result = await runBatteryDiagnosisScan(new ReplayTransport(source.slice(0, cut)), recording, () => undefined, confirmEquinox);
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
