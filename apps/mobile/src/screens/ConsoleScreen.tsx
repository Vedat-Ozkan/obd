import { BleManager } from "react-native-ble-plx";
import { useEffect, useRef, useState } from "react";
import type { Transport } from "obd-core/transport";
import type { BatteryDiagnosisReport } from "obd-battery/report";
import { FlatList, PermissionsAndroid, Platform, ScrollView, TextInput } from "react-native";
import { readLines } from "../beta/phoneStore.js";
import { connectVeepeak, scanDevices, type BleConnection, type ScannedDevice } from "../ble/BleTransport.js";
import { runCapture } from "../capture.js";
import { batteryScanMeta, runAndSaveBatteryDiagnosis } from "../batteryDiagnosisFlow.js";
import { runChargeLog } from "../chargeLogger.js";
import { keepPrivateBatteryScan } from "../batteryReportsDocumentStore.js";
import { CODES_SCAN_COMMANDS, codesScanStop } from "../codesScan.js";
import { ConsoleSession } from "../console.js";
import { RecordingBuffer } from "../recording.js";
import { finishRun } from "../runFiles.js";
import { canUseEquinoxConsole, type CatalogVehicle } from "../garage/catalog.js";
import type { GarageVehicle } from "../garage/flow.js";
import { batteryHistory, betaOutbox, chargeRun, deferShare, equinoxSignals, foregroundService, localDate, NOTIFICATION_INTERVAL_MS, phoneTargets, queueForBeta, requestBlePermission } from "../app/runtime.js";
import { Button, Screen, styles, Text } from "../ui/kit.js";
import { usePalette } from "../ui/theme.js";

