import type { BleManager } from "react-native-ble-plx";
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
import type { BleConnection } from "../ble/BleTransport.js";
import type { StreamTargets } from "../chargeLogger.js";
import { createChargeRunRecord } from "../chargeRun.js";
import { createBatteryReportHistory } from "../batteryReports.js";
import { batteryReportsDocumentStore } from "../batteryReportsDocumentStore.js";
import type { RunFile, SaveTargets } from "../runFiles.js";
import { garageDocumentStore } from "../garage/documentStore.js";
import { createGarageFlow } from "../garage/flow.js";

// The app's one-per-JS-runtime objects, moved verbatim from App.tsx (X-2026-09-28-app-redesign Stage A).

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

const NOTIFICATION_INTERVAL_MS = 30_000; // spec T2.4 B2: the notification text changes at most every 30 s
const CAPTURES = "captures"; // T0.9b: the private copy directory under Paths.document
const COPY_CHUNK_BYTES = 1 << 20; // a charge log is tens of MB; never read it into one string

// docs/specs/T0.9b-one-and-done-captures.md: a private copy under captures/, then the SAF folder picked once, else the share sheet.
// T2.4 B2 adds the charge log's streaming save (StreamTargets): append to the private file, then a chunked copy to the folder.
const phoneTargets: SaveTargets & StreamTargets = {
  keep(file) {
    const dir = new Directory(Paths.document, CAPTURES);
    dir.create({ intermediates: true, idempotent: true });
    const base = localFilename(file.slug, file.extension); const stem = base.slice(0, -file.extension.length);
    let suffix = 1; let kept = new File(dir, base);
    while (kept.exists) { suffix++; kept = new File(dir, `${stem}-${String(suffix)}${file.extension}`); }
    kept.create(); // throws if the file exists; never overwrite a capture
    kept.write(file.content);
    return kept.name;
  },
  async folder() {
    const remembered = captureFolderFile();
    let dir: Directory;
    if (remembered.exists) dir = new Directory((await remembered.text()).trim());
    else { dir = await Directory.pickDirectoryAsync(); remembered.write(dir.uri); }
    // SAF content:// folders take createFile; File.create does not work there.
    return { write: (name, file) => { dir.createFile(name, file.mimeType).write(file.content); } };
  },
  forgetFolder() {
    // A failed delete is ignored: the next folder write fails again and falls back to the share sheet.
    try { const remembered = captureFolderFile(); if (remembered.exists) remembered.delete(); } catch { /* see above */ }
  },
  share: (name, file) => Sharing.shareAsync(new File(Paths.document, CAPTURES, name).uri, { mimeType: file.mimeType, dialogTitle: DIALOG_TITLES[file.slug] }),
  create() {
    const dir = new Directory(Paths.document, CAPTURES);
    dir.create({ intermediates: true, idempotent: true });
    const stem = `${localDate()}-charge-log`;
    let suffix = 1; let kept = new File(dir, `${stem}.jsonl`);
    while (kept.exists) { suffix++; kept = new File(dir, `${stem}-${String(suffix)}.jsonl`); }
    kept.create(); // throws if the file exists; never overwrite a capture
    return kept.name;
  },
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

// A charge log whose folder copy failed offers its private copy once, the next time the app is in the foreground.
// share() only reads the file's name, MIME type and slug (the dialog title for a JSONL recording); content is unused.
let deferredShare: string | undefined;
const shareDeferred = () => {
  const name = deferredShare;
  if (name === undefined || AppState.currentState !== "active") return;
  deferredShare = undefined;
  void phoneTargets.share(name, { slug: "phone-console", extension: ".jsonl", mimeType: "application/x-ndjson", content: "" }).catch(() => undefined);
};
AppState.addEventListener("change", shareDeferred);
// An imported binding is read-only, so the console sets deferredShare through this.
const deferShare = (name: string) => { deferredShare = name; shareDeferred(); };

// Decision 20: one record per JS runtime, so a console recreated with the activity still sees and stops the run.
const chargeRun = createChargeRunRecord<BleConnection, BleManager>();

// T2.9 Stage D: exactly one outbox per JS runtime; its loaded state, single drain and stop count rely on that.
// EXPO_PUBLIC_BETA_URL is inlined by Metro from the gitignored apps/mobile/.env; unset, queued files wait on the phone.
const betaOutbox = createBetaOutbox({
  files: betaPhoneFiles,
  backend: createBetaClient(String(process.env.EXPO_PUBLIC_BETA_URL ?? ""), { fetch, putFile }),
  newId: () => uuid.v4(),
  nowS: () => Date.now() / 1000,
  month: () => localDate().slice(0, 7),
  appVersion: appJson.expo.version,
});
/** Queues a finished run's recording and starts sending it; returns the run's beta sentence. */
const queueForBeta = async (...args: Parameters<typeof betaOutbox.queue>) => {
  const sentence = await betaOutbox.queue(...args);
  void betaOutbox.drain();
  return sentence;
};

// ADR-021: the Android foreground service behind a small interface; the arguments are the T2.4 B2 ones, unchanged.
const foregroundService = {
  start: (task: () => Promise<void>): Promise<void> => BackgroundService.start(task, { taskName: "charge-log", taskTitle: "Charge log running", taskDesc: "Starting the charge log.", taskIcon: { name: "ic_launcher", type: "mipmap" }, foregroundServiceType: ["connectedDevice"] }),
  update: (text: string): Promise<void> => BackgroundService.updateNotification({ taskDesc: text }),
  stop: (): Promise<void> => BackgroundService.stop(),
};

export { localDate, requestBlePermission, garageFlow, batteryHistory, equinoxSignals, NOTIFICATION_INTERVAL_MS, phoneTargets, deferShare, chargeRun, betaOutbox, queueForBeta, foregroundService };
