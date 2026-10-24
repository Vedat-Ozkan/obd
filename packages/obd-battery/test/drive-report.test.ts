import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRecording } from "../../obd-core/src/recording/format.js";
import { codesReportFromRecording } from "../../obd-core/src/report/replay.js";
import { importObdbMode22 } from "../../obd-core/src/vehicles/obdb/import.js";
import { groupsUnderLoad, GROUP_EXCESS_LIMIT_MOHM as L } from "../src/driveGroups.js";
import { compareCodes, driveReportFromRecording, parseDriveReport, renderDriveReport, UNCONFIRMED_LINE, type DriveReport } from "../src/driveReport.js";
import { batteryDiagnosisFromRecording } from "../src/report.js";
import { chargeLogFromRecording } from "../src/session.js";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "latin1");
const save = (name: string, text: string) => { writeFileSync(join(tmpdir(), `t2.13-c-${name}.md`), text); };
const signals = importObdbMode22(JSON.parse(read("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json")));
const drive1 = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive.redacted.jsonl";
const drive2 = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive-2.redacted.jsonl";
const before = "fixtures/synthetic/codes-compare-before.jsonl";
const after = "fixtures/synthetic/codes-compare-after.jsonl";
const input = (recording: string, stopReason: string) => ({ garageVehicleId: "1", scannedAt: "2026-09-30T18:00:00.000Z", recording, minutes: 20 as const, stopReason });
const banned = /passed|validated|healthy|no red flags/i;
const withoutLabel = (text: string) => text.replace(UNCONFIRMED_LINE, "");

