// X-2026-09-28-app-redesign C1: system back (spec §Verification, isolated failures 1 and 2) and the Car screen's SoC hero
// (Decision 2: EQUINOXEV_SOC, 22 2B43, one decimal) replayed from the committed Equinox recordings.
// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { batteryDiagnosisFromRecording } from "../../../packages/obd-battery/src/report.js";
import { back, type Route } from "../src/app/navigation.js";
import { socHero } from "../src/app/reportView.js";

const read = readFileSync as (path: URL, encoding: "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const root = new URL("../../../", import.meta.url);
const signals = importObdbMode22(signalsetJson);
const artifact: Record<string, unknown> = {};

const checkStack: readonly Route[] = [{ name: "garage" }, { name: "car", entryId: "1" }, { name: "check", entryId: "1", intent: "check" }];

describe("system back", () => {
  it("blocks on the check screen while a diagnosis or charge log runs, instead of unmounting the console", () => {
    expect(back(checkStack, true)).toBe("blocked");
    // Unlocked, the same stack pops, so the block comes from the lock and not from the route.
    expect(back(checkStack, false)).toEqual(checkStack.slice(0, 2));
    artifact.back = { lockedCheck: back(checkStack, true), unlockedCheck: back(checkStack, false) };
  });

  it("exits the app at the bottom of the stack", () => {
    const garage: readonly Route[] = [{ name: "garage" }];
    expect(back(garage, false)).toBe("exit");
    expect(back(garage, true)).toBe("exit");
    artifact.backAtGarage = back(garage, false);
  });
});

describe("Car screen SoC hero", () => {
  const base = "fixtures/recordings/chevrolet-equinox-ev-2024/";
  const cases = [
    "2026-09-22-spike.redacted.jsonl",
    "2026-09-22-spike-2.redacted.jsonl",
    "2026-09-23-discovery-targeted.redacted.jsonl",
    "2026-09-24-phone-console.redacted.jsonl",
    "2026-09-24-phone-console-2.redacted.jsonl",
  ];
  it.each(cases)("shows EQUINOXEV_SOC (22 2B43) with one decimal for %s", async (name) => {
    const recording = base + name;
    const report = await batteryDiagnosisFromRecording(read(new URL(recording, root), "latin1"), {
      garageVehicleId: "1", catalogId: "chevrolet-equinox-ev-2024", scannedAt: "2026-09-22T00:00:00.000Z", recording, scanStatus: "complete",
    }, signals);
    const hero = socHero(report);
    const soc = report.signals.filter((s) => s.id === "EQUINOXEV_SOC" && s.source.command === "22 2B43").at(-1);
    if (soc) {
      // The latest 2B43 reading, not the high-resolution 27C6 one, rounded to one decimal as in the mockups.
      expect(hero).toEqual({ percent: Math.round(soc.value * 10) / 10, tier: "verified", scannedAt: report.scannedAt });
      if (name === "2026-09-22-spike.redacted.jsonl") expect(hero?.percent).toBe(69.8); // the approved mockup's value
    } else {
      expect(hero).toBeUndefined();
    }
    artifact[name] = hero ?? null;
    write("/tmp/x-redesign-navigation.json", `${JSON.stringify(artifact, null, 2)}\n`);
  });
});
