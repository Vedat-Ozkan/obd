import { fromByteArray, toByteArray } from "base64-js";
import type { BleManager, Device } from "react-native-ble-plx";
import type { Transport } from "obd-core/transport";

export const VEEPEAK_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
export const VEEPEAK_CHARACTERISTIC_UUIDS: readonly string[] = ["0000fff1-0000-1000-8000-00805f9b34fb", "0000fff2-0000-1000-8000-00805f9b34fb"];
export const REQUESTED_MTU = 185;

export interface ScannedDevice { id: string; name?: string; rssi?: number }

export function scanDevices(manager: BleManager, onDevice: (device: ScannedDevice) => void, onError: (error: Error) => void): () => void {
  const devices = new Map<string, ScannedDevice>();
  // No service filter: the dongle is not assumed to advertise FFF0.
  manager.startDeviceScan(null, null, (error, device) => {
    if (error) { onError(error); return; }
    if (!device) return;
    const previous = devices.get(device.id);
    const name = device.name ?? previous?.name;
    const rssi = device.rssi ?? previous?.rssi;
    if (previous && previous.name === name && previous.rssi === rssi) return;
    const scanned: ScannedDevice = { id: device.id, ...(name === undefined ? {} : { name }), ...(rssi === undefined ? {} : { rssi }) };
    devices.set(scanned.id, scanned);
    onDevice(scanned);
  }).catch((error: unknown) => { onError(error instanceof Error ? error : new Error(String(error))); });
  return () => { void manager.stopDeviceScan(); };
}

export interface BleConnection { transport: BleTransport; deviceId: string; deviceName?: string; mtu: number; writeCharacteristicUuid: string; notifyCharacteristicUuid: string }

const normalizeUuid = (uuid: string) => uuid.toLowerCase();

export async function connectVeepeak(manager: BleManager, deviceId: string): Promise<BleConnection> {
  const connected = await manager.connectToDevice(deviceId);
  try {
    return await setUpVeepeak(connected);
  } catch (error) {
    // Leaving the dongle GATT-connected stops it advertising and leaves the app nothing to disconnect.
    try { await connected.cancelConnection(); } catch { /* the setup error is the one to report */ }
    throw error;
  }
}

async function setUpVeepeak(connected: Device): Promise<BleConnection> {
  let device = await connected.discoverAllServicesAndCharacteristics();
  const service = (await device.services()).find((item) => normalizeUuid(item.uuid) === VEEPEAK_SERVICE_UUID);
  if (!service) throw new Error(`Veepeak service ${VEEPEAK_SERVICE_UUID} was not found`);
  const candidates = (await service.characteristics()).filter((item) => VEEPEAK_CHARACTERISTIC_UUIDS.includes(normalizeUuid(item.uuid)));
  const withoutResponse = candidates.filter((item) => item.isWritableWithoutResponse);
  const withResponse = candidates.filter((item) => item.isWritableWithResponse);
  const notify = candidates.filter((item) => item.isNotifiable || item.isIndicatable);
  // More than one write-without-response candidate is ambiguous; it must not fall through to write-with-response.
  const write = withoutResponse.length === 1 ? withoutResponse[0] : withoutResponse.length === 0 && withResponse.length === 1 ? withResponse[0] : undefined;
  if (!write || notify.length !== 1) {
    const summary = candidates.map((item) => `${item.uuid}: writeWithoutResponse=${String(item.isWritableWithoutResponse)}, writeWithResponse=${String(item.isWritableWithResponse)}, notify=${String(item.isNotifiable)}, indicate=${String(item.isIndicatable)}`).join("; ");
    throw new Error(`Veepeak GATT roles are missing or ambiguous: ${summary || "no FFF1/FFF2 characteristics"}`);
  }
  const notifyCharacteristic = notify[0];
  try { device = await device.requestMTU(REQUESTED_MTU); } catch { /* reported MTU remains the fallback */ }
  const transport = new BleTransport(device, service.uuid, write.uuid, notifyCharacteristic.uuid, write.isWritableWithoutResponse);
  return { transport, deviceId: device.id, ...(device.name ? { deviceName: device.name } : {}), mtu: device.mtu, writeCharacteristicUuid: write.uuid, notifyCharacteristicUuid: notifyCharacteristic.uuid };
}

export class BleTransport implements Transport {
  private closed = false;
  private readonly dataCallbacks = new Set<(bytes: Uint8Array) => void>();
  private readonly errorCallbacks = new Set<(error: Error) => void>();
  private readonly monitor;

  constructor(private readonly device: Device, private readonly serviceUuid: string, private readonly writeUuid: string, notifyUuid: string, private readonly withoutResponse: boolean) {
    this.monitor = device.monitorCharacteristicForService(serviceUuid, notifyUuid, (error, characteristic) => {
      if (this.closed) return;
      if (error) { this.errorCallbacks.forEach((callback) => { callback(error); }); return; }
      if (characteristic?.value !== null && characteristic?.value !== undefined) {
        const bytes = new Uint8Array(toByteArray(characteristic.value));
        this.dataCallbacks.forEach((callback) => { callback(bytes); });
      }
    });
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("BLE transport is closed");
    const size = Math.max(1, this.device.mtu - 3);
    for (let offset = 0; offset < bytes.length; offset += size) {
      const value = fromByteArray(bytes.slice(offset, offset + size));
      if (this.withoutResponse) await this.device.writeCharacteristicWithoutResponseForService(this.serviceUuid, this.writeUuid, value);
      else await this.device.writeCharacteristicWithResponseForService(this.serviceUuid, this.writeUuid, value);
    }
  }

  onData(callback: (bytes: Uint8Array) => void): () => void { this.dataCallbacks.add(callback); return () => { this.dataCallbacks.delete(callback); }; }
  onError(callback: (error: Error) => void): () => void { this.errorCallbacks.add(callback); return () => { this.errorCallbacks.delete(callback); }; }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.monitor.remove();
    this.dataCallbacks.clear(); this.errorCallbacks.clear();
    await this.device.cancelConnection();
  }
}
