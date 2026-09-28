import { BleManager } from "react-native-ble-plx";
import { useEffect, useRef, useState } from "react";
import type { Transport } from "obd-core/transport";
import type { BatteryDiagnosisReport } from "obd-battery/report";
import { PermissionsAndroid, Platform, ScrollView, Switch, TextInput, View } from "react-native";
import { Icon, IconButton, TouchableRipple } from "react-native-paper";
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
import { CHARGE_STEP_LABELS, chargeStep, reachedStep, stepMarks, type ChargeStep } from "../app/chargeSteps.js";
import { Button, Card, ListRow, Screen, SectionLabel, styles, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

function EquinoxConsole({ vehicle, entry, intent, onBack, onSaved, onLockChange }: {
  vehicle: CatalogVehicle; entry: GarageVehicle; intent: "check" | "charge"; onBack: () => void; onSaved: (report: BatteryDiagnosisReport) => Promise<void>;
  onLockChange: (locked: boolean) => void;
}) {
  const tokens = useTokens();
  const inputColors = { backgroundColor: tokens.surface, borderColor: tokens.outline, color: tokens.text };
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
  // X-2026-09-28-app-redesign C3, presentation only: the developer tools card, and the last timeline step (1–4) this run reached.
  const [devOpen, setDevOpen] = useState(false);
  const [reached, setReached] = useState<ChargeStep>();
  // The one sanctioned hook: App blocks system back only while a diagnosis or a charge log runs; unmounting releases it.
  useEffect(() => { onLockChange(diagnosing || chargeLogging); }, [diagnosing, chargeLogging, onLockChange]);
  useEffect(() => () => { onLockChange(false); }, [onLockChange]);
  // reachedStep keeps the previous step on retry, recovery and starting lines, and never moves back.
  useEffect(() => { setReached((previous) => reachedStep(previous, status)); }, [status]);
  useEffect(() => { if (chargeLogging) setReached(undefined); }, [chargeLogging]);

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

  const saved = chargeStep(status) === 5;
  const title = chargeLogging ? "Charge log" : intent === "charge" ? "Log a charge" : "Battery check";
  const marks = stepMarks(reached, saved);
  const MARK = {
    done: { icon: "check-circle", color: tokens.accent, word: "Done" }, logged: { icon: "check-circle", color: tokens.accent, word: "Logged" },
    now: { icon: "progress-clock", color: tokens.accent, word: "Now" }, "not-reached": { icon: "minus-circle-outline", color: tokens.muted, word: "Not reached" },
  };
  const stepView = (n: number) => { const mark = marks[n - 1]; return mark ? MARK[mark] : { icon: "circle-outline", color: tokens.muted, word: "" }; };
  const pane = [consoleStyle, { backgroundColor: tokens.surface, borderColor: tokens.outline }];
  const disconnect = <Button title="Disconnect" tonal disabled={!chargeLogging && (!connection || pending || diagnosing || capturing)} onPress={() => {
    // During a charge log, Disconnect only asks the run to stop; the run saves the partial log and closes the link itself.
    if (chargeRun.current()) { chargeRun.requestStop("Stopping the charge log after the current command…"); return; }
    teardown("Disconnected by user.");
  }} />;

  // Spec §Screens 9 and the check screen: a scrolling page, so every control stays reachable with 52 dp buttons on a small phone.
  return <Screen scroll blocks>
    <View style={[styles.row, { minHeight: 56 }]}>
      <IconButton icon="arrow-left" iconColor={tokens.text} size={24} style={{ margin: 0, width: 48, height: 48 }} accessibilityLabel="Back" disabled={diagnosing || chargeLogging} onPress={onBack} />
      <Text accessibilityRole="header" style={[styles.h1, { flex: 1 }]}>{title}</Text>
    </View>
    <View accessibilityLiveRegion="polite" style={[styles.hero, styles.heroContent, { backgroundColor: tokens.container }]}>
      <Text style={[styles.caption, { color: tokens.containerMuted }]}>2024 Chevrolet Equinox EV · garage car {entry.id}</Text>
      <Text style={[styles.rowLabel, { color: tokens.onContainer }]}>{status}</Text>
      <Text style={[styles.caption, { color: tokens.containerMuted }]}>{connection ? `Connected ${connection.deviceName ?? connection.deviceId}; MTU ${String(connection.mtu)}; write ${connection.writeCharacteristicUuid}; notify ${connection.notifyCharacteristicUuid}` : "Not connected"}</Text>
    </View>
    {chargeLogging || saved ? <Card>
      <SectionLabel>Charge log steps</SectionLabel>
      {CHARGE_STEP_LABELS.map((label, i) => {
        const view = stepView(i + 1);
        return <View key={label} style={[styles.row, { minHeight: 48 }]}>
          <Icon source={view.icon} size={24} color={view.color} />
          <Text style={[styles.rowLabel, { flex: 1 }]}>{`${String(i + 1)}. ${label}`}</Text>
          {view.word ? <Text style={{ color: tokens.muted }}>{view.word}</Text> : null}
        </View>;
      })}
    </Card> : null}
    {chargeLogging ? <>
      <Card><Text>The charge log stops and saves by itself. Disconnect stops it early; what was logged so far is kept.</Text></Card>
      {disconnect}
    </> : <>
      <View style={{ gap: 8 }}>
        <SectionLabel>Dongle</SectionLabel>
        <Button title="Scan" tonal disabled={!permitted || !!connection || connecting || capturing || diagnosing || chargeLogging} onPress={startScan} />
        <View>{devices.map((item) => <ListRow key={item.id} icon="bluetooth" title={item.name ?? "Unnamed"} subtitle={`${item.id} · RSSI ${item.rssi === undefined ? "?" : String(item.rssi)}`}
          disabled={!!connection || connecting || diagnosing} onPress={() => void connect(item)} />)}</View>
      </View>
      <View style={[styles.row, { minHeight: 60 }]}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Vehicle Ready and in Park</Text>
          <Text style={[styles.caption, { color: tokens.muted }]}>{diagnosisReady ? "Recorded with the battery check: yes" : "Recorded with the battery check: unknown"}</Text>
        </View>
        <Switch accessibilityLabel="Vehicle Ready and in Park" value={diagnosisReady} disabled={diagnosing} onValueChange={() => { setDiagnosisReady((value) => !value); }} />
      </View>
      {intent === "charge"
        ? <Button title="Start charge log" disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging} onPress={() => void chargeLog()} />
        : <Button title="Run battery check" disabled={!connection || pending || capturing || diagnosing || chargeLogging} onPress={() => void diagnose()} />}
      {diagnosing ? <Button title="Cancel check" tonal disabled={!canCancelDiagnosis} onPress={cancelDiagnosis} /> : null}
      {disconnect}
      <Card>
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <Icon source="information-outline" size={24} color={tokens.muted} />
          <Text style={{ flex: 1 }}>Unplug the OBD dongle from the car after each check. Disconnecting Bluetooth leaves the dongle powered; it can drain the 12 V battery while the vehicle is off.</Text>
        </View>
      </Card>
      <Card>
        <TouchableRipple accessibilityRole="button" accessibilityState={{ expanded: devOpen }} onPress={() => { setDevOpen(!devOpen); }} style={{ minHeight: 48, justifyContent: "center" }}>
          <View style={styles.row}>
            <Icon source="tools" size={24} color={tokens.muted} />
            <Text style={[styles.rowLabel, { flex: 1 }]}>Developer tools</Text>
            <Icon source={devOpen ? "chevron-up" : "chevron-down"} size={24} color={tokens.muted} />
          </View>
        </TouchableRipple>
        {devOpen ? <>
          <TextInput style={[inputStyle, inputColors]} value={note} onChangeText={setNote} placeholder="Vehicle-state note" placeholderTextColor={tokens.muted} editable={!capturing && !diagnosing && !chargeLogging} />
          <Button title="Run capture" tonal disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging} onPress={() => void capture("recording")} />
          <Button title="Run codes report" tonal disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging} onPress={() => void capture("codes")} />
          {captureStep ? <Text>{captureStep}</Text> : null}
          {captureLast ? <Text style={{ color: tokens.muted }}>{captureLast}</Text> : null}
          <TextInput style={[inputStyle, inputColors]} value={command} onChangeText={setCommand} placeholder="Read-only command" placeholderTextColor={tokens.muted} autoCapitalize="characters" editable={!diagnosing} />
          <Button title="Send (not saved)" tonal disabled={!connection || pending || capturing || diagnosing || chargeLogging} onPress={() => void send()} />
          {report ? <ScrollView nestedScrollEnabled style={pane}><Text style={[styles.consoleText, { color: tokens.text }]}>{report}</Text></ScrollView> : null}
          <ScrollView nestedScrollEnabled style={pane}>{transcript.map((line, index) => <Text key={index} style={[styles.consoleText, { color: tokens.text }]}>{line}</Text>)}</ScrollView>
        </> : null}
      </Card>
    </>}
  </Screen>;
}

// Fixed-height panes that scroll inside the page (nestedScrollEnabled): the page itself scrolls, so a flex pane would have no height.
const consoleStyle = { borderWidth: 1, borderRadius: 12, padding: 8, height: 220 };
const inputStyle = { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 };

export { EquinoxConsole };
