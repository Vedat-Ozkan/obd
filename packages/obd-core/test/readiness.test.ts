import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Frame } from "../src/elm/isotp.js";
import { decodeReadiness, SPARK_MONITORS, type MonitorId } from "../src/obd/readiness.js";
import { decodeSupported } from "../src/obd/supported.js";

// Synthetic frames (ecu 7E8), built inline.
function frame(...bytes: number[]): Frame {
  return { header: "7E8", ecu: "7E8", data: Uint8Array.from(bytes) };
}

describe("decodeSupported (synthetic)", () => {
  it("base 10 -> unknown-pid", () => {
    expect(decodeSupported(0x10, frame(0x41, 0x10, 0, 0, 0, 0))).toEqual({ ok: false, ecu: "7E8", reason: "unknown-pid" });
  });
  it("5-byte payload -> length", () => {
    expect(decodeSupported(0x00, frame(0x41, 0x00, 0, 0, 0))).toEqual({ ok: false, ecu: "7E8", reason: "length" });
  });
});

const CASE4: { id: MonitorId; complete: boolean }[] = [
  { id: "misfire", complete: true },
  { id: "fuel", complete: false },
  { id: "components", complete: true },
  { id: "catalyst", complete: true },
  { id: "evap", complete: false },
  { id: "o2Sensor", complete: true },
  { id: "o2Heater", complete: true },
];

describe("decodeReadiness (synthetic)", () => {
  it("41 01 00 08 14 14: reserved compression bits C2/C4 are ignored", () => {
    expect(decodeReadiness(0x01, frame(0x41, 0x01, 0x00, 0x08, 0x14, 0x14))).toMatchObject({ ok: true, monitors: [] });
  });

  it.each([0x00, 0xff])("41 41 %i 27 65 04: PID 41 ignores byte A", (a) => {
    const r = decodeReadiness(0x41, frame(0x41, 0x41, a, 0x27, 0x65, 0x04));
    expect(r).toEqual({ ok: true, ecu: "7E8", pid: 0x41, ignition: "spark", monitors: CASE4 });
    expect(r).not.toHaveProperty("mil");
    expect(r).not.toHaveProperty("dtcCount");
  });

  it("failures", () => {
    expect(decodeReadiness(0x01, frame(0x41, 0x01, 0, 4, 0))).toEqual({ ok: false, ecu: "7E8", reason: "length" });
    expect(decodeReadiness(0x41, frame(0x41, 0x01, 0, 4, 0, 0))).toEqual({ ok: false, ecu: "7E8", reason: "echo" });
  });
});

describe("readiness layout against the vendored OBDb 01/01 (bix = 8 * byte + 7 - bit, byte A = 0)", () => {
  interface Signal {
    id: string;
    fmt: { bix?: number };
  }
  const obdb = JSON.parse(
    readFileSync(fileURLToPath(new URL("../vehicles/saej1979/default.json", import.meta.url)), "utf8"),
  ) as { commands: { cmd: Record<string, string>; signals: Signal[] }[] };
  const signals = obdb.commands.find((c) => c.cmd["01"] === "01")?.signals ?? [];
  const bix = (id: string) => signals.find((s) => s.id === id)?.fmt.bix;

  /** A 41 01 frame with only OBDb bit `bix` set (bix 0 = A7, 8 = B7, ...). */
  function withBix(b: number): Frame {
    const data = [0, 0, 0, 0];
    data[b >> 3] |= 0x80 >> (b & 7);
    return frame(0x41, 0x01, ...data);
  }

  // B-byte *_SUP bix 13/14/15 = B2/B1/B0; C-byte *_SUP bix 16..23 = C7..C0 = SPARK_MONITORS[23 - bix].
  // C4: OBDb says ACRF (A/C refrigerant); we follow Wikipedia's GPF (docs/ELM327.md §J1979 conventions, conflict).
  it.each([
    ["CCM_SUP", "components"], ["FUEL_SUP", "fuel"], ["MIS_SUP", "misfire"],
    ["EGR_SUP", "egrVvt"], ["HTR_SUP", "o2Heater"], ["O2S_SUP", "o2Sensor"], ["ACRF_SUP", "gpf"],
    ["AIR_SUP", "secondaryAir"], ["EVAP_SUP", "evap"], ["HCAT_SUP", "heatedCatalyst"], ["CAT_SUP", "catalyst"],
  ] as const)("%s -> %s", (id, monitor) => {
    const b = bix(id);
    if (b === undefined) throw new Error(`OBDb 01/01 has no ${id}`);
    if (b >= 16) expect(SPARK_MONITORS[23 - b]).toBe(monitor);
    expect(decodeReadiness(0x01, withBix(b))).toMatchObject({ ignition: "spark", monitors: [{ id: monitor, complete: true }] });
  });

  it("CIM_SUP bix 12 = B3 = ignition type", () => {
    expect(bix("CIM_SUP")).toBe(12);
    expect(decodeReadiness(0x01, withBix(12))).toMatchObject({ ignition: "compression", monitors: [] });
  });
});
