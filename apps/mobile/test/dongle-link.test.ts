// docs/specs/X-2026-09-28-persistent-dongle.md Stage A. K1 is the E2E; L1-L8, V1-V5 and M1-M4 are the listed isolated failures.
// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRecording, type RecordingLine } from "obd-core/recording";
import { ReplayTransport } from "obd-core/transport/replay";
import type { Transport } from "obd-core/transport";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { runAndSaveBatteryDiagnosis } from "../src/batteryDiagnosisFlow.js";
import { createBatteryReportHistory } from "../src/batteryReports.js";
import { createDongleLink, createDongleMemory, runView, type LinkConnection } from "../src/ble/dongleLink.js";
import { createGarageFlow } from "../src/garage/flow.js";
import { RecordingBuffer } from "../src/recording.js";

const read = readFileSync as (path: URL, encoding: "utf8" | "latin1") => string;
const write = writeFileSync as (path: string, text: string) => void;
const root = new URL("../../../", import.meta.url);

class Store {
  value?: string;
  failWrites = false;
  read() { return Promise.resolve(this.value); }
  async write(value: string) { await Promise.resolve(); if (this.failWrites) throw new Error("disk full"); this.value = value; }
}

// A fake BLE side: every connect makes a transport that counts its closes; the disconnect listeners are kept so a test can fire them.
function rig() {
  const events: string[] = [];
  const closes = new Map<string, number>();
  const listeners = new Map<string, (error: Error | null) => void>();
  const failing = new Set<string>();
  let gate: Promise<void> | undefined;
  let connects = 0;
  const link = createDongleLink<LinkConnection>({
    async connect(deviceId) {
      const n = ++connects; const key = `${deviceId}#${String(n)}`;
      events.push(`connect ${deviceId}`);
      if (gate) await gate;
      if (failing.has(deviceId)) throw new Error("dongle not found");
      const transport: Transport = {
        write: () => Promise.resolve(),
        onData: () => () => undefined,
        close() { closes.set(key, (closes.get(key) ?? 0) + 1); events.push(`close ${key}`); return Promise.resolve(); },
      };
      return { transport, deviceId, deviceName: `name-${deviceId}` };
    },
    onDisconnected(deviceId, listener) { listeners.set(deviceId, listener); return { remove() { events.push(`remove ${deviceId}`); } }; },
  });
  return { link, events, closes, listeners, failing, connects: () => connects, hold(promise: Promise<void>) { gate = promise; }, release() { gate = undefined; } };
}