function EquinoxConsole({ vehicle, entry, onBack, onSaved }: { vehicle: CatalogVehicle; entry: GarageVehicle; onBack: () => void; onSaved: (report: BatteryDiagnosisReport) => Promise<void> }) {
  const colors = usePalette();
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
  // A charge log outlives this screen: its foreground-service task owns the transport and the manager until it ends (chargeRun).
  const [chargeLogging, setChargeLogging] = useState(() => chargeRun.current() !== undefined);
  const mounted = useRef(true);
  // Decision 21: set while the notification permission and the picker are open, before the run record is begun.
  const chargeStarting = useRef(false);

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
    mounted.current = true;
    let runLine = false;
    const unmountRun = chargeRun.mount((line, running) => { runLine = true; setStatus(line); setChargeLogging(running); });
    void requestBlePermission().then((granted) => {
      setPermitted(granted);
      if (runLine) return; // the running log's status, or its final line, stays on screen
      setStatus(granted ? "Bluetooth permission granted. Scan for the Veepeak." : "Bluetooth permission was denied; scanning is disabled. Grant it in Android settings and reopen the app.");
    }, (error: unknown) => { setStatus(`Permission error: ${error instanceof Error ? error.message : String(error)}`); });
    return () => {
      mounted.current = false;
      stopScan.current?.(); disconnectSubscription.current?.remove(); session.current?.close(); debugSession.current?.close();
      if (!unmountRun()) return; // the run's own end closes the transport and destroys the manager
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
    if (!connection || chargeStarting.current) return;
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
    if (chargeStarting.current) return;
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
      const outcome = await finishRun(kind, jsonl, { vehicle: `${String(vehicle.year)} ${vehicle.make} ${vehicle.model}`, date: localDate(), result }, phoneTargets,
        (text) => queueForBeta(kind === "codes" ? "codes-scan" : "capture", entry, text));
      setReport(outcome.report); setStatus(`${summary} ${outcome.status}`);
    } finally { setCapturing(false); }
  };

  const diagnose = async () => {
    const active = connectionRef.current;
    if (!active || diagnosingRef.current || chargeRun.current() || chargeStarting.current || capturing || pending || !canUseEquinoxConsole(vehicle)) return;
    closeDebugSession();
    diagnosisInterruption.current = undefined;
    diagnosisCloseExpected.current = false;
    diagnosingRef.current = true; diagnosisScanActive.current = true; setDiagnosing(true); setCanCancelDiagnosis(true);
    const scanRecording = new RecordingBuffer();
    const scannedAt = new Date().toISOString();
    scanRecording.start(batteryScanMeta(active, diagnosisReady));
    const scanTransport: Transport = {
      write: (bytes) => active.transport.write(bytes),
      onData: (callback) => active.transport.onData(callback),
      close: async () => { diagnosisCloseExpected.current = true; await active.transport.close(); },
    };
    try {
      const outcome = await runAndSaveBatteryDiagnosis({ entry, transport: scanTransport, recording: scanRecording, scannedAt, keepScan: keepPrivateBatteryScan, history: batteryHistory, importedSignals: equinoxSignals, getInterruption: () => diagnosisInterruption.current, onProgress: (message) => { if (message === "Keeping private scan") { diagnosisScanActive.current = false; setCanCancelDiagnosis(false); } setStatus(message); } });
      // T2.9: every kept private scan is shared, whatever its outcome.
      const beta = await queueForBeta("battery-scan", entry, readLines(outcome.recording));
      const betaSentence = beta === undefined ? "" : ` ${beta}`;
      if (outcome.status === "saved") {
        await onSaved(outcome.report);
        setStatus(`Battery diagnosis saved: ${outcome.report.scanStatus}.${betaSentence} Reconnect for another run.`);
      } else if (outcome.status === "stopped") {
        setStatus(`${outcome.reason} Private scan: ${outcome.recording}.${betaSentence} Reconnect for another run.`);
      } else setStatus(`${outcome.reason} Private scan: ${outcome.recording}.${betaSentence} Reconnect for another run.`);
    } catch (cause) {
      setStatus(`Battery diagnosis error: ${cause instanceof Error ? cause.message : String(cause)}. Reconnect before another run.`);
    } finally {
      disconnectSubscription.current?.remove(); disconnectSubscription.current = undefined;
      connectionRef.current = undefined; setConnection(undefined);
      diagnosingRef.current = false; diagnosisScanActive.current = false; diagnosisInterruption.current = undefined; diagnosisCloseExpected.current = false; setDiagnosing(false); setCanCancelDiagnosis(false);
      await active.transport.close().catch(() => undefined);
    }
  };
  // docs/specs/T2.4-charge-logger.md Stage B2: one tap; the run stops and saves by itself.
  const chargeLog = async () => {
    const active = connectionRef.current;
    if (!active || chargeRun.current() || chargeStarting.current || diagnosingRef.current || capturing || pending || !note.trim() || !canUseEquinoxConsole(vehicle)) return;
    closeDebugSession();
    const release = async (line: string) => {
      connectionRef.current = undefined; setConnection(undefined);
      // The logger closes its own link; this also covers a run that never connected (its log file could not be created).
      await active.transport.close().catch(() => undefined);
      chargeRun.end(line);
    };
    const notStarted = (line: string) => { chargeStarting.current = false; setStatus(line); };
    chargeStarting.current = true; setStatus("Starting the charge log…");
    // A denial only hides the notification; the run still starts.
    if (Platform.OS === "android" && Platform.Version >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
    // Resolved now, in the foreground, so the run never needs a picker at its end.
    try { await phoneTargets.folder(); }
    catch (error) {
      notStarted(`Charge log not started: no capture folder (${error instanceof Error ? error.message : String(error)}).`);
      return;
    }
    // Decision 21: begun only now; a picker that never settles (activity destroyed) leaves no record behind.
    // An unmounted console's cleanup already closed the link and destroyed the manager.
    if (!mounted.current) { chargeStarting.current = false; return; }
    if (connectionRef.current !== active) {
      notStarted("Charge log not started: the dongle disconnected. Reconnect and try again.");
      return;
    }
    const run = chargeRun.begin(active, manager, "Starting the charge log…");
    chargeStarting.current = false;
    // The logger reconnects by itself after a link loss; the screen's teardown must not close its transport.
    disconnectSubscription.current?.remove(); disconnectSubscription.current = undefined;
    const logRecording = new RecordingBuffer();
    logRecording.start({ car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note: note.trim(), writeChar: active.writeCharacteristicUuid, notifyChar: active.notifyCharacteristicUuid, mtu: active.mtu });
    let connected = false;
    let notified = 0;
    const task = async () => {
      const result = await runChargeLog({
        connect: async () => {
          if (!connected) { connected = true; return active.transport; }
          return (await connectVeepeak(manager, active.deviceId)).transport;
        },
        recording: logRecording,
        signals: equinoxSignals,
        now: () => Date.now() / 1000,
        sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
        onStatus: (line) => {
          chargeRun.status(line);
          if (Date.now() - notified < NOTIFICATION_INTERVAL_MS) return;
          void foregroundService.update(line).then(() => { notified = Date.now(); }, () => undefined);
        },
        stream: phoneTargets,
        stopRequested: () => run.stop,
      });
      try {
        if (result.file !== "" && result.saved.includes("NOT SAVED")) { deferShare(result.file); }
        let beta: string | undefined;
        if (result.file !== "") {
          // Shown while the log is scrubbed into parts, so the scrub time on the phone can be read off the screen.
          if ((await betaOutbox.status()).sharing) chargeRun.status("Charge log stopped; preparing the beta upload…");
          beta = await queueForBeta("charge-log", entry, readLines(`captures/${result.file}`));
        }
        await release(`Charge log stopped: ${result.stopReason} (${result.complete ? "complete" : "partial"}). ${result.saved}${beta === undefined ? "" : ` ${beta}`} Reconnect for another run.`);
      } finally { await foregroundService.stop(); }
    };
    try {
      await foregroundService.start(task);
    } catch (error) {
      await release(`Charge log not started: the foreground service failed (${error instanceof Error ? error.message : String(error)}). Reconnect before another run.`);
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

  return <Screen>
    <Button title="Back to garage" color={colors.buttonBackground} disabled={diagnosing || chargeLogging} onPress={onBack} />
    <Text style={{ color: colors.text, fontWeight: "bold" }}>2024 Chevrolet Equinox EV · garage car {entry.id}</Text>
    <Text style={{ color: colors.text }}>{status}</Text>
    <Text style={{ color: colors.muted }}>{connection ? `Connected ${connection.deviceName ?? connection.deviceId}; MTU ${String(connection.mtu)}; write ${connection.writeCharacteristicUuid}; notify ${connection.notifyCharacteristicUuid}` : "Not connected"}</Text>
    <Text style={{ color: colors.text }}>Unplug the OBD dongle from the car after each check. Disconnecting Bluetooth leaves the dongle powered; it can drain the 12 V battery while the vehicle is off.</Text>
    <Button title="Scan" color={colors.buttonBackground} disabled={!permitted || !!connection || connecting || capturing || diagnosing || chargeLogging} onPress={startScan} />
    <Button title="Disconnect" color={colors.buttonBackground} disabled={!chargeLogging && (!connection || pending || diagnosing || capturing)} onPress={() => {
      // During a charge log, Disconnect only asks the run to stop; the run saves the partial log and closes the link itself.
      if (chargeRun.current()) { chargeRun.requestStop("Stopping the charge log after the current command…"); return; }
      teardown("Disconnected by user.");
    }} />
    <FlatList data={devices} keyExtractor={(item) => item.id} renderItem={({ item }) => <Button title={`${item.name ?? "Unnamed"} (${item.id}) RSSI ${item.rssi === undefined ? "?" : String(item.rssi)}`} color={colors.buttonBackground} disabled={!!connection || connecting || diagnosing} onPress={() => void connect(item)} />} />
    <TextInput style={[styles.input, inputColors]} value={note} onChangeText={setNote} placeholder="Vehicle-state note" placeholderTextColor={colors.placeholder} editable={!capturing && !diagnosing && !chargeLogging} />
    <Button title={`Vehicle Ready and in Park for diagnosis: ${diagnosisReady ? "yes" : "unknown"}`} color={colors.buttonBackground} disabled={diagnosing} onPress={() => { setDiagnosisReady((value) => !value); }} />
    <Button title="Run battery diagnosis" color={colors.buttonBackground} disabled={!connection || pending || capturing || diagnosing || chargeLogging} onPress={() => void diagnose()} />
    {diagnosing ? <Button title="Cancel battery diagnosis" color={colors.buttonBackground} disabled={!canCancelDiagnosis} onPress={cancelDiagnosis} /> : null}
    <Button title="Run capture" color={colors.buttonBackground} disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging} onPress={() => void capture("recording")} />
    <Button title="Run codes report" color={colors.buttonBackground} disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging} onPress={() => void capture("codes")} />
    <Button title="Run charge log" color={colors.buttonBackground} disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging} onPress={() => void chargeLog()} />
    {captureStep ? <Text style={{ color: colors.text }}>{captureStep}</Text> : null}
    {captureLast ? <Text style={{ color: colors.muted }}>{captureLast}</Text> : null}
    <TextInput style={[styles.input, inputColors]} value={command} onChangeText={setCommand} placeholder="Read-only command" placeholderTextColor={colors.placeholder} autoCapitalize="characters" editable={!diagnosing} />
    <Button title="Send (not saved)" color={colors.buttonBackground} disabled={!connection || pending || capturing || diagnosing || chargeLogging} onPress={() => void send()} />
    {report ? <ScrollView style={[styles.console, { backgroundColor: colors.consoleBackground, borderColor: colors.border }]}><Text style={[styles.consoleText, { color: colors.consoleText }]}>{report}</Text></ScrollView> : null}
    <ScrollView style={[styles.console, { backgroundColor: colors.consoleBackground, borderColor: colors.border }]}>{transcript.map((line, index) => <Text key={index} style={[styles.consoleText, { color: colors.consoleText }]}>{line}</Text>)}</ScrollView>
  </Screen>;
}

export { EquinoxConsole };
