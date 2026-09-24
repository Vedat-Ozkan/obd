import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Frame } from "../src/elm/isotp.js";
import { decodePid, MODE01_PIDS, OBD_STANDARDS, type Unit } from "../src/obd/j1979.js";
import { checkEcho } from "../src/obd/response.js";

// The vendored OBDb signalset (packages/obd-core/vehicles/saej1979/, CC-BY-SA-4.0), read by this test only.
interface ObdbFmt {
  bix?: number;
  len: number;
  mul?: number;
  div?: number;
  add?: number;
  unit?: string;
  map?: Record<string, { value: string }>;
}
interface ObdbCommand {
  cmd: Record<string, string>;
  signals: { id: string; fmt: ObdbFmt }[];
}
const obdb = JSON.parse(
  readFileSync(fileURLToPath(new URL("../vehicles/saej1979/default.json", import.meta.url)), "utf8"),
) as { commands: ObdbCommand[] };

function obdbMode01(pid: number): ObdbCommand | undefined {
  const key = pid.toString(16).padStart(2, "0").toUpperCase();
  return obdb.commands.find((c) => c.cmd["01"] === key);
}

// Spec Verification Stage A, j1979 item 1: OBDb unit -> ours.
const UNITS: Readonly<Record<string, Unit>> = {
  percent: "percent",
  celsius: "degC",
  kilometers: "km",
  minutes: "min",
  volts: "V",
  scalar: "count",
};

// Synthetic frames (ecu 7E8), built inline.
function frame(...bytes: number[]): Frame {
  const f: Frame = { header: "7E8", ecu: "7E8", data: Uint8Array.from(bytes) };
  if (bytes[0] === 0x7f && bytes.length >= 3) f.negative = { service: bytes[1], code: bytes[2] };
  return f;
}

describe("MODE01_PIDS against the vendored OBDb SAEJ1979 signalset", () => {
  it.each(MODE01_PIDS.map((row) => [row.pid.toString(16).toUpperCase(), row] as const))("01/%s", (_, row) => {
    const signal = obdbMode01(row.pid)?.signals.find((s) => s.id === row.id);
    expect(signal, `OBDb 01/${row.pid.toString(16)} has no signal ${row.id}`).toBeDefined();
    const fmt = (signal as { fmt: ObdbFmt }).fmt;
    expect(fmt.bix ?? 0).toBe(0);
    expect(fmt.len).toBe(8 * row.bytes);
    expect([fmt.mul ?? 1, fmt.div ?? 1, fmt.add ?? 0]).toEqual([row.mul, row.div, row.add]);
    expect(fmt.map !== undefined ? "enum" : UNITS[fmt.unit ?? ""]).toBe(row.unit);
  });

  it("OBD_STANDARDS equals OBDb 01/1C's map", () => {
    const map = obdbMode01(0x1c)?.signals[0].fmt.map ?? {};
    expect(Object.keys(OBD_STANDARDS).sort()).toEqual(Object.keys(map).sort());
    for (const [code, entry] of Object.entries(map)) expect(OBD_STANDARDS[Number(code)]).toBe(entry.value);
  });
});

describe("decodePid (synthetic vectors)", () => {
  it.each([
    [0x1c, [0x05], 5, "enum"],
    [0x1c, [0xff], 255, "enum"],
    [0x21, [0x00, 0x2a], 42, "km"],
    [0x30, [0x0a], 10, "count"],
    [0x31, [0x03, 0xe8], 1000, "km"],
    [0x42, [0x31, 0x2d], 12.589, "V"],
    [0x46, [0x3c], 20, "degC"],
    [0x46, [0x00], -40, "degC"],
    [0x4d, [0x00, 0x1e], 30, "min"],
    [0x4e, [0x01, 0x2c], 300, "min"],
    [0x5b, [0xb2], 69.804, "percent"],
    [0x5b, [0xff], 100, "percent"],
    [0xa6, [0x00, 0x01, 0x86, 0xa0], 10000, "km"],
    [0xb2, [0xe6], 90.196, "percent"],
  ] as const)("pid %i bytes %j -> %f %s", (pid, bytes, value, unit) => {
    const r = decodePid(pid, frame(0x41, pid, ...bytes));
    if (!r.ok) throw new Error(`decode failed: ${r.reason}`);
    expect(r).toMatchObject({ ecu: "7E8", pid, unit });
    expect(r.value).toBeCloseTo(value, 3);
  });

  it("1C labels known codes only", () => {
    expect(decodePid(0x1c, frame(0x41, 0x1c, 0x05))).toMatchObject({ ok: true, id: "OBDSUP", label: "NO OBD" });
    expect(decodePid(0x1c, frame(0x41, 0x1c, 0xff))).not.toHaveProperty("label");
  });
});

describe("decodePid failures", () => {
  it.each([
    ["41 30 0A as pid 31", 0x31, [0x41, 0x30, 0x0a], { reason: "echo" }],
    ["41 42 31", 0x42, [0x41, 0x42, 0x31], { reason: "length" }],
    ["41 42 31 2D 00 (trailing byte)", 0x42, [0x41, 0x42, 0x31, 0x2d, 0x00], { reason: "length" }],
    ["pid 0C", 0x0c, [0x41, 0x0c, 0x0b, 0xb8], { reason: "unknown-pid" }],
    ["7F 01 12", 0x31, [0x7f, 0x01, 0x12], { reason: "negative", code: 0x12 }],
  ] as const)("%s", (_, pid, bytes, expected) => {
    expect(decodePid(pid, frame(...bytes))).toEqual({ ok: false, ecu: "7E8", ...expected });
  });
});

describe("checkEcho", () => {
  it("empty data -> echo", () => {
    expect(checkEcho(frame(), [0x41, 0x00])).toEqual({ ok: false, ecu: "7E8", reason: "echo" });
  });
  it("matching prefix -> undefined", () => {
    expect(checkEcho(frame(0x41, 0x00, 0x80), [0x41, 0x00])).toBeUndefined();
  });
});
