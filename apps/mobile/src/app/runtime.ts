import { BleManager } from "react-native-ble-plx";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import BackgroundService from "react-native-background-actions";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { uuid } from "expo-modules-core";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import appJson from "../../app.json";
import { createBetaClient } from "../beta/client.js";
import { createBetaOutbox } from "../beta/outbox.js";
import { betaPhoneFiles, putFile } from "../beta/phoneStore.js";
import { connectVeepeak, type BleConnection } from "../ble/BleTransport.js";
import { createDongleLink, createDongleMemory } from "../ble/dongleLink.js";
import type { StreamTargets } from "../chargeLogger.js";
import { createChargeRunRecord } from "../chargeRun.js";
import { createBatteryReportHistory } from "../batteryReports.js";
import { batteryReportsDocumentStore } from "../batteryReportsDocumentStore.js";
import type { RunFile, SaveTargets } from "../runFiles.js";
import { garageDocumentStore } from "../garage/documentStore.js";
import { createGarageFlow, type TextStore } from "../garage/flow.js";
import { parseThemePreference, type ThemePreference } from "../ui/text.js";

function localDate(): string {
  const date = new Date();
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localFilename(slug: string, extension: string): string {
  return `${localDate()}-${slug}${extension}`;
}

async function requestBlePermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const permissions = Platform.Version >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
}

const garageFlow = createGarageFlow(garageDocumentStore);
const batteryHistory = createBatteryReportHistory(batteryReportsDocumentStore, garageFlow);
const equinoxSignals = importObdbMode22(signalsetJson);

const DIALOG_TITLES: Record<RunFile["slug"], string> = { "phone-console": "Export OBD recording", "codes-report": "Share codes report" };
const captureFolderFile = () => new File(Paths.document, "capture-folder.txt");

const NOTIFICATION_INTERVAL_MS = 30_000;
const CAPTURES = "captures";
const COPY_CHUNK_BYTES = 1 << 20;

function createCapture(stem: string): string {
  const dir = new Directory(Paths.document, CAPTURES);
  dir.create({ intermediates: true, idempotent: true });
  const base = `${localDate()}-${stem}`;
  let suffix = 1; let kept = new File(dir, `${base}.jsonl`);
  while (kept.exists) { suffix++; kept = new File(dir, `${base}-${String(suffix)}.jsonl`); }
  kept.create();
  return kept.name;
}

const phoneTargets: SaveTargets & StreamTargets = {
  keep(file) {
    const dir = new Directory(Paths.document, CAPTURES);
    dir.create({ intermediates: true, idempotent: true });
    const base = localFilename(file.slug, file.extension); const stem = base.slice(0, -file.extension.length);
    let suffix = 1; let kept = new File(dir, base);
    while (kept.exists) { suffix++; kept = new File(dir, `${stem}-${String(suffix)}${file.extension}`); }
    kept.create();
    kept.write(file.content);
    return kept.name;
  },
  async folder() {
    const remembered = captureFolderFile();
    let dir: Directory;
    if (remembered.exists) dir = new Directory((await remembered.text()).trim());
    else { dir = await Directory.pickDirectoryAsync(); remembered.write(dir.uri); }
    return { write: (name, file) => { dir.createFile(name, file.mimeType).write(file.content); } };
  },
  forgetFolder() {
    try { const remembered = captureFolderFile(); if (remembered.exists) remembered.delete(); } catch { }
  },
  share: (name, file) => Sharing.shareAsync(new File(Paths.document, CAPTURES, name).uri, { mimeType: file.mimeType, dialogTitle: DIALOG_TITLES[file.slug] }),
  create: () => createCapture("charge-log"),
  append(name, text) { new File(Paths.document, CAPTURES, name).write(text, { append: true }); },
  async copyToFolder(name) {
    const remembered = captureFolderFile();
    if (!remembered.exists) throw new Error("no capture folder is remembered");
    const dir = new Directory((await remembered.text()).trim());
    const source = new File(Paths.document, CAPTURES, name).open(FileMode.ReadOnly);
    try {
      const target = dir.createFile(name, "application/x-ndjson").open(FileMode.Append);
      try { for (let chunk = source.readBytes(COPY_CHUNK_BYTES); chunk.length > 0; chunk = source.readBytes(COPY_CHUNK_BYTES)) target.writeBytes(chunk); }
      finally { target.close(); }
    } finally { source.close(); }
  },
};

