import { BleManager } from "react-native-ble-plx";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { Button, FlatList, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { connectVeepeak, scanDevices, type BleConnection, type ScannedDevice } from "./src/ble/BleTransport.js";
import { runCapture } from "./src/capture.js";
import { ConsoleSession } from "./src/console.js";
import { RecordingBuffer } from "./src/recording.js";

function localFilename(): string {
  const date = new Date();
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-phone-console.jsonl`;
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

export function App() {
  const colors = palettes[useColorScheme() === "dark" ? "dark" : "light"];
  const inputColors = { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.inputText };
  const [manager] = useState(() => new BleManager());
  const [recording] = useState(() => new RecordingBuffer());
  const [connection, setConnection] = useState<BleConnection>();
  const connectionRef = useRef<BleConnection | undefined>(undefined);
  const session = useRef<ConsoleSession | undefined>(undefined);
  const stopScan = useRef<(() => void) | undefined>(undefined);
  const disconnectSubscription = useRef<{ remove: () => void } | undefined>(undefined);
  const [permitted, setPermitted] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [status, setStatus] = useState("Requesting Bluetooth permission…");
  // Prefilled so Run capture is one tap (T0.8d Decision 4); the owner can edit it and must never type a VIN.
  const [note, setNote] = useState("Equinox Ready, Park; one-button capture");
  const [command, setCommand] = useState("0100");
  const [transcript, setTranscript] = useState<string[]>([]);
  const [recordingActive, setRecordingActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [frozenJsonl, setFrozenJsonl] = useState<string>();
  // The capture's async closure sees stale React state; teardown's freeze is read from here instead.
  const frozenRef = useRef<string | undefined>(undefined);
  const [capturing, setCapturing] = useState(false);
  const [captureStep, setCaptureStep] = useState("");
  const [captureLast, setCaptureLast] = useState("");

  // A session exists only while recording, so closing it freezes the buffer: no rx lands after Stop or disconnect.
  const endRecording = (): string | undefined => {
    if (!session.current) return undefined;
    session.current.close(); session.current = undefined;
    const jsonl = recording.toJsonl(); frozenRef.current = jsonl;
    setFrozenJsonl(jsonl); setRecordingActive(false);
    return jsonl;
  };
  const teardown = (message: string) => {
    disconnectSubscription.current?.remove(); disconnectSubscription.current = undefined;
    // A file cut short by a disconnect says why.
    if (session.current) recording.meta(message);
    endRecording();
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
      stopScan.current?.(); disconnectSubscription.current?.remove(); session.current?.close();
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
    if (!connection || !note.trim()) { setStatus("Connect and enter a non-empty vehicle-state note before recording."); return undefined; }
    recording.start({ car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble", note: note.trim(), writeChar: connection.writeCharacteristicUuid, notifyChar: connection.notifyCharacteristicUuid, mtu: connection.mtu });
    // A fresh session per recording: its reader starts empty and every notification lands in the started buffer.
    session.current = new ConsoleSession(connection.transport, recording);
    setTranscript([]); setFrozenJsonl(undefined); frozenRef.current = undefined; setRecordingActive(true); setStatus("Recording started.");
    return session.current;
  };
  const send = async () => {
    if (!session.current) return;
    setPending(true);
    try { const response = await session.current.send(command); setTranscript((current) => [...current, `> ${command}`, `${response}>`]); }
    catch (error) { setStatus(`Command error: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setPending(false); }
  };
  const stopRecording = () => { endRecording(); setStatus("Recording stopped and frozen."); };
  /** Writes a new file and opens the share sheet; returns the file name. */
  const exportJsonl = async (jsonl: string): Promise<string> => {
    const base = localFilename(); const extension = ".jsonl"; const stem = base.slice(0, -extension.length);
    let suffix = 1; let file = new File(Paths.cache, base);
    while (file.exists) { suffix++; file = new File(Paths.cache, `${stem}-${String(suffix)}${extension}`); }
    file.create(); // throws if the file exists; never overwrite an export
    file.write(jsonl);
    await Sharing.shareAsync(file.uri, { mimeType: "application/x-ndjson", dialogTitle: "Export OBD recording" });
    return file.name;
  };
  const exportRecording = async () => {
    if (!frozenJsonl) return;
    try { setStatus(`Exported ${await exportJsonl(frozenJsonl)}.`); }
    catch (error) { setStatus(`Export error: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const capture = async () => {
    const active = startRecording();
    if (!active) return;
    setCapturing(true); setCaptureStep(""); setCaptureLast(""); setStatus("Capturing…");
    let step = 0; let stepCommand = "";
    try {
      const result = await runCapture(active, recording, (progress) => {
        step = progress.step; stepCommand = progress.command;
        if (progress.outcome === undefined) { setCaptureStep(`Step ${String(progress.step)} of ${String(progress.total)}: ${progress.command}`); return; }
        const outcome = progress.outcome;
        setCaptureLast(`Last: ${progress.command} → ${outcome}`);
        const response = progress.response;
        setTranscript((current) => response === undefined ? [...current, `-- ${outcome}`] : [...current, `> ${progress.command}`, `${response}>`]);
      });
      // If teardown already froze the recording, its JSONL is in the ref; an early stop still exports the partial file.
      const jsonl = endRecording() ?? frozenRef.current;
      const summary = result.stoppedEarly === undefined
        ? `Capture complete: ${String(result.sent)} of ${String(result.total)} sent.`
        : `Capture stopped at step ${String(step)} of ${String(result.total)} (${stepCommand}): ${result.stoppedEarly}.`;
      setStatus(summary);
      if (!jsonl) return;
      try { setStatus(`${summary} Share sheet opened for ${await exportJsonl(jsonl)}; choose where to save it.`); }
      catch (error) { setStatus(`${summary} Export error: ${error instanceof Error ? error.message : String(error)}`); }
    } finally { setCapturing(false); }
  };

  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <Text style={{ color: colors.text }}>{status}</Text>
    <Text style={{ color: colors.muted }}>{connection ? `Connected ${connection.deviceName ?? connection.deviceId}; MTU ${String(connection.mtu)}; write ${connection.writeCharacteristicUuid}; notify ${connection.notifyCharacteristicUuid}` : "Not connected"}</Text>
    <Button title="Scan" color={colors.buttonBackground} disabled={!permitted || !!connection || connecting || capturing} onPress={startScan} />
    <Button title="Disconnect" color={colors.buttonBackground} disabled={!connection || pending} onPress={() => { teardown("Disconnected by user."); }} />
    <FlatList data={devices} keyExtractor={(item) => item.id} renderItem={({ item }) => <Button title={`${item.name ?? "Unnamed"} (${item.id}) RSSI ${item.rssi === undefined ? "?" : String(item.rssi)}`} color={colors.buttonBackground} disabled={!!connection || connecting} onPress={() => void connect(item)} />} />
    <TextInput style={[styles.input, inputColors]} value={note} onChangeText={setNote} placeholder="Vehicle-state note" placeholderTextColor={colors.placeholder} editable={!recordingActive} />
    <Button title={recordingActive ? "Stop recording" : "Start recording"} color={colors.buttonBackground} disabled={pending || capturing || (!recordingActive && !connection)} onPress={recordingActive ? stopRecording : startRecording} />
    <Button title="Run capture" color={colors.buttonBackground} disabled={!connection || !note.trim() || recordingActive || pending || capturing} onPress={() => void capture()} />
    {captureStep ? <Text style={{ color: colors.text }}>{captureStep}</Text> : null}
    {captureLast ? <Text style={{ color: colors.muted }}>{captureLast}</Text> : null}
    <TextInput style={[styles.input, inputColors]} value={command} onChangeText={setCommand} placeholder="Read-only command" placeholderTextColor={colors.placeholder} autoCapitalize="characters" />
    <Button title="Send" color={colors.buttonBackground} disabled={!connection || !recordingActive || pending || capturing} onPress={() => void send()} />
    <Button title="Export recording" color={colors.buttonBackground} disabled={!frozenJsonl || capturing} onPress={() => void exportRecording()} />
    <ScrollView style={[styles.console, { backgroundColor: colors.consoleBackground, borderColor: colors.border }]}>{transcript.map((line, index) => <Text key={index} style={[styles.consoleText, { color: colors.consoleText }]}>{line}</Text>)}</ScrollView>
  </View>;
}

const styles = StyleSheet.create({ container: { flex: 1, gap: 8, padding: 16 }, input: { borderWidth: 1, padding: 8 }, console: { borderWidth: 1, flex: 1, padding: 8 }, consoleText: { fontFamily: "monospace" } });
export default App;
