import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reassemble, type Frame } from "../src/elm/isotp.js";
import { parseElmResponse } from "../src/elm/reader.js";
import { decodeReadiness, SPARK_MONITORS, type MonitorId } from "../src/obd/readiness.js";
import { decodeSupported } from "../src/obd/supported.js";
import { parseRecording } from "../src/recording/format.js";

// Spike cases read frames from the tracked redacted recordings by tx line number (X-2026-09-23-vin-redaction).
const equinox = "../../../fixtures/recordings/chevrolet-equinox-ev-2024/";
const spike = load("2026-09-22-spike.redacted.jsonl");
const spike2 = load("2026-09-22-spike-2.redacted.jsonl");

function load(name: string) {
  return parseRecording(readFileSync(fileURLToPath(new URL(equinox + name, import.meta.url)), "latin1"));
}

/** Reassembled frames of the response to the tx on 1-based line `txLine`. */
function framesAt(rec: ReturnType<typeof load>, txLine: number): Frame[] {
  const tx = rec[txLine - 1];
  if (tx.dir !== "tx") throw new Error(`line ${String(txLine)} is not tx`);
  let text = "";
  for (const line of rec.slice(txLine)) {
    if (line.dir === "tx") break;
    if (line.dir === "rx") text += line.data;
  }
  return reassemble(parseElmResponse(text.split(">")[0], tx.data.slice(0, -1)).lines).frames;
}

// Synthetic frames (ecu 7E8), built inline.
function frame(...bytes: number[]): Frame {
  return { header: "7E8", ecu: "7E8", data: Uint8Array.from(bytes) };
}

const hex = (pids: number[]) => pids.map((p) => p.toString(16).padStart(2, "0").toUpperCase()).join(" ");

// tx lines: spike 24/42/52/62, spike-2 23/42/52/62 (0100, 0120, 0140, 0101).
const recordings = [
  ["spike", spike, { 0x00: 24, 0x20: 42, 0x40: 52, 0x01: 62 }],
  ["spike-2", spike2, { 0x00: 23, 0x20: 42, 0x40: 52, 0x01: 62 }],
] as const;

const EXPECTED: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  0x00: {
    "45": "01 20",
    CB: "01 20",
    "40": "01 20",
    "28": "01 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 10 11 12 13 14 15 18 19 1C 1E 1F 20",
    "17": "01 0D 1C 1F 20",
  },
  0x20: { "45": "40", "40": "40", CB: "40", "17": "21 30 31 40", "28": "21 2C 2D 2E 2F 30 31 32 33 3C 3D 40" },
  0x40: { "45": "42", CB: "42", "40": "42", "28": "41 42 43 44 45 46 47 49 4A 4C 52 60", "17": "42 60" },
};

describe("decodeSupported on the spike recordings", () => {
  for (const [name, rec, lines] of recordings) {
    it.each([0x00, 0x20, 0x40] as const)(`${name}: 01%i`, (base) => {
      const out: Record<string, string> = {};
      for (const f of framesAt(rec, lines[base])) {
        const r = decodeSupported(base, f);
        if (!r.ok) throw new Error(`${f.ecu}: ${r.reason}`);
        out[r.ecu] = hex(r.pids);
      }
      expect(out).toEqual(EXPECTED[base]);
    });
  }
});

describe("decodeSupported (synthetic)", () => {
  it("base A0, 04 00 00 00 -> [A6]", () => {
    expect(decodeSupported(0xa0, frame(0x41, 0xa0, 0x04, 0, 0, 0))).toEqual({ ok: true, ecu: "7E8", base: 0xa0, pids: [0xa6] });
  });
  it("all zero -> []", () => {
    expect(decodeSupported(0xa0, frame(0x41, 0xa0, 0, 0, 0, 0))).toMatchObject({ ok: true, pids: [] });
  });
  it("base 10 -> unknown-pid", () => {
    expect(decodeSupported(0x10, frame(0x41, 0x10, 0, 0, 0, 0))).toEqual({ ok: false, ecu: "7E8", reason: "unknown-pid" });
  });
  it("5-byte payload -> length", () => {
    expect(decodeSupported(0x00, frame(0x41, 0x00, 0, 0, 0))).toEqual({ ok: false, ecu: "7E8", reason: "length" });
  });
});

describe("decodeReadiness on the spike recordings", () => {
  // spike lines 63-70, spike-2 lines 63-70: every module answers 41 01 00 04 00 00.
  it.each(recordings.map(([name, rec, lines]) => [name, framesAt(rec, lines[0x01])] as const))("%s: 0101", (_, frames) => {
    expect(frames.map((f) => f.ecu).sort()).toEqual(["17", "28", "40", "45", "CB"]);
    for (const f of frames) {
      expect(decodeReadiness(0x01, f)).toEqual({
        ok: true,
        ecu: f.ecu,
        pid: 0x01,
        mil: false,
        dtcCount: 0,
        ignition: "spark",
        monitors: [{ id: "components", complete: true }],
      });
    }
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
  it("41 01 83 27 65 04: MIL on, 3 DTCs, spark", () => {
    expect(decodeReadiness(0x01, frame(0x41, 0x01, 0x83, 0x27, 0x65, 0x04))).toEqual({
      ok: true, ecu: "7E8", pid: 0x01, mil: true, dtcCount: 3, ignition: "spark", monitors: CASE4,
    });
  });

  it("41 01 00 08 8A 80: compression", () => {
    expect(decodeReadiness(0x01, frame(0x41, 0x01, 0x00, 0x08, 0x8a, 0x80))).toEqual({
      ok: true, ecu: "7E8", pid: 0x01, mil: false, dtcCount: 0, ignition: "compression",
      monitors: [
        { id: "noxScr", complete: true },
        { id: "boostPressure", complete: true },
        { id: "egrVvt", complete: false },
      ],
    });
  });

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
