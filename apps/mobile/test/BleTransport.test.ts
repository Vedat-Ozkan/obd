/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";
import { fromByteArray, toByteArray } from "base64-js";
import { connectVeepeak, scanDevices, VEEPEAK_SERVICE_UUID } from "../src/ble/BleTransport.js";

// Mocked react-native-ble-plx objects only; no Bluetooth hardware is loaded.
const fff1 = "0000fff1-0000-1000-8000-00805f9b34fb"; const fff2 = "0000fff2-0000-1000-8000-00805f9b34fb";
const fff3 = "0000fff3-0000-1000-8000-00805f9b34fb"; const otherService = "0000180a-0000-1000-8000-00805f9b34fb";
const props = { isWritableWithoutResponse: false, isWritableWithResponse: false, isNotifiable: false, isIndicatable: false };
// Reversed relative to the "FFF1 write / FFF2 notify" folklore: roles must come from properties.
const reversedChars = [{ uuid: fff1, ...props, isNotifiable: true }, { uuid: fff2, ...props, isWritableWithoutResponse: true }];

function fakeDevice(mtu = 185, chars: object[] = reversedChars, services?: object[]) {
  let listener: ((error: Error | null, characteristic: { value: string | null } | null) => void) | undefined;
  const writes: string[] = []; const order: string[] = [];
  const remove = vi.fn();
  const device: any = {
    id: "id", name: "Veepeak", mtu,
    discoverAllServicesAndCharacteristics: vi.fn(async () => { order.push("discover"); return device; }),
    services: vi.fn(async () => services ?? [{ uuid: VEEPEAK_SERVICE_UUID, characteristics: async () => chars }]),
    requestMTU: vi.fn(async () => device),
    monitorCharacteristicForService: vi.fn((_s: string, _c: string, cb: typeof listener) => { listener = cb; return { remove }; }),
    writeCharacteristicWithoutResponseForService: vi.fn(async (_s: string, _c: string, value: string) => { writes.push(value); }),
    writeCharacteristicWithResponseForService: vi.fn(async (_s: string, _c: string, value: string) => { writes.push(value); }),
    cancelConnection: vi.fn(async () => device),
  };
  const manager: any = { connectToDevice: vi.fn(async () => { order.push("connect"); return device; }) };
  return { device, manager, writes, order, remove, emit: (value: string | null) => listener?.(null, { value }), error: (error: Error) => listener?.(error, null) };
}

describe("scanDevices", () => {
  it("scans without a filter, de-duplicates IDs, updates name/RSSI, and stops", () => {
    let callback: any; const manager: any = { startDeviceScan: vi.fn(async (_u: unknown, _o: unknown, cb: unknown) => { callback = cb; }), stopDeviceScan: vi.fn(async () => undefined) };
    const onDevice = vi.fn(); const onError = vi.fn(); const stop = scanDevices(manager, onDevice, onError);
    expect(manager.startDeviceScan.mock.calls[0][0]).toBeNull();
    callback(null, { id: "a", name: "one", rssi: -50 });
    callback(null, { id: "a", name: "one", rssi: -50 });
    callback(null, { id: "a", name: null, rssi: -40 });
    callback(null, { id: "b", name: null, rssi: null });
    expect(onDevice.mock.calls.map((call) => call[0])).toEqual([{ id: "a", name: "one", rssi: -50 }, { id: "a", name: "one", rssi: -40 }, { id: "b" }]);
    stop(); expect(manager.stopDeviceScan).toHaveBeenCalledOnce(); expect(onError).not.toHaveBeenCalled();
  });

  it("reports scan errors from the listener and from a rejected start", async () => {
    let callback: any; const manager: any = { startDeviceScan: vi.fn(async (_u: unknown, _o: unknown, cb: unknown) => { callback = cb; throw new Error("start failed"); }), stopDeviceScan: vi.fn(async () => undefined) };
    const onDevice = vi.fn(); const onError = vi.fn(); scanDevices(manager, onDevice, onError);
    callback(new Error("scan failed"), null); await Promise.resolve();
    expect(onError.mock.calls.map((call) => (call[0] as Error).message)).toEqual(["scan failed", "start failed"]); expect(onDevice).not.toHaveBeenCalled();
  });
});