describe("dongle link failure modes", () => {
  it("L1: two overlapping connects to one device open one connection", async () => {
    const r = rig();
    let open!: () => void; r.hold(new Promise<void>((resolve) => { open = resolve; }));
    const a = r.link.connect("veepeak"); const b = r.link.connect("veepeak");
    expect(r.link.connecting()).toBe(true);
    open();
    const [first, second] = await Promise.all([a, b]);
    expect(r.connects()).toBe(1);
    expect(first).toBe(second);
    expect(r.link.connecting()).toBe(false);
  });

  it("L2: connecting another device closes the old transport first", async () => {
    const r = rig();
    await r.link.connect("one"); await r.link.connect("two");
    expect(r.events.filter((e) => e.startsWith("connect") || e.startsWith("close"))).toEqual(["connect one", "close one#1", "connect two"]);
    expect(r.link.current()?.deviceId).toBe("two");
  });

  it("L3: a late disconnect from a replaced connection does not clear the new one", async () => {
    const r = rig();
    await r.link.connect("one"); const late = r.listeners.get("one");
    await r.link.connect("two");
    const seen: unknown[] = []; r.link.subscribe((_c, lost) => { seen.push(lost); });
    late?.(new Error("late"));
    expect(r.link.current()?.deviceId).toBe("two");
    expect(seen).toEqual([]);
  });

  it("L4: a loss clears the link, closes its transport and reports lost", async () => {
    const r = rig();
    await r.link.connect("one");
    const seen: { connected: boolean; lost?: { error: Error | null } }[] = [];
    r.link.subscribe((connection, lost) => { seen.push({ connected: connection !== undefined, ...(lost ? { lost } : {}) }); });
    const error = new Error("BLE link lost");
    r.listeners.get("one")?.(error);
    expect(r.link.current()).toBeUndefined();
    expect(r.closes.get("one#1")).toBe(1);
    expect(seen).toEqual([{ connected: false, lost: { error } }]);
  });

  it("L5: only disconnect() holds auto-connect, and the next connect() clears it", async () => {
    const r = rig();
    await r.link.connect("one");
    await r.link.drop(); expect(r.link.held()).toBe(false);
    await r.link.connect("one"); r.listeners.get("one")?.(null); expect(r.link.held()).toBe(false);
    await r.link.connect("one"); await r.link.disconnect(); expect(r.link.held()).toBe(true);
    await r.link.connect("one"); expect(r.link.held()).toBe(false);
  });

  it("L6: a failed connect leaves nothing current and connecting() false", async () => {
    const r = rig();
    r.failing.add("one");
    await expect(r.link.connect("one")).rejects.toThrow("dongle not found");
    expect(r.link.connecting()).toBe(false);
    expect(r.link.current()).toBeUndefined();
    r.failing.delete("one");
    await expect(r.link.connect("one")).resolves.toMatchObject({ deviceId: "one" });
  });

  it("L7: reconnect() replaces the link with the last device, and retries that device after a failure", async () => {
    const r = rig();
    const old = await r.link.connect("one");
    r.failing.add("one");
    await expect(r.link.reconnect()).rejects.toThrow("dongle not found");
    expect(r.link.current()).toBeUndefined();
    expect(r.closes.get("one#1")).toBe(1);
    r.failing.delete("one");
    const again = await r.link.reconnect();
    expect(again).not.toBe(old);
    expect(again.deviceId).toBe("one");
    expect(r.events.filter((e) => e.startsWith("connect"))).toEqual(["connect one", "connect one", "connect one"]);
  });

  it("L8: drop() and disconnect() notify without lost", async () => {
    const r = rig();
    const seen: { connected: boolean; lost: boolean }[] = [];
    r.link.subscribe((connection, lost) => { seen.push({ connected: connection !== undefined, lost: lost !== undefined }); });
    await r.link.connect("one"); await r.link.drop();
    await r.link.connect("one"); await r.link.disconnect();
    expect(seen).toEqual([{ connected: true, lost: false }, { connected: false, lost: false }, { connected: true, lost: false }, { connected: false, lost: false }]);
  });
});

