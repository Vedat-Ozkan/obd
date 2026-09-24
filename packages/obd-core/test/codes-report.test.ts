// T0.7 Stage B2 E2E: docs/specs/T0.7-codes-report.md Verification "Stage B2". Recordings and synthetic fixtures go
// through Elm327Session (scripts/codes-report.ts) into buildCodesReport and renderCodesReport.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { codesReportFromRecording, renderRecordings } from "../scripts/codes-report.js";
import { Elm327Session } from "../src/elm/session.js";
import { parseRecording } from "../src/recording/format.js";
import { recentlyCleared, type CodesPid, type CodesReport, type ModuleCodes } from "../src/report/codes.js";
import { renderCodesReport } from "../src/report/render.js";
import { ReplayTransport } from "../src/transport/replay.js";

const repoFile = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
const load = (rel: string) => parseRecording(readFileSync(repoFile(rel), "latin1"));

const equinox = "fixtures/recordings/chevrolet-equinox-ev-2024/";
const SPIKE = `${equinox}2026-09-22-spike.redacted.jsonl`;
const SPIKE2 = `${equinox}2026-09-22-spike-2.redacted.jsonl`;
const PHONE = `${equinox}2026-09-24-phone-console.redacted.jsonl`;
const CLEARED = "fixtures/synthetic/codes-cleared.jsonl";
const PERMANENT = "fixtures/synthetic/codes-permanent.jsonl";
const STORED = "fixtures/synthetic/codes-stored.jsonl";
const CONFLICT = "fixtures/synthetic/codes-conflict.jsonl";
const PATHS = [SPIKE, SPIKE2, PHONE, CLEARED, PERMANENT, STORED, CONFLICT];

const report = (rel: string) => codesReportFromRecording(load(rel));

function mod(r: CodesReport, ecu: string): ModuleCodes {
  const m = r.modules.find((x) => x.ecu === ecu);
  if (m === undefined) throw new Error(`no module ${ecu}`);
  return m;
}

const pidStatus = (m: ModuleCodes, pid: CodesPid) => m.pids[pid].status;

describe("codes report artifact", () => {
  it("renderRecordings equals packages/obd-core/test/codes-reports.md", async () => {
    const artifact = readFileSync(repoFile("packages/obd-core/test/codes-reports.md"), "utf8");
    expect(await renderRecordings(PATHS)).toBe(artifact);
  });
});

