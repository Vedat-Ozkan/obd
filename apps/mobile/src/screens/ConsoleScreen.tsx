import { useEffect, useRef, useState } from "react";
import type { Transport } from "obd-core/transport";
import type { BatteryDiagnosisReport } from "obd-battery/report";
import { Alert, PermissionsAndroid, Platform, ScrollView, Switch, TextInput, View } from "react-native";
import { Icon, IconButton, TouchableRipple } from "react-native-paper";
import { readLines } from "../beta/phoneStore.js";
import type { BleConnection } from "../ble/BleTransport.js";
import { runView, type RememberedDongle } from "../ble/dongleLink.js";
import { runCapture } from "../capture.js";
import { batteryScanMeta, runAndSaveBatteryDiagnosis } from "../batteryDiagnosisFlow.js";
import { runChargeLog } from "../chargeLogger.js";
import { runDriveCapture } from "../driveCapture.js";
import { keepPrivateBatteryScan } from "../batteryReportsDocumentStore.js";
import { CODES_SCAN_COMMANDS, codesScanStop } from "../codesScan.js";
import { ConsoleSession } from "../console.js";
import { RecordingBuffer } from "../recording.js";
import { RelayClient, type RelayWebSocket } from "../relay/RelayClient.js";
import { parseRelayAddress } from "../relay/parseRelayAddress.js";
import { finishRun } from "../runFiles.js";
import { canUseEquinoxConsole, type CatalogVehicle } from "../garage/catalog.js";
import type { GarageVehicle } from "../garage/flow.js";
import { batteryHistory, betaOutbox, chargeRun, deferShare, dongleLink, dongleMemory, driveTargets, equinoxSignals, foregroundService, localDate, NOTIFICATION_INTERVAL_MS, phoneTargets, queueForBeta, requestBlePermission } from "../app/runtime.js";
import { CHARGE_STEP_LABELS, chargeStep, reachedStep, stepMarks, type ChargeStep } from "../app/chargeSteps.js";
import { Button, Card, ListRow, Screen, SectionLabel, styles, Text } from "../ui/kit.js";
import { DonglePicker } from "./DonglePicker.js";
import { useTokens } from "../ui/theme.js";