// A transport whose writes and listeners are observable.
function fakeLink(startsIdle?: boolean) {
  const writes: string[] = []; const subscribers = new Set<(bytes: Uint8Array) => void>(); let closed = 0;
  const transport: Transport = {
    ...(startsIdle === undefined ? {} : { startsIdle }),
    write(bytes) { writes.push(String.fromCharCode(...bytes)); return Promise.resolve(); },
    onData(cb) { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
    close() { closed++; return Promise.resolve(); },
  };
  return { transport, writes, subscribers, closed: () => closed };
}

describe("run view failure modes", () => {
  it("V1: close() leaves the underlying link open", async () => {
    const f = fakeLink(); await runView(f.transport).close();
    expect(f.closed()).toBe(0);
  });

  it("V2: a write after close() does not reach the link", async () => {
    const f = fakeLink(); const view = runView(f.transport);
    await view.write(new Uint8Array([65])); await view.close();
    await expect(view.write(new Uint8Array([66]))).rejects.toThrow();
    expect(f.writes).toEqual(["A"]);
  });

  it("V3: data after close() does not reach the closed view's listeners", async () => {
    const f = fakeLink(); const view = runView(f.transport); const got: number[] = [];
    view.onData((bytes) => { got.push(bytes.length); });
    for (const cb of f.subscribers) cb(new Uint8Array(1));
    await view.close();
    for (const cb of f.subscribers) cb(new Uint8Array(2));
    expect(got).toEqual([1]);
  });

  it("V4: close() removes the view's subscription from the link", async () => {
    const f = fakeLink();
    for (let run = 0; run < 3; run++) { const view = runView(f.transport); view.onData(() => undefined); await view.close(); }
    expect(f.subscribers.size).toBe(0);
  });

  it("V5: startsIdle is passed through unchanged", () => {
    expect(runView(fakeLink().transport).startsIdle).toBeUndefined();
    expect(runView(fakeLink(true).transport).startsIdle).toBe(true);
  });
});

describe("dongle memory failure modes", () => {
  it("M1: a missing, corrupt or wrong-version file reads as nothing remembered", async () => {
    for (const value of [undefined, "{not json", '{"version":2,"cars":{"1":{"id":"aa"}}}', '{"version":1,"cars":[]}', '{"version":1,"cars":{"1":{"id":7}}}', "null"]) {
      const store = new Store(); store.value = value;
      await expect(createDongleMemory(store).get("1")).resolves.toBeUndefined();
    }
    const broken = { read: () => Promise.reject(new Error("unreadable")), write: () => Promise.resolve() };
    await expect(createDongleMemory(broken).get("1")).resolves.toBeUndefined();
  });

  it("M2: remembering one car keeps another car's dongle", async () => {
    const memory = createDongleMemory(new Store());
    await memory.remember("1", { id: "aa", name: "A" }); await memory.remember("2", { id: "bb", name: "B" });
    expect(await memory.get("1")).toEqual({ id: "aa", name: "A" });
    expect(await memory.get("2")).toEqual({ id: "bb", name: "B" });
  });

  it("M3: remembering the same dongle without a name keeps the stored name", async () => {
    const memory = createDongleMemory(new Store());
    await memory.remember("1", { id: "aa", name: "Veepeak" }); await memory.remember("1", { id: "aa" });
    expect(await memory.get("1")).toEqual({ id: "aa", name: "Veepeak" });
    await memory.remember("1", { id: "cc" });
    expect(await memory.get("1")).toEqual({ id: "cc" });
  });

  it("M4: two quick remembers both land", async () => {
    const memory = createDongleMemory(new Store());
    await Promise.all([memory.remember("1", { id: "aa" }), memory.remember("2", { id: "bb" })]);
    expect(await memory.get("1")).toEqual({ id: "aa" });
    expect(await memory.get("2")).toEqual({ id: "bb" });
  });
});

// K1: the kept link end to end. One replay of the synthetic full scan played twice is the link; each run gets its own view.
// Synthetic: no phone battery-scan recording is committed. The second run's first write must be ATZ, and the replay rejects any other.
describe("kept link E2E", () => {
  it("K1: two battery diagnoses run back to back on one kept link", async () => {
    const fixture = parseRecording(read(new URL("fixtures/synthetic/battery-diagnosis-full-scan.jsonl", root), "latin1"));
    const twice: RecordingLine[] = [...fixture, ...fixture];
    const replay = new ReplayTransport(twice);
    let underlyingCloses = 0;
    const kept: Transport = { startsIdle: replay.startsIdle, write: (bytes) => replay.write(bytes), onData: (cb) => replay.onData(cb), close() { underlyingCloses++; return replay.close(); } };

    const garageStore = new Store(); const garage = createGarageFlow(garageStore);
    const entry = (await garage.add("chevrolet-equinox-ev-2024", "mine")).vehicles[0];
    const history = createBatteryReportHistory(new Store(), garage);
    const signals = importObdbMode22(signalsetJson);
    const meta = { car: "chevrolet-equinox-ev-2024" as const, dongle: "veepeak-obdcheck-ble" as const, note: "synthetic kept link", writeChar: "fff1", notifyChar: "fff2", mtu: 23 };

    const runs: { run: number; status: string; scanStatus?: string; firstTx: string[] }[] = [];
    for (const run of [1, 2]) {
      const recording = new RecordingBuffer(() => 1); recording.start(meta);
      const outcome = await runAndSaveBatteryDiagnosis({
        entry, transport: runView(kept), recording, scannedAt: `2026-09-28T00:0${String(run)}:00.000Z`,
        keepScan: (_id, _at, jsonl) => { const tx = parseRecording(jsonl).filter((line) => line.dir === "tx").slice(0, 3).map((line) => line.data); runs.push({ run, status: "kept", firstTx: tx }); return `battery-scans/1/synthetic-${String(run)}.jsonl`; },
        history, importedSignals: signals, getInterruption: () => undefined, onProgress: () => undefined,
      });
      expect(outcome.status).toBe("saved");
      const row = runs[runs.length - 1]; row.status = outcome.status;
      if (outcome.status === "saved") row.scanStatus = outcome.report.scanStatus;
    }
    expect(runs.map((row) => row.firstTx[0])).toEqual(["ATZ\r", "ATZ\r"]);
    expect(underlyingCloses).toBe(0);
    expect(await history.list(entry.id)).toHaveLength(2);
    write("/tmp/x-persistent-dongle-kept-link.json", `${JSON.stringify({ synthetic: true, fixture: "fixtures/synthetic/battery-diagnosis-full-scan.jsonl x2", runs, underlyingCloseCount: underlyingCloses, savedReports: 2 }, null, 2)}\n`);
  });
});