describe("codes report fields (failure modes 1-12)", () => {
  it("1, 2, 3: spike and spike-2 are unknown, with complete components monitors and no counters read", async () => {
    for (const rel of [SPIKE, SPIKE2]) {
      const r = await report(rel);
      expect(r.modules.map((m) => m.ecu)).toEqual(["17", "28", "40", "45", "CB"]);
      for (const m of r.modules) {
        expect(m.readiness).toEqual({
          status: "read", mil: false, dtcCount: 0, monitors: [{ id: "components", complete: true }],
        });
        expect(pidStatus(m, "4E")).toBe("unsupported");
        expect(pidStatus(m, "4D")).toBe("unsupported");
      }
      for (const ecu of ["17", "28"]) {
        for (const pid of ["30", "31", "21"] as const) expect(pidStatus(mod(r, ecu), pid)).toBe("not-read");
      }
      for (const ecu of ["40", "45", "CB"]) {
        for (const pid of ["30", "31", "21"] as const) expect(pidStatus(mod(r, ecu), pid)).toBe("unsupported");
      }
      expect(r.recentlyCleared.legs.monitorsIncomplete).toBe("no");
      expect(r.recentlyCleared.legs.countersLow).toBe("unknown");
      expect(r.recentlyCleared.verdict).toBe("unknown");
      expect(r.recentlyCleared.strong).toBe(false);
    }
  });

  it("3, 8, 12: phone console legs yes/unknown/unknown/unknown, no freeze data, pending and permanent not read", async () => {
    const r = await report(PHONE);
    expect(r.recentlyCleared).toEqual({
      verdict: "unknown",
      strong: false,
      legs: { noStoredDtcs: "yes", monitorsIncomplete: "unknown", countersLow: "unknown", permanentDtcs: "unknown" },
    });
    expect(mod(r, "17").freezeFrame).toEqual({ status: "none-stored" });
    for (const m of r.modules) {
      expect(m.pending).toEqual({ status: "not-read" });
      expect(m.permanent).toEqual({ status: "not-read" });
    }
    expect(renderCodesReport(r)).not.toContain("AAT");
  });

  it("7: a negative 0A is failed, not none; the permanent leg comes from the modules that answered", async () => {
    const spike = await report(SPIKE);
    for (const ecu of ["17", "CB"]) {
      expect(mod(spike, ecu).permanent).toEqual({ status: "failed", reason: "negative", code: 0x11 });
    }
    for (const ecu of ["28", "40", "45"]) expect(mod(spike, ecu).permanent).toEqual({ status: "read", dtcs: [] });
    expect(spike.recentlyCleared.legs.permanentDtcs).toBe("no");
    expect(renderCodesReport(spike)).toContain("not answered (negative response 11)");

    const conflict = await report(CONFLICT);
    expect(mod(conflict, "17").permanent).toEqual({ status: "read", dtcs: [] });
    expect(mod(conflict, "CB").permanent).toEqual({ status: "failed", reason: "negative", code: 0x11 });
    expect(conflict.recentlyCleared.legs.permanentDtcs).toBe("no");
  });

  it("4: low counters with complete monitors are unknown (codes-conflict)", async () => {
    const r = await report(CONFLICT);
    expect(r.recentlyCleared).toEqual({
      verdict: "unknown",
      strong: false,
      legs: { noStoredDtcs: "yes", monitorsIncomplete: "no", countersLow: "yes", permanentDtcs: "no" },
    });
    expect(renderCodesReport(r)).toContain("Unknown: the checks disagree");
  });

  it("5, 8: codes-cleared is indicated, not strong, and shows no freeze data", async () => {
    const r = await report(CLEARED);
    expect(r.recentlyCleared).toEqual({
      verdict: "indicated",
      strong: false,
      legs: { noStoredDtcs: "yes", monitorsIncomplete: "yes", countersLow: "yes", permanentDtcs: "no" },
    });
    expect(mod(r, "7E8").freezeFrame).toEqual({ status: "none-stored" });
    expect(renderCodesReport(r)).not.toContain("AAT");
  });

  it("6: codes-permanent is indicated and strong with no counter read", async () => {
    const r = await report(PERMANENT);
    for (const pid of ["30", "31", "4E"] as const) expect(pidStatus(mod(r, "7E8"), pid)).toBe("unsupported");
    expect(r.recentlyCleared).toEqual({
      verdict: "indicated",
      strong: true,
      legs: { noStoredDtcs: "yes", monitorsIncomplete: "yes", countersLow: "unknown", permanentDtcs: "yes" },
    });
  });

  it("9, 12: codes-stored shows the freeze frame; counters at policy are not low; 7E9 is not read", async () => {
    const r = await report(STORED);
    const m = mod(r, "7E8");
    expect(m.freezeFrame).toMatchObject({ status: "stored", dtc: "P0133", readings: [{ id: "AAT", value: 20, unit: "degC" }] });
    expect(m.pids["30"]).toEqual({ status: "read", value: 10, unit: "count" });
    expect(m.pids["31"]).toEqual({ status: "read", value: 100, unit: "km" });
    expect(m.pids["4E"]).toEqual({ status: "read", value: 600, unit: "min" });
    expect(r.recentlyCleared.legs.noStoredDtcs).toBe("no");
    expect(r.recentlyCleared.legs.countersLow).toBe("no");
    expect(r.recentlyCleared.verdict).toBe("not-indicated");
    const text = renderCodesReport(r);
    expect(text).toContain("### Recently cleared: not indicated");
    expect(text).toContain("stored for P0133; AAT 20 degC");
    const e9 = mod(r, "7E9");
    expect(e9.readiness).toEqual({ status: "not-read" });
    for (const pid of ["21", "30", "31", "4D", "4E"] as const) expect(e9.pids[pid]).toEqual({ status: "not-read" });
    expect(e9.freezeFrame).toEqual({ status: "not-read" });
  });

  it("11: the VIN's retained characters 1-11 never appear in the rendered report", async () => {
    for (const rel of [SPIKE, SPIKE2]) {
      const lines = load(rel);
      const session = new Elm327Session(new ReplayTransport(lines));
      let vinData: Uint8Array | undefined;
      for (const line of lines) {
        if (line.dir !== "tx") continue;
        const cmd = line.data.replace(/\r$/, "");
        const r = await session.send(cmd, { retry: false, timeoutMs: 500 });
        if (cmd === "0902") {
          vinData = r.frames[0]?.data;
          break;
        }
      }
      await session.close();
      if (vinData === undefined) throw new Error(`no 0902 frame in ${rel}`);
      // 49 02 01 then the 17 VIN characters; 12-17 are masked in the redacted copy (ADR-017).
      const kept = String.fromCharCode(...vinData.subarray(3, 14));
      expect(kept).toHaveLength(11);
      const text = renderCodesReport(await report(rel));
      expect(text).not.toContain(kept);
      expect(text).not.toContain(kept.slice(0, 4));
    }
  });
});

describe("recentlyCleared legs (isolated, failure 10)", () => {
  it("stored codes present with monitors incomplete and counters low is unknown, not strong", () => {
    expect(
      recentlyCleared({ noStoredDtcs: "no", monitorsIncomplete: "yes", countersLow: "yes", permanentDtcs: "yes" }),
    ).toEqual({
      verdict: "unknown",
      strong: false,
      legs: { noStoredDtcs: "no", monitorsIncomplete: "yes", countersLow: "yes", permanentDtcs: "yes" },
    });
  });
});

describe("recentlyCleared strong path (isolated, failure 13)", () => {
  it.each(["no", "unknown"] as const)("permanent codes without an incomplete monitor (%s) is unknown, not strong", (m) => {
    const legs = { noStoredDtcs: "yes", monitorsIncomplete: m, countersLow: "unknown", permanentDtcs: "yes" } as const;
    expect(recentlyCleared(legs)).toEqual({ verdict: "unknown", strong: false, legs });
  });
});
