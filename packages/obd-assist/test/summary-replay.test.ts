import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importObdbMode22 } from "../../obd-core/src/vehicles/index.js";
import { batteryDiagnosisFromRecording, renderBatteryDiagnosis } from "obd-battery/report";
import { summarize, type LlmClient, type SummaryRequest } from "obd-assist";
import { createSummaryReplayArtifact, reportForSavedCase, type SavedSummaryCase } from "../scripts/replay-summary.js";

const root = new URL("../../../", import.meta.url);
const fixturePath = "fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl";
const responses = JSON.parse(readFileSync(new URL("fixtures/synthetic/t2.10-summary-responses.json", root), "utf8")) as { readonly cases: readonly SavedSummaryCase[] };
const signalset = importObdbMode22(JSON.parse(readFileSync(new URL("packages/obd-core/vehicles/chevrolet-equinox-ev/default.json", root), "utf8")));

async function replayReport() {
  return batteryDiagnosisFromRecording(readFileSync(new URL(fixturePath, root), "latin1"), {
    garageVehicleId: "summary-replay", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z", recording: fixturePath, scanStatus: "complete",
  }, signalset);
}

describe("summary recording replay", () => {
  it("uses accepted saved summaries and fails closed to the report template", async () => {
    const report = await replayReport();
    const results: { name: string; kind: string; text: string }[] = [];

    for (const saved of responses.cases) {
      const caseReport = reportForSavedCase(report, saved);
      const caseTemplate = renderBatteryDiagnosis(caseReport);
      let request: SummaryRequest | undefined;
      const client: LlmClient = {
        generate(input) {
          request = input;
          if (saved.providerFailure) return Promise.reject(new Error("provider detail must never be displayed"));
          return Promise.resolve(saved.response);
        },
      };
      const result = await summarize(caseReport, client, { model: "saved-response", effort: "none" });
      expect(request).toBeDefined();
      const requestText = JSON.stringify(request);
      expect(requestText).not.toMatch(/summary-replay|2026-09-22T00:00:00.000Z|2026-09-22-spike\.redacted|18DAF1|VIN/i);
      results.push({ name: saved.name, kind: result.kind, text: result.text });

      if (saved.name === "accepted" || saved.name === "synthetic-multi-dtc-no-recording" || saved.name === "synthetic-multi-dtc-with-number-no-recording") {
        expect(result.kind).toBe("llm");
        if (saved.name === "accepted") {
          expect(result.text).toContain("12.7 V");
          expect(result.text).toContain("not measured");
          expect(result.text).toContain("community");
        } else {
          expect(result.text).toContain("P0133");
          if (saved.name === "synthetic-multi-dtc-with-number-no-recording") expect(result.text).toContain("12.7 V");
        }
      } else {
        expect(result.kind).toBe("template");
        expect(result.text).toBe(caseTemplate);
        expect(result.text).not.toContain("provider detail");
      }
    }

    const artifact = {
      fixture: fixturePath,
      reportDigest: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
      promptVersion: "t2.10-v1",
      cases: results,
    };
    writeFileSync("/tmp/t2.10a-summary-replay.json", `${JSON.stringify(artifact, null, 2)}\n`);
    expect(await createSummaryReplayArtifact(report, responses)).toEqual(artifact);
    expect(results).toHaveLength(12);
  });
});