const parked = async (recording: string) => {
  const full = "fixtures/synthetic/battery-diagnosis-full-scan.jsonl";
  const report = await batteryDiagnosisFromRecording(read(full), { garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-30T08:00:00.000Z", recording, scanStatus: "complete" }, signals);
  return { ...report, codes: await codesReportFromRecording(parseRecording(read(before))) };
};

describe("drive report, committed drives", () => {
  it("C1: drive 1 is checked, unflagged, labelled provisional, with no rescan in the recording", async () => {
    const report = await driveReportFromRecording(read(drive1), input(drive1, "20 min recorded"));
    const text = renderDriveReport(report);
    save("drive1", text);
    expect(report.groups.status).toBe("checked");
    expect(report.groups.flagged).toEqual([]);
    expect(report.codes).toEqual({ status: "not-run", reason: "no codes rescan in this recording" });
    expect(text).toContain(UNCONFIRMED_LINE);
    expect(text).toContain("No group stood out in this drive. Provisional until the rule is confirmed.");
    expect(text).toContain("Rescan not run: no codes rescan in this recording.");
    expect(text).not.toMatch(/mΩ|mohm/i);
    expect(withoutLabel(text)).not.toMatch(banned);
  }, 60_000);

  it("C2: drive 2 keeps the label and flags nothing, with the status as found", async () => {
    const report = await driveReportFromRecording(read(drive2), input(drive2, "disconnect pressed"));
    const text = renderDriveReport(report);
    save("drive2", text);
    expect(report.groups.flagged).toEqual([]);
    expect(text).toContain(UNCONFIRMED_LINE);
    expect(text).toContain(report.groups.status === "checked" ? "No group stood out in this drive. Provisional" : "Groups not checked:");
    expect(report.codes).toEqual({ status: "not-run", reason: "no codes rescan in this recording" });
    expect(withoutLabel(text)).not.toMatch(banned);
  }, 60_000);

  it("C3: a synthetic 4L excess in one group is named, provisionally, in a separate synthetic table", async () => {
    const real = await driveReportFromRecording(read(drive1), input(drive1, "20 min recorded"));
    const log = await chargeLogFromRecording(parseRecording(read(drive1)), drive1, signals);
    const group = [...real.groups.groups].sort((a, b) => a.excessMohm - b.excessMohm).at(39);
    if (group === undefined) throw new Error("drive 1 has fewer than 40 groups");
    const currentAt = (t: number) => (log.current.find((p) => p.t >= t) ?? log.current.at(-1))?.value ?? 0;
    const injected = { ...log, synthetic: true, groups: log.groups.map((set) => ({ ...set, volts: set.volts.map((v, g) => g === group.index ? v - 4 * L / 1000 * currentAt(set.t) : v) })) };
    const report: DriveReport = { ...real, groups: groupsUnderLoad(injected) };
    const text = `Synthetic: yes (group ${String(group.index + 1)} +${String(4 * L)} mΩ injected into a real log)\n\n${renderDriveReport(report)}`;
    save("inject", text);
    expect(report.groups.flagged).toEqual([group.index]);
    expect(text).toContain(`Group ${String(group.index + 1)} (module ${String(group.module)}) sagged more than the others. Provisional until the rule is confirmed; get it inspected.`);
    expect(text.match(/sagged more than the others/g)).toHaveLength(1);
    expect(text).toContain(UNCONFIRMED_LINE);
  }, 60_000);
});

describe("drive report, codes comparison", () => {
  const codes = async (path: string) => codesReportFromRecording(parseRecording(read(path)));

  it("C4: new, gone, unchanged and one-sided modules, against the expected diff written from the fixtures", async () => {
    const none = { new: [], gone: [], unchanged: [] };
    const expected = [
      { ecu: "7E8", stored: { new: ["P0300"], gone: ["P0133"], unchanged: ["P0171"] }, pending: { new: [], gone: [], unchanged: ["U0158"] }, permanent: none },
      { ecu: "7E9", note: "not read after", stored: { ...none, notCompared: "not read after" }, pending: { ...none, notCompared: "not read after" }, permanent: { ...none, notCompared: "not read after" } },
      { ecu: "7EA", note: "not read before", stored: { ...none, listed: ["P0420"] }, pending: { ...none, listed: [] }, permanent: { ...none, listed: [] } },
    ];
    const result = compareCodes(await codes(before), await codes(after));
    expect(result.modules).toEqual(expected);
    const text = renderDriveReport({
      ...(await driveReportFromRecording(read(drive1), input(drive1, "20 min recorded"))), codes: result,
      preDrive: { scannedAt: "2026-09-30T08:00:00.000Z", recording: before },
    });
    save("compare", text);
    expect(text).toContain("stored: new P0300; gone P0133; unchanged P0171");
    expect(text).toContain("- Module 7E9: not read after");
    expect(text).toContain("- Module 7EA: not read before");
    expect(text).toContain("stored: P0420 (not compared)");
  }, 60_000);

  it("C5: the pre-drive pointer, or the plain line without one", async () => {
    const without = await driveReportFromRecording(read(drive2), input(drive2, "disconnect pressed"));
    expect(renderDriveReport(without)).toContain("No pre-drive scan to compare.");
    const pre = await parked("fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-parked.redacted.jsonl");
    const withPre = await driveReportFromRecording(read(drive2), input(drive2, "disconnect pressed"), pre);
    const text = renderDriveReport(withPre);
    expect(withPre.preDrive).toEqual({ scannedAt: pre.scannedAt, recording: pre.recording });
    expect(text).toContain(`Compared with the parked scan of ${pre.scannedAt} (${pre.recording}).`);
    expect(text).not.toContain("No pre-drive scan to compare.");
  }, 60_000);

  it("C6: the saved JSON parses back to the same report", async () => {
    const report = await driveReportFromRecording(read(drive1), input(drive1, "20 min recorded"));
    const round = parseDriveReport(JSON.parse(JSON.stringify(report)));
    expect(renderDriveReport(round)).toBe(renderDriveReport(report));
    expect(round.groupRule).toBe("unconfirmed");
    expect(round.groups.flagged).toEqual(report.groups.flagged);
  }, 60_000);
});
