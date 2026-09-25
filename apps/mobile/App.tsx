import { BleManager } from "react-native-ble-plx";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import type { Transport } from "obd-core/transport";
import { importObdbMode22 } from "obd-core/vehicles";
import signalsetJson from "obd-core/vehicles/equinox-signalset";
import { renderBatteryDiagnosis, type BatteryDiagnosisReport } from "obd-battery/report";
import { Button, FlatList, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { connectVeepeak, scanDevices, type BleConnection, type ScannedDevice } from "./src/ble/BleTransport.js";
import { runCapture } from "./src/capture.js";
import { runAndSaveBatteryDiagnosis } from "./src/batteryDiagnosisFlow.js";
import { createBatteryReportHistory } from "./src/batteryReports.js";
import { batteryReportsDocumentStore, keepPrivateBatteryScan } from "./src/batteryReportsDocumentStore.js";
import { batteryReportRows, removeGarageVehicleWithReports } from "./src/batteryScan.js";
import { CODES_SCAN_COMMANDS, codesScanStop } from "./src/codesScan.js";
import { ConsoleSession } from "./src/console.js";
import { RecordingBuffer } from "./src/recording.js";
import { finishRun, type RunFile, type SaveTargets } from "./src/runFiles.js";
import { SUPPORTED_VEHICLES, canUseEquinoxConsole, vehicleAvailability, vehicleEvidence, type CatalogVehicle } from "./src/garage/catalog.js";
import { garageDocumentStore } from "./src/garage/documentStore.js";
import { LOCAL_INTEREST_NOTICE, createGarageFlow, type GarageState, type GarageVehicle, type Interest, type Ownership } from "./src/garage/flow.js";

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

// Explicit colors per scheme: without them, Android dark mode draws default dark text on the dark system background.
const palettes = {
  light: { background: "#FFFFFF", text: "#111111", muted: "#555555", border: "#767676", inputBackground: "#FFFFFF", inputText: "#111111", placeholder: "#595959", consoleBackground: "#F4F4F4", consoleText: "#000000", buttonBackground: "#005A9C" },
  dark: { background: "#121212", text: "#EDEDED", muted: "#B3B3B3", border: "#8A8A8A", inputBackground: "#1E1E1E", inputText: "#EDEDED", placeholder: "#A0A0A0", consoleBackground: "#000000", consoleText: "#E6E6E6", buttonBackground: "#005A9C" },
};

function EquinoxConsole({ vehicle, entry, onBack, onSaved }: { vehicle: CatalogVehicle; entry: GarageVehicle; onBack: () => void; onSaved: (report: BatteryDiagnosisReport) => Promise<void> }) {
  const colors = palettes[useColorScheme() === "dark" ? "dark" : "light"];
  const inputColors = { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.inputText };
  const [manager] = useState(() => new BleManager());
  const [recording] = useState(() => new RecordingBuffer());
  const [connection, setConnection] = useState<BleConnection>();
  const connectionRef = useRef<BleConnection | undefined>(undefined);
  const session = useRef<ConsoleSession | undefined>(undefined);
  // Manual Send uses its own unsaved session: two sessions on one transport would both record every rx.
  const debugSession = useRef<ConsoleSession | undefined>(undefined);
  const stopScan = useRef<(() => void) | undefined>(undefined);
  const disconnectSubscription = useRef<{ remove: () => void } | undefined>(undefined);
  const [permitted, setPermitted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [status, setStatus] = useState("Requesting Bluetooth permission…");
  // Prefilled so Run capture is one tap (T0.8d Decision 4); the owner can edit it and must never type a VIN.
  const [note, setNote] = useState("Equinox Ready, Park; one-button capture");
  const [diagnosisReady, setDiagnosisReady] = useState(false);
  const [command, setCommand] = useState("0100");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  // The capture's async closure sees stale React state; teardown's freeze is read from here instead.
  const frozenRef = useRef<string | undefined>(undefined);
  const [capturing, setCapturing] = useState(false);
  const [captureStep, setCaptureStep] = useState("");
  const [captureLast, setCaptureLast] = useState("");
  const [report, setReport] = useState<string>();
  const [diagnosing, setDiagnosing] = useState(false);
  const diagnosingRef = useRef(false);
  const diagnosisScanActive = useRef(false);
  const diagnosisInterruption = useRef<"cancelled" | "disconnected" | undefined>(undefined);
  const diagnosisCloseExpected = useRef(false);
  const [canCancelDiagnosis, setCanCancelDiagnosis] = useState(false);

  // A session exists only while a run records, so closing it freezes the buffer: no rx lands after the run or a disconnect.
  const endRecording = (): string | undefined => {
    if (!session.current) return undefined;
    session.current.close(); session.current = undefined;
    const jsonl = recording.toJsonl(); frozenRef.current = jsonl;
    return jsonl;
  };
  const closeDebugSession = () => { debugSession.current?.close(); debugSession.current = undefined; };
  const teardown = (message: string) => {
    if (diagnosingRef.current) {
      if (diagnosisScanActive.current && !diagnosisInterruption.current && !diagnosisCloseExpected.current) {
        diagnosisInterruption.current = "disconnected";
        diagnosisScanActive.current = false;
        setCanCancelDiagnosis(false);
      }
      const active = connectionRef.current; connectionRef.current = undefined; setConnection(undefined);
      void active?.transport.close().catch(() => undefined);
      if (diagnosisInterruption.current === "disconnected") setStatus(`${message} Keeping the private battery scan…`);
      return;
    }
    disconnectSubscription.current?.remove(); disconnectSubscription.current = undefined;
    // A file cut short by a disconnect says why.
    if (session.current) recording.meta(message);
    endRecording(); closeDebugSession();
    setTranscript((current) => [...current, `-- ${message}`]);
    const active = connectionRef.current; connectionRef.current = undefined; setConnection(undefined);
    void active?.transport.close().catch(() => undefined);
    setStatus(message);
  };

  useEffect(() => {
    void requestBlePermission().then((granted) => {
      setPermitted(granted);
      setStatus(granted ? "Bluetooth permission granted. Scan for the Veepeak." : "Bluetooth permission was denied; scanning is disabled. Grant it in Android settings and reopen the app.");
    }, (error: unknown) => { setStatus(`Permission error: ${error instanceof Error ? error.message : String(error)}`); });
    return () => {
      stopScan.current?.(); disconnectSubscription.current?.remove(); session.current?.close(); debugSession.current?.close();
      void connectionRef.current?.transport.close().catch(() => undefined); void manager.destroy();
    };
  }, [manager]);

  const startScan = () => {
    setDevices([]); setStatus("Scanning for BLE devices…");
    const seen = new Map<string, ScannedDevice>();
    stopScan.current?.();
    stopScan.current = scanDevices(manager, (device) => { seen.set(device.id, device); setDevices([...seen.values()]); }, (error) => { setStatus(`Scan error: ${error.message}`); });
  };
  const connect = async (device: ScannedDevice) => {
    setConnecting(true);
    try {
      stopScan.current?.(); stopScan.current = undefined; setStatus(`Connecting to ${device.name ?? device.id}…`);
      const next = await connectVeepeak(manager, device.id);
      connectionRef.current = next; setConnection(next);
      next.transport.onError((error) => { setStatus(`Notification error: ${error.message}`); });
      disconnectSubscription.current = manager.onDeviceDisconnected(next.deviceId, (error) => { teardown(`Disconnected${error ? `: ${error.message}` : ""}.`); });
      setStatus("Connected.");
    } catch (error) { setStatus(`Connection error: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setConnecting(false); }
  };
  const startRecording = (): ConsoleSession | undefined => {
    if (!canUseEquinoxConsole(vehicle)) { setStatus("Equinox console unavailable for this model year."); return undefined; }
    if (!connection || !note.trim()) { setStatus("Connect and enter a non-empty vehicle-state note before recording."); return undefined; }
    recording.start({ car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note: note.trim(), writeChar: connection.writeCharacteristicUuid, notifyChar: connection.notifyCharacteristicUuid, mtu: connection.mtu });
    // A fresh session per recording: its reader starts empty and every notification lands in the started buffer.
    session.current = new ConsoleSession(connection.transport, recording);
    setTranscript([]); frozenRef.current = undefined; setReport(undefined);
    return session.current;
  };
  const send = async () => {
    if (!connection) return;
    if (!debugSession.current) {
      const scratch = new RecordingBuffer();
      scratch.start({ car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note: "debug send; not saved", writeChar: connection.writeCharacteristicUuid, notifyChar: connection.notifyCharacteristicUuid, mtu: connection.mtu });
      // A new session starts in the unknown state, so its first command must be ATZ or ATI (X-2026-09-24-first-write).
      debugSession.current = new ConsoleSession(connection.transport, scratch);
    }
    const debug = debugSession.current;
    setPending(true);
    try { const response = await debug.send(command); setTranscript((current) => [...current, `> ${command}`, `${response}>`]); }
    catch (error) { setStatus(`Command error: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setPending(false); }
  };
  const capture = async (kind: "recording" | "codes") => {
    if (!canUseEquinoxConsole(vehicle)) { setStatus("Equinox capture unavailable for this model year."); return; }
    closeDebugSession();
    const active = startRecording();
    if (!active) return;
    setCapturing(true); setCaptureStep(""); setCaptureLast(""); setStatus(kind === "codes" ? "Running codes scan…" : "Capturing…");
    let step = 0; let stepCommand = "";
    try {
      const result = await runCapture(active, recording, (progress) => {
        step = progress.step; stepCommand = progress.command;
        if (progress.outcome === undefined) { setCaptureStep(`Step ${String(progress.step)} of ${String(progress.total)}: ${progress.command}`); return; }
        const outcome = progress.outcome;
        setCaptureLast(`Last: ${progress.command} → ${outcome}`);
        const response = progress.response;
        setTranscript((current) => response === undefined ? [...current, `-- ${outcome}`] : [...current, `> ${progress.command}`, `${response}>`]);
      }, kind === "codes" ? { commands: CODES_SCAN_COMMANDS, stopAfter: codesScanStop } : undefined);
      // If teardown already froze the recording, its JSONL is in the ref; an early stop still exports the partial file.
      const jsonl = endRecording() ?? frozenRef.current;
      const summary = result.stoppedEarly === undefined
        ? `Capture complete: ${String(result.sent)} of ${String(result.total)} sent.`
        : `Capture stopped at step ${String(step)} of ${String(result.total)} (${stepCommand}): ${result.stoppedEarly}.`;
      setStatus(summary);
      if (!jsonl) return;
      // Saved before capturing ends, so no new run can replace the buffer while a file is unsaved (the 2026-09-24 loss).
      const outcome = await finishRun(kind, jsonl, { vehicle: `${String(vehicle.year)} ${vehicle.make} ${vehicle.model}`, date: localDate(), result }, phoneTargets);
      setReport(outcome.report); setStatus(`${summary} ${outcome.status}`);
    } finally { setCapturing(false); }
  };

  const diagnose = async () => {
    const active = connectionRef.current;
    if (!active || diagnosingRef.current || capturing || pending || !canUseEquinoxConsole(vehicle)) return;
    closeDebugSession();
    diagnosisInterruption.current = undefined;
    diagnosisCloseExpected.current = false;
    diagnosingRef.current = true; diagnosisScanActive.current = true; setDiagnosing(true); setCanCancelDiagnosis(true);
    const scanRecording = new RecordingBuffer();
    const scannedAt = new Date().toISOString();
    scanRecording.start({ car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note: diagnosisReady ? "battery diagnosis; Ready, Park confirmed in app" : "battery diagnosis; vehicle power state unknown", writeChar: active.writeCharacteristicUuid, notifyChar: active.notifyCharacteristicUuid, mtu: active.mtu });
    const scanTransport: Transport = {
      write: (bytes) => active.transport.write(bytes),
      onData: (callback) => active.transport.onData(callback),
      close: async () => { diagnosisCloseExpected.current = true; await active.transport.close(); },
    };
    try {
      const outcome = await runAndSaveBatteryDiagnosis({ entry, transport: scanTransport, recording: scanRecording, scannedAt, keepScan: keepPrivateBatteryScan, history: batteryHistory, importedSignals: equinoxSignals, getInterruption: () => diagnosisInterruption.current, onProgress: (message) => { if (message === "Keeping private scan") { diagnosisScanActive.current = false; setCanCancelDiagnosis(false); } setStatus(message); } });
      if (outcome.status === "saved") {
        await onSaved(outcome.report);
        setStatus(`Battery diagnosis saved: ${outcome.report.scanStatus}. Reconnect for another run.`);
      } else if (outcome.status === "stopped") {
        setStatus(`${outcome.reason} Private scan: ${outcome.recording}. Reconnect for another run.`);
      } else setStatus(`${outcome.reason} Private scan: ${outcome.recording}. Reconnect for another run.`);
    } catch (cause) {
      setStatus(`Battery diagnosis error: ${cause instanceof Error ? cause.message : String(cause)}. Reconnect before another run.`);
    } finally {
      disconnectSubscription.current?.remove(); disconnectSubscription.current = undefined;
      connectionRef.current = undefined; setConnection(undefined);
      diagnosingRef.current = false; diagnosisScanActive.current = false; diagnosisInterruption.current = undefined; diagnosisCloseExpected.current = false; setDiagnosing(false); setCanCancelDiagnosis(false);
      await active.transport.close().catch(() => undefined);
    }
  };
  const cancelDiagnosis = () => {
    if (!diagnosingRef.current || !diagnosisScanActive.current) return;
    diagnosisInterruption.current = "cancelled";
    diagnosisScanActive.current = false;
    setCanCancelDiagnosis(false);
    setStatus("Cancelling battery diagnosis; keeping the private scan…");
    void connectionRef.current?.transport.close().catch(() => undefined);
  };

  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <Button title="Back to garage" color={colors.buttonBackground} disabled={diagnosing} onPress={onBack} />
    <Text style={{ color: colors.text, fontWeight: "bold" }}>2024 Chevrolet Equinox EV · garage car {entry.id}</Text>
    <Text style={{ color: colors.text }}>{status}</Text>
    <Text style={{ color: colors.muted }}>{connection ? `Connected ${connection.deviceName ?? connection.deviceId}; MTU ${String(connection.mtu)}; write ${connection.writeCharacteristicUuid}; notify ${connection.notifyCharacteristicUuid}` : "Not connected"}</Text>
    <Text style={{ color: colors.text }}>Unplug the OBD dongle from the car after each check. Disconnecting Bluetooth leaves the dongle powered; it can drain the 12 V battery while the vehicle is off.</Text>
    <Button title="Scan" color={colors.buttonBackground} disabled={!permitted || !!connection || connecting || capturing || diagnosing} onPress={startScan} />
    <Button title="Disconnect" color={colors.buttonBackground} disabled={!connection || pending || diagnosing || capturing} onPress={() => { teardown("Disconnected by user."); }} />
    <FlatList data={devices} keyExtractor={(item) => item.id} renderItem={({ item }) => <Button title={`${item.name ?? "Unnamed"} (${item.id}) RSSI ${item.rssi === undefined ? "?" : String(item.rssi)}`} color={colors.buttonBackground} disabled={!!connection || connecting || diagnosing} onPress={() => void connect(item)} />} />
    <TextInput style={[styles.input, inputColors]} value={note} onChangeText={setNote} placeholder="Vehicle-state note" placeholderTextColor={colors.placeholder} editable={!capturing && !diagnosing} />
    <Button title={`Vehicle Ready and in Park for diagnosis: ${diagnosisReady ? "yes" : "unknown"}`} color={colors.buttonBackground} disabled={diagnosing} onPress={() => { setDiagnosisReady((value) => !value); }} />
    <Button title="Run battery diagnosis" color={colors.buttonBackground} disabled={!connection || pending || capturing || diagnosing} onPress={() => void diagnose()} />
    {diagnosing ? <Button title="Cancel battery diagnosis" color={colors.buttonBackground} disabled={!canCancelDiagnosis} onPress={cancelDiagnosis} /> : null}
    <Button title="Run capture" color={colors.buttonBackground} disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing} onPress={() => void capture("recording")} />
    <Button title="Run codes report" color={colors.buttonBackground} disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing} onPress={() => void capture("codes")} />
    {captureStep ? <Text style={{ color: colors.text }}>{captureStep}</Text> : null}
    {captureLast ? <Text style={{ color: colors.muted }}>{captureLast}</Text> : null}
    <TextInput style={[styles.input, inputColors]} value={command} onChangeText={setCommand} placeholder="Read-only command" placeholderTextColor={colors.placeholder} autoCapitalize="characters" editable={!diagnosing} />
    <Button title="Send (not saved)" color={colors.buttonBackground} disabled={!connection || pending || capturing || diagnosing} onPress={() => void send()} />
    {report ? <ScrollView style={[styles.console, { backgroundColor: colors.consoleBackground, borderColor: colors.border }]}><Text style={[styles.consoleText, { color: colors.consoleText }]}>{report}</Text></ScrollView> : null}
    <ScrollView style={[styles.console, { backgroundColor: colors.consoleBackground, borderColor: colors.border }]}>{transcript.map((line, index) => <Text key={index} style={[styles.consoleText, { color: colors.consoleText }]}>{line}</Text>)}</ScrollView>
  </View>;
}

const garageFlow = createGarageFlow(garageDocumentStore);
const batteryHistory = createBatteryReportHistory(batteryReportsDocumentStore, garageFlow);
const equinoxSignals = importObdbMode22(signalsetJson);

const DIALOG_TITLES: Record<RunFile["slug"], string> = { "phone-console": "Export OBD recording", "codes-report": "Share codes report" };
const captureFolderFile = () => new File(Paths.document, "capture-folder.txt");

// docs/specs/T0.9b-one-and-done-captures.md: a private copy under captures/, then the SAF folder picked once, else the share sheet.
const phoneTargets: SaveTargets = {
  keep(file) {
    const dir = new Directory(Paths.document, "captures");
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
  share: (name, file) => Sharing.shareAsync(new File(Paths.document, "captures", name).uri, { mimeType: file.mimeType, dialogTitle: DIALOG_TITLES[file.slug] }),
};

export function App() {
  const colors = palettes[useColorScheme() === "dark" ? "dark" : "light"];
  const [state, setState] = useState<GarageState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"garage" | "picker" | "interest" | "console" | "history" | "detail">("garage");
  const [selectedEntryId, setSelectedEntryId] = useState<string>();
  const [reportCounts, setReportCounts] = useState<Record<string, number>>({});
  const [historyReports, setHistoryReports] = useState<readonly BatteryDiagnosisReport[]>([]);
  const [detail, setDetail] = useState<BatteryDiagnosisReport>();
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<number>();
  const [tag, setTag] = useState<Ownership>("mine");
  const [interest, setInterest] = useState({ make: "", model: "", year: "", joinBeta: false });
  const [interestSaved, setInterestSaved] = useState(false);
  const refreshReports = async (garage: GarageState) => {
    await batteryHistory.load();
    const counts = await Promise.all(garage.vehicles.map(async (entry) => [entry.id, (await batteryHistory.list(entry.id)).length] as const));
    setReportCounts(Object.fromEntries(counts));
  };
  const load = () => { setError(""); void garageFlow.load().then(async (garage) => { await refreshReports(garage); setState(garage); }, (cause: unknown) => { setError(`Saved data load error: ${cause instanceof Error ? cause.message : String(cause)}`); }).catch((cause: unknown) => { setError(`Saved data load error: ${cause instanceof Error ? cause.message : String(cause)}`); }); };
  useEffect(load, []);
  const change = async (action: () => Promise<GarageState>, after?: () => void) => {
    setBusy(true); setError("");
    try { const next = await action(); await refreshReports(next); setState(next); after?.(); }
    catch (cause) { setError(`Garage storage error: ${cause instanceof Error ? cause.message : String(cause)}`); }
    finally { setBusy(false); }
  };
  const title = { color: colors.text, fontWeight: "bold" as const, fontSize: 20 };
  const normal = { color: colors.text };
  const muted = { color: colors.muted };
  const inputColors = { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.inputText };
  const models = [...new Set(SUPPORTED_VEHICLES.filter((item) => item.make === make).map((item) => item.model))];
  const choices = SUPPORTED_VEHICLES.filter((item) => item.make === make && item.model === model);
  const selected: CatalogVehicle | undefined = choices.find((item) => item.year === year);
  const clearPicker = () => { setMake(""); setModel(""); setYear(undefined); setTag("mine"); setView("picker"); };
  const reopenInterest = (saved?: Interest) => {
    setInterest(saved ? { make: saved.make, model: saved.model, year: String(saved.year), joinBeta: saved.joinBeta } : { make: "", model: "", year: "", joinBeta: false });
    setInterestSaved(!!saved); setView("interest");
  };
  const openHistory = async (id: string) => {
    setError("");
    try { const reports = await batteryHistory.list(id); setSelectedEntryId(id); setHistoryReports(reports); setView("history"); }
    catch (cause) { setError(`Battery report history error: ${cause instanceof Error ? cause.message : String(cause)}`); }
  };
  const openSaved = async (report: BatteryDiagnosisReport) => {
    const reports = await batteryHistory.list(report.garageVehicleId);
    const persisted = reports.find((item) => item.scannedAt === report.scannedAt && item.recording === report.recording);
    if (!persisted) throw new Error("Saved diagnosis could not be reopened from private history.");
    await refreshReports(await garageFlow.load());
    setSelectedEntryId(report.garageVehicleId); setDetail(persisted); setView("detail");
  };

  if (!state) return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <Text style={title}>Garage</Text><Text style={normal}>{error || "Loading saved garage…"}</Text>
    {error ? <Button title="Retry garage load" onPress={load} /> : null}
  </View>;

  const selectedEntry = state.vehicles.find((entry) => entry.id === selectedEntryId);
  const consoleVehicle = SUPPORTED_VEHICLES.find((item) => item.id === selectedEntry?.catalogId);
  if (view === "console" && selectedEntry && consoleVehicle && canUseEquinoxConsole(consoleVehicle)) return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <EquinoxConsole vehicle={consoleVehicle} entry={selectedEntry} onBack={() => { setView("garage"); }} onSaved={openSaved} />
  </View>;

  if (view === "detail" && detail && selectedEntry) return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <Button title="Back to report history" onPress={() => { void openHistory(selectedEntry.id); }} />
    {error ? <Text style={{ color: "#B00020" }}>{error}</Text> : null}
    <ScrollView style={[styles.console, { backgroundColor: colors.consoleBackground, borderColor: colors.border }]}><Text style={[styles.consoleText, { color: colors.consoleText }]}>{renderBatteryDiagnosis(detail)}</Text></ScrollView>
  </View>;

  return <ScrollView contentContainerStyle={[styles.garage, { backgroundColor: colors.background }]}>
    <Text style={title}>{view === "garage" ? "Garage" : view === "picker" ? "Add a vehicle" : view === "history" ? `Battery reports for car ${selectedEntryId ?? ""}` : "Unsupported vehicle interest"}</Text>
    {error ? <Text style={{ color: "#B00020" }}>{error}</Text> : null}
    {view !== "garage" ? <Button title="Back to garage" onPress={() => { setView("garage"); }} /> : null}
    {view === "garage" ? <>
      <Text style={muted}>Vehicles and interests are saved privately on this phone.</Text>
      {state.vehicles.length === 0 ? <Text style={normal}>No vehicles yet.</Text> : null}
      {state.vehicles.map((entry) => {
        const vehicle = SUPPORTED_VEHICLES.find((item) => item.id === entry.catalogId);
        if (!vehicle) return null;
        return <View key={entry.id} style={[styles.card, { borderColor: colors.border }]}>
          <Text style={normal}>{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.tier} · {entry.ownership}</Text>
          <Text style={muted}>{vehicleAvailability(vehicle)}</Text>
          <Text style={muted}>Battery reports: {String(reportCounts[entry.id] ?? 0)}</Text>
          <Button title="Report history" disabled={busy} onPress={() => { void openHistory(entry.id); }} />
          <Button title={entry.ownership === "mine" ? "Change to checked" : "Change to mine"} disabled={busy} onPress={() => void change(() => garageFlow.changeOwnership(entry.id, entry.ownership === "mine" ? "checked" : "mine"))} />
          <Button title="Remove" disabled={busy} onPress={() => void change(async () => { await removeGarageVehicleWithReports(garageFlow, batteryHistory, entry.id); return garageFlow.load(); })} />
          {canUseEquinoxConsole(vehicle) ? <Button title="Open battery diagnosis and debug console" disabled={busy} onPress={() => { setSelectedEntryId(entry.id); setView("console"); }} /> : null}
        </View>;
      })}
      <Button title="Add supported vehicle" disabled={busy} onPress={clearPicker} />
      <Button title="My unsupported vehicle" disabled={busy} onPress={() => { reopenInterest(); }} />
      {state.interests.map((saved, index) => <View key={`${saved.make}-${saved.model}-${String(saved.year)}-${String(index)}`} style={[styles.card, { borderColor: colors.border }]}>
        <Text style={normal}>{saved.year} {saved.make} {saved.model} · beta interest {saved.joinBeta ? "yes" : "no"}</Text>
        <Text style={muted}>{LOCAL_INTEREST_NOTICE}</Text>
        <Button title="Reopen saved interest" onPress={() => { reopenInterest(saved); }} />
      </View>)}
    </> : null}
    {view === "history" ? <>
      {historyReports.length === 0 ? <Text style={normal}>No battery reports saved for this car.</Text> : null}
      {batteryReportRows(historyReports).map((row) => <View key={`${row.report.scannedAt}-${row.report.recording}`} style={[styles.card, { borderColor: colors.border }]}>
        <Text style={normal}>{row.label}</Text>
        <Text style={muted}>{row.report.recording}</Text>
        <Button title="Open report" onPress={() => { setDetail(row.report); setView("detail"); }} />
      </View>)}
    </> : null}
    {view === "picker" ? <>
      <Text style={normal}>Choose make</Text>
      {[...new Set(SUPPORTED_VEHICLES.map((item) => item.make))].map((choice) => <Button key={choice} title={`${choice}${make === choice ? " ✓" : ""}`} onPress={() => { setMake(choice); setModel(""); setYear(undefined); }} />)}
      {make ? <Text style={normal}>Choose model</Text> : null}
      {models.map((choice) => <Button key={choice} title={`${choice}${model === choice ? " ✓" : ""}`} onPress={() => { setModel(choice); setYear(undefined); }} />)}
      {model ? <Text style={normal}>Choose model year</Text> : null}
      {choices.map((choice) => <Button key={choice.id} title={`${String(choice.year)}${year === choice.year ? " ✓" : ""}`} onPress={() => { setYear(choice.year); }} />)}
      {selected ? <View style={[styles.card, { borderColor: colors.border }]}>
        <Text style={normal}>{selected.year} {selected.make} {selected.model} · {selected.tier}</Text>
        <Text style={muted}>{vehicleAvailability(selected)}</Text>
        <Text style={muted}>{vehicleEvidence(selected)}</Text>
        <Text style={normal}>Garage tag</Text>
        <Button title={`Mine${tag === "mine" ? " ✓" : ""}`} onPress={() => { setTag("mine"); }} />
        <Button title={`Checked${tag === "checked" ? " ✓" : ""}`} onPress={() => { setTag("checked"); }} />
        <Button title="Add to garage" disabled={busy} onPress={() => void change(() => garageFlow.add(selected.id, tag), () => { setView("garage"); })} />
      </View> : null}
      <Button title="My make, model, or year is not listed" onPress={() => { reopenInterest(); }} />
    </> : null}
    {view === "interest" ? <>
      <Text style={muted}>This form saves your interest locally. {LOCAL_INTEREST_NOTICE}.</Text>
      <TextInput style={[styles.input, inputColors]} value={interest.make} onChangeText={(value) => { setInterest({ ...interest, make: value }); setInterestSaved(false); }} placeholder="Make" placeholderTextColor={colors.placeholder} />
      <TextInput style={[styles.input, inputColors]} value={interest.model} onChangeText={(value) => { setInterest({ ...interest, model: value }); setInterestSaved(false); }} placeholder="Model" placeholderTextColor={colors.placeholder} />
      <TextInput style={[styles.input, inputColors]} value={interest.year} onChangeText={(value) => { setInterest({ ...interest, year: value }); setInterestSaved(false); }} placeholder="Model year" keyboardType="number-pad" placeholderTextColor={colors.placeholder} />
      <Button title={`Join future beta interest: ${interest.joinBeta ? "yes" : "no"}`} onPress={() => { setInterest({ ...interest, joinBeta: !interest.joinBeta }); setInterestSaved(false); }} />
      <Button title="Save interest on this phone" disabled={busy} onPress={() => void change(() => garageFlow.saveInterest({ make: interest.make, model: interest.model, year: Number(interest.year), joinBeta: interest.joinBeta }), () => { setInterestSaved(true); })} />
      {interestSaved ? <Text style={normal}>{LOCAL_INTEREST_NOTICE}</Text> : null}
    </> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({ container: { flex: 1, gap: 8, padding: 16 }, garage: { gap: 8, padding: 16, minHeight: "100%" }, card: { borderWidth: 1, padding: 8, gap: 4 }, input: { borderWidth: 1, padding: 8 }, console: { borderWidth: 1, flex: 1, padding: 8 }, consoleText: { fontFamily: "monospace" } });
export default App;