function EquinoxConsole({ vehicle, entry, intent, onBack, onSaved, onLockChange }: {
  vehicle: CatalogVehicle; entry: GarageVehicle; intent: "check" | "charge"; onBack: () => void; onSaved: (report: BatteryDiagnosisReport) => Promise<void>;
  onLockChange: (locked: boolean) => void;
}) {
  const tokens = useTokens();
  const inputColors = { backgroundColor: tokens.surface, borderColor: tokens.outline, color: tokens.text };
  const [recording] = useState(() => new RecordingBuffer());
  // Mirrors the app-wide kept link (dongleLink), which outlives this screen; this screen never closes it except through dongleLink.
  const [connection, setConnection] = useState<BleConnection | undefined>(() => dongleLink.current());
  const [remembered, setRemembered] = useState<RememberedDongle>();
  const session = useRef<ConsoleSession | undefined>(undefined);
  // Manual Send uses its own unsaved session: two sessions on one transport would both record every rx.
  const debugSession = useRef<ConsoleSession | undefined>(undefined);
  const errorSubscription = useRef<(() => void) | undefined>(undefined);
  // The running diagnosis's view of the link: Cancel check and unmount close it, and the link stays open.
  const diagnosisView = useRef<Transport | undefined>(undefined);
  const [permitted, setPermitted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // The picker sheet scans only while open; it opens by itself the first time a car has no remembered dongle.
  const [pickerOpen, setPickerOpen] = useState(false);
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
  // A charge log outlives this screen: its foreground-service task uses the kept link until it ends (chargeRun).
  const [chargeLogging, setChargeLogging] = useState(() => chargeRun.current() !== undefined);
  const mounted = useRef(true);
  // Decision 21: set while the notification permission and the picker are open, before the run record is begun.
  const chargeStarting = useRef(false);
  // T0.6b: the one synchronous BLE gate. React state (pending, capturing) lags a tap; these refs and the module-level chargeRun do not.
  const bleOwner = useRef<"send" | "capture" | "relay" | undefined>(undefined);
  const bleBusy = () => bleOwner.current !== undefined || chargeStarting.current || diagnosingRef.current || chargeRun.current() !== undefined;
  const relayRef = useRef<{ client: RelayClient; socket: RelayWebSocket } | undefined>(undefined);
  // The command the relay client has not answered yet (an open Mode 04 alert counts); undefined when idle.
  const relayCommand = useRef<string | undefined>(undefined);
  const [relayUrl, setRelayUrl] = useState("");
  const [relayToken, setRelayToken] = useState("");
  const [relayStatus, setRelayStatus] = useState("Disconnected");
  const [relaying, setRelaying] = useState(false);
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
  // Relay closes before BLE is reused: its reader comes off the transport and the socket closes, then ownership is released.
  const closeRelay = () => {
    const active = relayRef.current; if (!active) return;
    relayRef.current = undefined; relayCommand.current = undefined;
    active.client.close(); active.socket.close();
    if (bleOwner.current === "relay") bleOwner.current = undefined;
    setRelaying(false); setRelayStatus("Disconnected");
  };
  const teardown = (message: string) => {
    closeRelay();
    if (diagnosingRef.current) {
      if (diagnosisScanActive.current && !diagnosisInterruption.current && !diagnosisCloseExpected.current) {
        diagnosisInterruption.current = "disconnected";
        diagnosisScanActive.current = false;
        setCanCancelDiagnosis(false);
      }
      if (diagnosisInterruption.current === "disconnected") setStatus(`${message} Keeping the private battery scan…`);
      return;
    }
    // A file cut short by a disconnect says why.
    if (session.current) recording.meta(message);
    endRecording(); closeDebugSession();
    setTranscript((current) => [...current, `-- ${message}`]);
    setStatus(message);
  };

  // Notification errors from the kept link show here; one listener at a time, removed on unmount.
  const watchErrors = (link: BleConnection) => {
    errorSubscription.current?.();
    errorSubscription.current = link.transport.onError((error) => { setStatus(`Notification error: ${error.message}`); });
  };
  const connectTo = async (device: { id: string; name?: string }, kind: "picked" | "remembered") => {
    setConnecting(true);
    const shown = device.name ?? device.id;
    try {
      setStatus(`Connecting to ${shown}…`);
      const next = await dongleLink.connect(device.id);
      const name = next.deviceName ?? device.name;
      // A failed write is ignored: the link works, the dongle is just not remembered.
      void dongleMemory.remember(entry.id, { id: next.deviceId, ...(name === undefined ? {} : { name }) })
        .then(() => dongleMemory.get(entry.id)).then((saved) => { if (mounted.current) setRemembered(saved); }, () => undefined);
      if (!mounted.current) return;
      watchErrors(next);
      setStatus(`Connected to ${name ?? next.deviceId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(kind === "remembered" ? `Could not reach ${shown} (${message}). Check it is plugged in, then tap Connect.` : `Connection error: ${message}`);
    } finally { setConnecting(false); }
  };

  useEffect(() => {
    mounted.current = true;
    let runLine = false;
    const unmountRun = chargeRun.mount((line, running) => { runLine = true; setStatus(line); setChargeLogging(running); });
    const unsubscribeLink = dongleLink.subscribe((next, lost) => {
      setConnection(next);
      // During a charge log the logger's writes fail and it reconnects by itself (T2.4 Decisions 19-22); only a lost idle link ends things here.
      if (!lost || chargeRun.current()) return;
      teardown(`Disconnected${lost.error ? `: ${lost.error.message}` : ""}.`);
    });
    const savedDongle = dongleMemory.get(entry.id);
    void savedDongle.then((dongle) => { if (mounted.current) setRemembered(dongle); });
    // The running log's status, or its final line, stays on screen; the connection lines below then leave it alone.
    const say = (line: string) => { if (!runLine) setStatus(line); };
    const isMounted = () => mounted.current;
    // Auto-connect (spec §Auto-connect on mount): the first matching case applies.
    void (async () => {
      let granted: boolean;
      try { granted = await requestBlePermission(); }
      catch (error) { setStatus(`Permission error: ${error instanceof Error ? error.message : String(error)}`); return; }
      if (!mounted.current) return;
      setPermitted(granted);
      if (!granted) { say("Bluetooth permission was denied; scanning is disabled. Grant it in Android settings and reopen the app."); return; }
      if (chargeRun.current()) return;
      const dongle = await savedDongle;
      if (!isMounted()) return; // a call, so TypeScript does not keep the check above across the await
      const live = dongleLink.current();
      if (live) {
        const name = live.deviceName ?? (dongle?.id === live.deviceId ? dongle.name : undefined) ?? live.deviceId;
        say(`Connected to ${name}.`);
        watchErrors(live);
        if (!dongle) void dongleMemory.remember(entry.id, { id: live.deviceId, ...(live.deviceName === undefined ? {} : { name: live.deviceName }) })
          .then(() => dongleMemory.get(entry.id)).then((saved) => { if (mounted.current) setRemembered(saved); }, () => undefined);
        return;
      }
      if (dongle && dongleLink.held()) { say(`Disconnected. Tap Connect to use ${dongle.name ?? dongle.id} again.`); return; }
      if (dongle) { await connectTo(dongle, "remembered"); return; }
      say("Bluetooth permission granted. Choose your OBD dongle.");
      setPickerOpen(true);
    })();
    return () => {
      mounted.current = false;
      unsubscribeLink(); closeRelay();
      errorSubscription.current?.(); errorSubscription.current = undefined;
      session.current?.close(); debugSession.current?.close(); void diagnosisView.current?.close();
      // The kept link stays open, and so does a running charge log's use of it.
      unmountRun();
    };
  }, []);

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
    if (!connection || bleBusy()) return;
    bleOwner.current = "send";
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
    finally { bleOwner.current = undefined; setPending(false); }
  };
  const capture = async (kind: "recording" | "codes") => {
    if (bleBusy()) return;
    if (!canUseEquinoxConsole(vehicle)) { setStatus("Equinox capture unavailable for this model year."); return; }
    closeDebugSession();
    bleOwner.current = "capture";
    const active = startRecording();
    if (!active) { bleOwner.current = undefined; return; }
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
    } finally { bleOwner.current = undefined; setCapturing(false); }
  };

  const diagnose = async () => {
    const active = dongleLink.current();
    if (!active || bleBusy() || !canUseEquinoxConsole(vehicle)) return;
    closeDebugSession();
    diagnosisInterruption.current = undefined;
    diagnosisCloseExpected.current = false;
    diagnosingRef.current = true; diagnosisScanActive.current = true; setDiagnosing(true); setCanCancelDiagnosis(true);
    const scanRecording = new RecordingBuffer();
    const scannedAt = new Date().toISOString();
    scanRecording.start(batteryScanMeta(active, diagnosisReady));
    // The scan closes its transport when it ends; on the kept link that closes only this view.
    const view = runView(active.transport); diagnosisView.current = view;
    const scanTransport: Transport = {
      startsIdle: view.startsIdle,
      write: (bytes) => view.write(bytes),
      onData: (callback) => view.onData(callback),
      close: async () => { diagnosisCloseExpected.current = true; await view.close(); },
    };
    try {
      const outcome = await runAndSaveBatteryDiagnosis({ entry, transport: scanTransport, recording: scanRecording, scannedAt, keepScan: keepPrivateBatteryScan, history: batteryHistory, importedSignals: equinoxSignals, getInterruption: () => diagnosisInterruption.current, onProgress: (message) => { if (message === "Keeping private scan") { diagnosisScanActive.current = false; setCanCancelDiagnosis(false); } setStatus(message); } });
      // T2.9: every kept private scan is shared, whatever its outcome.
      const beta = await queueForBeta("battery-scan", entry, readLines(outcome.recording));
      const betaSentence = beta === undefined ? "" : ` ${beta}`;
      if (outcome.status === "saved") {
        await onSaved(outcome.report);
        setStatus(`Battery diagnosis saved: ${outcome.report.scanStatus}.${betaSentence}`);
      } else if (outcome.status === "stopped") {
        setStatus(`${outcome.reason} Private scan: ${outcome.recording}.${betaSentence}`);
      } else setStatus(`${outcome.reason} Private scan: ${outcome.recording}.${betaSentence}`);
    } catch (cause) {
      setStatus(`Battery diagnosis error: ${cause instanceof Error ? cause.message : String(cause)}.`);
    } finally {
      diagnosisView.current = undefined;
      diagnosingRef.current = false; diagnosisScanActive.current = false; diagnosisInterruption.current = undefined; diagnosisCloseExpected.current = false; setDiagnosing(false); setCanCancelDiagnosis(false);
      await view.close();
    }
  };
  // docs/specs/T2.4-charge-logger.md Stage B2: one tap; the run stops and saves by itself.
  const chargeLog = async () => {
    const active = dongleLink.current();
    if (!active || bleBusy() || !note.trim() || !canUseEquinoxConsole(vehicle)) return;
    closeDebugSession();
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
    // An unmounted console must not start a run; the kept link stays open.
    if (!mounted.current) { chargeStarting.current = false; return; }
    if (dongleLink.current() !== active) {
      notStarted("Charge log not started: the dongle disconnected. Connect and try again.");
      return;
    }
    const run = chargeRun.begin(active, "Starting the charge log…");
    chargeStarting.current = false;
    // The link stays open when the run ends by itself; Disconnect during the run closes and holds it once the log is saved.
    const release = async (line: string) => {
      if (run.stop) await dongleLink.disconnect();
      chargeRun.end(line);
    };
    const logRecording = new RecordingBuffer();
    logRecording.start({ car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note: note.trim(), writeChar: active.writeCharacteristicUuid, notifyChar: active.notifyCharacteristicUuid, mtu: active.mtu });
    let connected = false;
    let notified = 0;
    const task = async () => {
      const result = await runChargeLog({
        // The logger closes its transport after a link loss and at the end; each is a view, so the kept link stays open.
        connect: async () => {
          if (!connected) { connected = true; return runView(active.transport); }
          return runView((await dongleLink.reconnect()).transport);
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
        await release(`Charge log stopped: ${result.stopReason} (${result.complete ? "complete" : "partial"}). ${result.saved}${beta === undefined ? "" : ` ${beta}`}`);
      } finally { await foregroundService.stop(); }
    };
    try {
      await foregroundService.start(task);
    } catch (error) {
      await release(`Charge log not started: the foreground service failed (${error instanceof Error ? error.message : String(error)}).`);
    }
  };
  // docs/specs/T2.12-test-drive-capture.md: the same start steps, gate and release as chargeLog(); one tap while parked, then it stops and saves by itself.
  const testDrive = async () => {
    const active = dongleLink.current();
    if (!active || bleBusy() || !note.trim() || !canUseEquinoxConsole(vehicle)) return;
    closeDebugSession();
    const notStarted = (line: string) => { chargeStarting.current = false; setStatus(line); };
    chargeStarting.current = true; setStatus("Starting the test drive…");
    if (Platform.OS === "android" && Platform.Version >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
    // Resolved now, so no picker opens at the end of the drive.
    try { await phoneTargets.folder(); }
    catch (error) {
      notStarted(`Test drive not started: no capture folder (${error instanceof Error ? error.message : String(error)}).`);
      return;
    }
    if (!mounted.current) { chargeStarting.current = false; return; }
    if (dongleLink.current() !== active) {
      notStarted("Test drive not started: the dongle disconnected. Connect and try again.");
      return;
    }
    const run = chargeRun.begin(active, "Starting the test drive…", "drive");
    chargeStarting.current = false;
    // The link stays open when the run ends by itself; Disconnect during the run closes and holds it once the recording is saved.
    const release = async (line: string) => {
      if (run.stop) await dongleLink.disconnect();
      chargeRun.end(line);
    };
    const driveRecording = new RecordingBuffer();
    driveRecording.start({ car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note: `T2.12 test drive: ${note.trim()}`, writeChar: active.writeCharacteristicUuid, notifyChar: active.notifyCharacteristicUuid, mtu: active.mtu });
    let connected = false;
    let notified = 0;
    const task = async () => {
      const result = await runDriveCapture({
        connect: async () => {
          if (!connected) { connected = true; return runView(active.transport); }
          return runView((await dongleLink.reconnect()).transport);
        },
        recording: driveRecording,
        signals: equinoxSignals,
        now: () => Date.now() / 1000,
        sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
        onStatus: (line) => {
          chargeRun.status(line);
          if (Date.now() - notified < NOTIFICATION_INTERVAL_MS) return;
          void foregroundService.update(line).then(() => { notified = Date.now(); }, () => undefined);
        },
        stream: driveTargets,
        stopRequested: () => run.stop,
      });
      // Nothing is queued for beta and no share sheet opens; a failed copy names the private file in the final line.
      try { await release(`Test drive stopped: ${result.stopReason}. ${result.saved}`); }
      finally { await foregroundService.stop(); }
    };
    try {
      await foregroundService.start(task, "Test drive running", "Starting the test drive.");
    } catch (error) {
      await release(`Test drive not started: the foreground service failed (${error instanceof Error ? error.message : String(error)}).`);
    }
  };
  // docs/specs/T0.6b-android-relay-mode.md: one alert per Mode 04 request; Cancel, back and a tap outside all deny.
  const confirmMode04 = () => new Promise<boolean>((resolve) => {
    Alert.alert("Clear trouble codes?", "The relay asks to clear diagnostic trouble codes. This also clears freeze-frame data. Confirm this one operation only.", [
      { text: "Cancel", style: "cancel", onPress: () => { resolve(false); } },
      { text: "Clear codes", style: "destructive", onPress: () => { resolve(true); } },
    ], { cancelable: true, onDismiss: () => { resolve(false); } });
  });
  const connectRelay = () => {
    const active = dongleLink.current();
    if (!active || bleBusy()) return;
    // Accepts host:port or the broker's printed ws://host:port/phone?token=... line; a token in the line is used when the token field is empty.
    const parsed = parseRelayAddress(relayUrl, relayToken);
    if (!parsed.ok) { if (parsed.clearAddress) setRelayUrl(""); setRelayStatus("Error: enter the ws://host:port address and the token."); return; }
    // The query is built here and never shown, logged or stored; a pasted token leaves the address field and the token field is cleared once the socket opens.
    setRelayUrl(parsed.base);
    const url = `${parsed.base}/phone?${new URLSearchParams({ token: parsed.token }).toString()}`;
    bleOwner.current = "relay"; closeDebugSession(); setRelaying(true); setRelayStatus("Connecting"); setStatus("Connecting relay…");
    let socket: RelayWebSocket;
    try { socket = new WebSocket(url); }
    catch { bleOwner.current = undefined; setRelaying(false); setRelayStatus("Error: could not open the relay socket."); return; }
    let opened = false;
    // onTerminal can run inside the constructor, before relayRef is set; then closeRelay has nothing to release.
    let terminated = false as boolean;
    const client = new RelayClient(socket, active.transport, { vehicle: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", writeChar: active.writeCharacteristicUuid, notifyChar: active.notifyCharacteristicUuid, mtu: active.mtu },
      confirmMode04, undefined, undefined,
      (uncertain) => {
        // Fires for every end the client did not start itself.
        terminated = true;
        closeRelay();
        if (bleOwner.current === "relay") bleOwner.current = undefined;
        relayCommand.current = undefined; setRelaying(false);
        // T0.6b rule 7: an uncertain end closes BLE.
        if (uncertain) { teardown("Relay ended mid-command; reconnect the dongle."); void dongleLink.drop(); }
        else { const line = opened ? "Relay disconnected." : "Relay connection failed; check the address and token."; setRelayStatus(line); setStatus(line); }
      },
      (busyCommand) => { relayCommand.current = busyCommand; setRelayStatus(busyCommand === undefined ? "Connected" : `Busy: ${busyCommand}`); });
    if (terminated) { socket.close(); return; }
    relayRef.current = { client, socket };
    socket.addEventListener("open", () => {
      // RelayClient's own open listener runs first; if its hello failed, the relay is already closed.
      if (relayRef.current?.socket !== socket) return;
      opened = true; setRelayToken(""); setRelayStatus("Connected"); setStatus("Relay connected.");
    });
  };
  const disconnectRelay = () => {
    const uncertain = relayCommand.current !== undefined;
    closeRelay();
    if (uncertain) { teardown("Relay disconnected mid-command; reconnect the dongle."); void dongleLink.drop(); }
    else setStatus("Relay disconnected.");
  };
  const cancelDiagnosis = () => {
    if (!diagnosingRef.current || !diagnosisScanActive.current) return;
    diagnosisInterruption.current = "cancelled";
    diagnosisScanActive.current = false;
    setCanCancelDiagnosis(false);
    setStatus("Cancelling battery diagnosis; keeping the private scan…");
    void diagnosisView.current?.close();
  };

  const saved = chargeStep(status) === 5;
  const driving = chargeLogging && chargeRun.current()?.kind === "drive";
  const title = driving ? "Test drive" : chargeLogging ? "Charge log" : intent === "charge" ? "Log a charge" : "Battery check";
  const marks = stepMarks(reached, saved);
  const MARK = {
    done: { icon: "check-circle", color: tokens.accent, word: "Done" }, logged: { icon: "check-circle", color: tokens.accent, word: "Logged" },
    now: { icon: "progress-clock", color: tokens.accent, word: "Now" }, "not-reached": { icon: "minus-circle-outline", color: tokens.muted, word: "Not reached" },
  };
  const stepView = (n: number) => { const mark = marks[n - 1]; return mark ? MARK[mark] : { icon: "circle-outline", color: tokens.muted, word: "" }; };
  const pane = [consoleStyle, { backgroundColor: tokens.surface, borderColor: tokens.outline }];
  const disconnect = <Button title="Disconnect" tonal disabled={!chargeLogging && (!connection || pending || diagnosing || capturing)} onPress={() => {
    // During a charge log, Disconnect only asks the run to stop; the run saves the partial log, then closes and holds the link.
    if (chargeRun.current()) { chargeRun.requestStop(driving ? "Stopping the test drive after the current command…" : "Stopping the charge log after the current command…"); return; }
    teardown("Disconnected by user."); void dongleLink.disconnect();
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
    {(chargeLogging && !driving) || saved ? <Card>
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
      <Card><Text>{driving
        ? "Recording a test drive. It stops and saves by itself after 20 minutes, or a minute after you switch the car off. Do not touch the phone while driving. Disconnect stops it early; what was recorded is kept."
        : "The charge log stops and saves by itself. Disconnect stops it early; what was logged so far is kept."}</Text></Card>
      {disconnect}
    </> : <>
      <View style={{ gap: 8 }}>
        <SectionLabel>Dongle</SectionLabel>
        <ListRow icon="bluetooth" title={connection ? connection.deviceName ?? (remembered?.id === connection.deviceId ? remembered.name : undefined) ?? "Unnamed device" : remembered ? remembered.name ?? "Unnamed device" : "No dongle chosen"}
          subtitle={connecting ? "Connecting…" : connection ? "Connected" : "Not connected"} />
        {remembered && !connection ? <Button title="Connect" tonal disabled={!permitted || connecting || pending || capturing || diagnosing || chargeLogging || bleBusy()} onPress={() => void connectTo(remembered, "remembered")} /> : null}
        <Button title={remembered ? "Change dongle" : "Choose dongle"} tonal disabled={!permitted || connecting || pending || capturing || diagnosing || chargeLogging || bleBusy()} onPress={() => { setPickerOpen(true); }} />
      </View>
      <View style={[styles.row, { minHeight: 60 }]}>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel}>Vehicle Ready and in Park</Text>
          <Text style={[styles.caption, { color: tokens.muted }]}>{diagnosisReady ? "Recorded with the battery check: yes" : "Recorded with the battery check: unknown"}</Text>
        </View>
        <Switch accessibilityLabel="Vehicle Ready and in Park" value={diagnosisReady} disabled={diagnosing} onValueChange={() => { setDiagnosisReady((value) => !value); }} />
      </View>
      {intent === "charge"
        ? <Button title="Start charge log" disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging || bleBusy()} onPress={() => void chargeLog()} />
        : <Button title="Run battery check" disabled={!connection || pending || capturing || diagnosing || chargeLogging || bleBusy()} onPress={() => void diagnose()} />}
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
          <Button title="Run capture" tonal disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging || bleBusy()} onPress={() => void capture("recording")} />
          <Button title="Run codes report" tonal disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging || bleBusy()} onPress={() => void capture("codes")} />
          <Button title="Record test drive" tonal disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || pending || capturing || diagnosing || chargeLogging || bleBusy()} onPress={() => void testDrive()} />
          <Text style={{ color: tokens.muted }}>Car in Ready, parked. Tap once, then drive 15–20 min.</Text>
          {captureStep ? <Text>{captureStep}</Text> : null}
          {captureLast ? <Text style={{ color: tokens.muted }}>{captureLast}</Text> : null}
          <TextInput style={[inputStyle, inputColors]} value={command} onChangeText={setCommand} placeholder="Read-only command" placeholderTextColor={tokens.muted} autoCapitalize="characters" editable={!diagnosing} />
          <Button title="Send (not saved)" tonal disabled={!connection || pending || capturing || diagnosing || chargeLogging || bleBusy()} onPress={() => void send()} />
          {__DEV__ && connection ? <>
            <SectionLabel>Relay</SectionLabel>
            <TextInput style={[inputStyle, inputColors]} value={relayUrl} onChangeText={setRelayUrl} placeholder="ws://<WSL-host>:8765" placeholderTextColor={tokens.muted} autoCapitalize="none" autoCorrect={false} editable={!relaying} />
            <TextInput style={[inputStyle, inputColors]} value={relayToken} onChangeText={setRelayToken} placeholder="Relay token" placeholderTextColor={tokens.muted} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!relaying} />
            <Button title={relaying ? "Disconnect relay" : "Connect relay"} tonal disabled={!relaying && bleBusy()} onPress={relaying ? disconnectRelay : connectRelay} />
            <Text style={{ color: tokens.muted }}>{relayStatus}</Text>
          </> : null}
          {report ? <ScrollView nestedScrollEnabled style={pane}><Text style={[styles.consoleText, { color: tokens.text }]}>{report}</Text></ScrollView> : null}
          <ScrollView nestedScrollEnabled style={pane}>{transcript.map((line, index) => <Text key={index} style={[styles.consoleText, { color: tokens.text }]}>{line}</Text>)}</ScrollView>
        </> : null}
      </Card>
    </>}
    <DonglePicker visible={pickerOpen} {...(remembered ? { rememberedId: remembered.id } : {})} onDismiss={() => { setPickerOpen(false); }}
      onPick={(device) => { setPickerOpen(false); closeDebugSession(); void connectTo(device, "picked"); }} />
  </Screen>;
}

// Fixed-height panes that scroll inside the page (nestedScrollEnabled): the page itself scrolls, so a flex pane would have no height.
const consoleStyle = { borderWidth: 1, borderRadius: 12, padding: 8, height: 220 };
const inputStyle = { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 };

export { EquinoxConsole };
