import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRecording } from "../../obd-core/src/recording/format.js";
import { importObdbMode22 } from "../../obd-core/src/vehicles/obdb/import.js";
import { driveCaptureSummary } from "../scripts/drive-capture.js";
import { GROUP_EXCESS_LIMIT_MOHM as L, MARGIN, groupsUnderLoad } from "../src/driveGroups.js";
import { chargeLogFromRecording } from "../src/session.js";

// Spec: docs/specs/T2.13-drive-check.md §Verification, A1 (G1-G3) and A2 (G4). Drive 2 is held out: only G4 reads it, through the committed rule.
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "latin1");
const signals = importObdbMode22(JSON.parse(read("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json")));
const drive1 = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive.redacted.jsonl";
const drive2 = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-30-test-drive-2.redacted.jsonl";
const lines = parseRecording(read(drive1));
const save = (name: string, text: string) => { writeFileSync(join(tmpdir(), `t2.13-${name}.md`), text); };
const section = (summary: string) => summary.slice(summary.indexOf("## Groups under load"), summary.indexOf("## Context"));

// By construction drive 1 passes its own rule (lb <= e <= max < L): G1 shows the code ran, not that the rule works.
describe("groups under load, drive 1", () => {
  it("G1: real drive 1 is checked, nothing flagged, and L is the pre-registered formula of its max excess", async () => {
    const summary = await driveCaptureSummary(lines, drive1);
    save("drive1", summary);
    const part = section(summary);
    expect(part).toContain("- Status: checked\n");
    expect(part).toContain("- Flagged: none\n");
    expect(part).toContain(`- L = ${String(L)} mΩ\n`);
    expect(part).toMatch(/- Sets: \d+ complete, \d+ steady, \d+ loaded/);
    expect(part).toMatch(/- Excess \(mΩ\): median .*, max .* at group \d+ \(module \d+\), min .* at group \d+ \(module \d+\)/);
    const result = groupsUnderLoad(await chargeLogFromRecording(lines, drive1, signals));
    expect(L).toBe(Math.ceil(100 * MARGIN * Math.max(...result.groups.map((g) => g.excessMohm))) / 100);
  }, 60_000);

  // Synthetic: a weak group injected into drive 1 in memory. Not mixed with the real results above.
  it.each([
    ["G2", "inject-4L", 4 * L, true],
    ["G3", "inject-0.5L", 0.5 * L, false],
  ])("%s: synthetic %s into the lower-median group", async (_id, name, excessMohm, flags) => {
    const real = groupsUnderLoad(await chargeLogFromRecording(lines, drive1, signals));
    const group = [...real.groups].sort((a, b) => a.excessMohm - b.excessMohm).at(39);
    if (group === undefined) throw new Error("drive 1 has fewer than 40 groups");
    const summary = await driveCaptureSummary(lines, drive1, { group: group.index, excessMohm });
    save(`drive1-${name}`, summary);
    expect(summary).toContain(`\nSynthetic: yes (group ${String(group.index + 1)} +${String(excessMohm)} mΩ injected into a real log)\n`);
    const flagged = section(summary).match(/- Flagged: (.*)\n/)?.[1];
    expect(flagged).toBe(flags ? `group ${String(group.index + 1)} (module ${String(group.module)})` : "none");
  }, 60_000);
});

// Held out: drive 2 never set or tuned anything. A flag here is a FAIL to escalate, never a reason to change a constant.
describe("groups under load, drive 2", () => {
  it("G4: real drive 2 flags no group; checked or not-checked is recorded as found", async () => {
    const summary = await driveCaptureSummary(parseRecording(read(drive2)), drive2);
    save("drive2", summary);
    const part = section(summary);
    expect(part).toMatch(/- Status: (checked|not-checked)/);
    expect(part).toContain("- Flagged: none\n");
  }, 60_000);
});