describe("connectVeepeak", () => {
  it("connects before discovery and assigns reversed roles by properties", async () => {
    const fake = fakeDevice(); const connection = await connectVeepeak(fake.manager, "id");
    expect(fake.manager.connectToDevice).toHaveBeenCalledWith("id"); expect(fake.order).toEqual(["connect", "discover"]);
    expect(connection).toMatchObject({ deviceId: "id", deviceName: "Veepeak", mtu: 185, writeCharacteristicUuid: fff2, notifyCharacteristicUuid: fff1 });
    expect(fake.device.requestMTU).toHaveBeenCalledWith(185);
    expect(fake.device.monitorCharacteristicForService.mock.calls[0].slice(0, 2)).toEqual([VEEPEAK_SERVICE_UUID, fff1]);
  });

  it("prefers write-without-response and falls back to write-with-response", async () => {
    const both = [{ uuid: fff1, ...props, isWritableWithResponse: true, isNotifiable: true }, { uuid: fff2, ...props, isWritableWithoutResponse: true }];
    const preferred = fakeDevice(185, both); const a = await connectVeepeak(preferred.manager, "id");
    expect(a.writeCharacteristicUuid).toBe(fff2); await a.transport.write(Uint8Array.of(1));
    expect(preferred.device.writeCharacteristicWithoutResponseForService).toHaveBeenCalledOnce(); expect(preferred.device.writeCharacteristicWithResponseForService).not.toHaveBeenCalled();
    const fallback = fakeDevice(185, [{ uuid: fff1, ...props, isIndicatable: true }, { uuid: fff2, ...props, isWritableWithResponse: true }]); const b = await connectVeepeak(fallback.manager, "id");
    expect(b.writeCharacteristicUuid).toBe(fff2); expect(b.notifyCharacteristicUuid).toBe(fff1); await b.transport.write(Uint8Array.of(1));
    expect(fallback.device.writeCharacteristicWithResponseForService).toHaveBeenCalledOnce(); expect(fallback.device.writeCharacteristicWithoutResponseForService).not.toHaveBeenCalled();
  });

  it("accepts only FFF1/FFF2 under FFF0 and reports missing roles with a property summary", async () => {
    const extra = fakeDevice(185, [{ uuid: fff1, ...props, isNotifiable: true }, { uuid: fff3, ...props, isWritableWithoutResponse: true }]);
    await expect(connectVeepeak(extra.manager, "id")).rejects.toThrow(`${fff1}: writeWithoutResponse=false, writeWithResponse=false, notify=true, indicate=false`);
    const noWrite = fakeDevice(185, [{ uuid: fff1, ...props, isNotifiable: true }, { uuid: fff2, ...props }]);
    await expect(connectVeepeak(noWrite.manager, "id")).rejects.toThrow(/missing or ambiguous.*fff2.*writeWithoutResponse=false/);
    const wrongService = fakeDevice(185, reversedChars, [{ uuid: otherService, characteristics: async () => reversedChars }]);
    await expect(connectVeepeak(wrongService.manager, "id")).rejects.toThrow("was not found");
  });

  it("cancels the connection exactly once and rethrows the original error when setup fails", async () => {
    const missingService = fakeDevice(185, reversedChars, [{ uuid: otherService, characteristics: async () => reversedChars }]);
    const discoveryFails = fakeDevice(); discoveryFails.device.discoverAllServicesAndCharacteristics.mockRejectedValue(new Error("discovery failed"));
    const missingRole = fakeDevice(185, [{ uuid: fff1, ...props, isNotifiable: true }, { uuid: fff2, ...props }]);
    const ambiguousNotify = fakeDevice(185, [{ uuid: fff1, ...props, isNotifiable: true }, { uuid: fff2, ...props, isWritableWithoutResponse: true, isIndicatable: true }]);
    const cases: [ReturnType<typeof fakeDevice>, RegExp][] = [[missingService, /was not found/], [discoveryFails, /^discovery failed$/], [missingRole, /missing or ambiguous/], [ambiguousNotify, /missing or ambiguous/]];
    for (const [fake, message] of cases) {
      await expect(connectVeepeak(fake.manager, "id")).rejects.toThrow(message);
      expect(fake.device.cancelConnection).toHaveBeenCalledOnce();
    }
  });
});

describe("BleTransport", () => {
  it("chunks 400 bytes as 182/182/36 at MTU 185, preserving order", async () => {
    const fake = fakeDevice(); const connection = await connectVeepeak(fake.manager, "id");
    const bytes = Uint8Array.from({ length: 400 }, (_, index) => index % 256); await connection.transport.write(bytes);
    const chunks = fake.writes.map((value) => toByteArray(value)); expect(chunks.map((chunk) => chunk.length)).toEqual([182, 182, 36]);
    expect(Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))).toEqual(bytes);
  });

  it("falls back to the reported MTU 23 when the request rejects and chunks 41 bytes as 20/20/1", async () => {
    const fake = fakeDevice(23); fake.device.requestMTU.mockRejectedValue(new Error("no")); const connection = await connectVeepeak(fake.manager, "id");
    expect(connection.mtu).toBe(23);
    const bytes = Uint8Array.from({ length: 41 }, (_, index) => index); await connection.transport.write(bytes);
    const chunks = fake.writes.map((value) => toByteArray(value)); expect(chunks.map((chunk) => chunk.length)).toEqual([20, 20, 1]);
    expect(Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))).toEqual(bytes);
  });

  it("delivers each notification byte-exactly as its own callback; errors go only to onError; unsubscribe works", async () => {
    const fake = fakeDevice(); const connection = await connectVeepeak(fake.manager, "id");
    const data = vi.fn(); const errors = vi.fn(); const unsubscribe = connection.transport.onData(data); connection.transport.onError(errors);
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    fake.emit(fromByteArray(all.slice(0, 100))); fake.emit(fromByteArray(all.slice(100))); fake.emit(null);
    expect(data.mock.calls.map((call) => call[0])).toEqual([all.slice(0, 100), all.slice(100)]);
    fake.error(new Error("notify")); expect(errors).toHaveBeenCalledOnce(); expect(data).toHaveBeenCalledTimes(2);
    unsubscribe(); fake.emit(fromByteArray(Uint8Array.of(1))); expect(data).toHaveBeenCalledTimes(2);
  });

  it("close removes the monitor, cancels once, ignores late callbacks, and rejects later writes", async () => {
    const fake = fakeDevice(); const connection = await connectVeepeak(fake.manager, "id");
    const data = vi.fn(); const errors = vi.fn(); connection.transport.onData(data); connection.transport.onError(errors);
    await connection.transport.close(); await connection.transport.close();
    expect(fake.remove).toHaveBeenCalledOnce(); expect(fake.device.cancelConnection).toHaveBeenCalledOnce();
    fake.emit(fromByteArray(Uint8Array.of(0x3e))); fake.error(new Error("late")); expect(data).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
    await expect(connection.transport.write(Uint8Array.of(1))).rejects.toThrow("closed"); expect(fake.writes).toEqual([]);
  });
});
