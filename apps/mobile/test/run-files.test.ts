// T0.9b isolated failure modes I1-I5: docs/specs/T0.9b-one-and-done-captures.md Verification "Isolated tests".
// Vitest runs in Node; Expo's mobile typecheck intentionally omits Node typings.
// @ts-expect-error Node built-in types are not part of the mobile compilation target.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { finishRun } from "../src/runFiles.js";
import { FakeTargets } from "./fakeTargets.js";

const readText = readFileSync as (path: URL, encoding: "latin1") => string;
const SPIKE_JSONL = readText(new URL("../../../fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl", import.meta.url), "latin1");
const HEADING = { vehicle: "2024 Chevrolet Equinox EV", date: "2026-09-25", result: { sent: 19, total: 19 } };
const JSONL = "2026-09-25-phone-console.jsonl";
const MD = "2026-09-25-codes-report.md";
const afterKeeps = (log: string[]) => log.filter((entry) => !entry.startsWith("keep:"));

describe("finishRun failure modes", () => {
  it("I1: a report that fails to build still delivers the recording", async () => {
    const targets = new FakeTargets();
    const outcome = await finishRun("codes", "not json\n", HEADING, targets);
    expect(targets.folderFiles.get(JSONL)).toBe("not json\n");
    expect(outcome.status.startsWith("Report error: ")).toBe(true);
    expect(outcome.report).toBeUndefined();
    expect([...targets.kept.keys()]).toEqual([JSONL]);
  });

  it("I2: a cancelled picker shares every file, one sheet at a time, recording first", async () => {
    const targets = new FakeTargets();
    targets.folderRejects = new Error("cancelled");
    const held: (() => void)[] = [];
    targets.heldShares = held;
    const running = finishRun("codes", SPIKE_JSONL, HEADING, targets);
    await vi.waitFor(() => { expect(held).toHaveLength(1); });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(afterKeeps(targets.log)).toEqual(["folder", `share:${JSONL}`]);
    held[0]();
    await vi.waitFor(() => { expect(held).toHaveLength(2); });
    expect(afterKeeps(targets.log)).toEqual(["folder", `share:${JSONL}`, `share:${MD}`]);
    held[1]();
    const outcome = await running;
    expect(outcome.status).toBe(`Share sheet opened for ${JSONL} (capture folder: cancelled). Share sheet opened for ${MD} (capture folder: cancelled).`);
  });

  it("I3: a failed folder write forgets the folder once and shares the rest", async () => {
    const targets = new FakeTargets();
    targets.writeThrowsFor = JSONL;
    const outcome = await finishRun("codes", SPIKE_JSONL, HEADING, targets);
    expect(targets.log.filter((entry) => entry === "forget")).toHaveLength(1);
    expect(targets.log).not.toContain(`write:${MD}`);
    expect(afterKeeps(targets.log)).toEqual(["folder", `write:${JSONL}`, "forget", `share:${JSONL}`, `share:${MD}`]);
    expect(outcome.status).toBe(`Share sheet opened for ${JSONL} (capture folder: permission revoked). Share sheet opened for ${MD} (capture folder: permission revoked).`);
  });

  it("I4: a failed share is reported and the next file is still shared", async () => {
    const targets = new FakeTargets();
    targets.folderRejects = new Error("cancelled");
    targets.shareRejectsFor = JSONL;
    const outcome = await finishRun("codes", SPIKE_JSONL, HEADING, targets);
    expect(targets.log).toContain(`share:${MD}`);
    expect(outcome.status).toContain(`NOT SAVED ${JSONL}: share already pending. A copy stays in app storage (captures/${JSONL}).`);
  });

  it("I5: a failed private copy is reported and the report is still kept and delivered", async () => {
    const targets = new FakeTargets();
    targets.keepThrowsFor = "phone-console";
    const outcome = await finishRun("codes", SPIKE_JSONL, HEADING, targets);
    expect(outcome.status).toContain("NOT SAVED phone-console.jsonl: disk full.");
    expect([...targets.kept.keys()]).toEqual([MD]);
    expect(targets.folderFiles.get(MD)).toBe(outcome.report);
    expect(outcome.report).toBeDefined();
  });
});