const driveTargets: StreamTargets = { create: () => createCapture("test-drive"), append: (name, text) => { phoneTargets.append(name, text); }, copyToFolder: (name) => phoneTargets.copyToFolder(name) };

let deferredShare: string | undefined;
const shareDeferred = () => {
  const name = deferredShare;
  if (name === undefined || AppState.currentState !== "active") return;
  deferredShare = undefined;
  void phoneTargets.share(name, { slug: "phone-console", extension: ".jsonl", mimeType: "application/x-ndjson", content: "" }).catch(() => undefined);
};
AppState.addEventListener("change", shareDeferred);
const deferShare = (name: string) => { deferredShare = name; shareDeferred(); };

const chargeRun = createChargeRunRecord<BleConnection>();

let manager: BleManager | undefined;
const bleManager = (): BleManager => (manager ??= new BleManager());
const dongleLink = createDongleLink<BleConnection>({
  connect: (deviceId) => connectVeepeak(bleManager(), deviceId),
  onDisconnected: (deviceId, listener) => bleManager().onDeviceDisconnected(deviceId, (error) => { listener(error); }),
});
const dongleStore: TextStore = {
  async read() { const file = new File(Paths.document, "dongles.json"); return file.exists ? file.text() : undefined; },
  write(text) { new File(Paths.document, "dongles.json").write(text); return Promise.resolve(); },
};
const dongleMemory = createDongleMemory(dongleStore);

const betaOutbox = createBetaOutbox({
  files: betaPhoneFiles,
  backend: createBetaClient(String(process.env.EXPO_PUBLIC_BETA_URL ?? ""), { fetch, putFile }),
  newId: () => uuid.v4(),
  nowS: () => Date.now() / 1000,
  month: () => localDate().slice(0, 7),
  appVersion: appJson.expo.version,
});
const queueForBeta = async (...args: Parameters<typeof betaOutbox.queue>) => {
  const sentence = await betaOutbox.queue(...args);
  void betaOutbox.drain();
  return sentence;
};

const foregroundService = {
  start: (task: () => Promise<void>, title = "Charge log running", desc = "Starting the charge log."): Promise<void> => BackgroundService.start(task, { taskName: "charge-log", taskTitle: title, taskDesc: desc, taskIcon: { name: "ic_launcher", type: "mipmap" }, foregroundServiceType: ["connectedDevice"] }),
  update: (text: string): Promise<void> => BackgroundService.updateNotification({ taskDesc: text }),
  stop: (): Promise<void> => BackgroundService.stop(),
};

const themeFile = () => new File(Paths.document, "theme.txt");
const loadThemePreference = async (): Promise<ThemePreference> => {
  try { const file = themeFile(); return parseThemePreference(file.exists ? await file.text() : undefined); } catch { return "system"; }
};
const saveThemePreference = (preference: ThemePreference) => {
  try { themeFile().write(preference); } catch { }
};

const folderLabel = async (): Promise<string | undefined> => {
  const remembered = captureFolderFile();
  return remembered.exists ? new Directory((await remembered.text()).trim()).name : undefined;
};

export { localDate, requestBlePermission, garageFlow, batteryHistory, equinoxSignals, NOTIFICATION_INTERVAL_MS, phoneTargets, driveTargets, deferShare, chargeRun, bleManager, dongleLink, dongleMemory, betaOutbox, queueForBeta, foregroundService, loadThemePreference, saveThemePreference, folderLabel };
