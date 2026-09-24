import { BleManager } from "react-native-ble-plx";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { Button, FlatList, PermissionsAndroid, Platform, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { connectVeepeak, scanDevices, type BleConnection, type ScannedDevice } from "./src/ble/BleTransport.js";
import { runCapture } from "./src/capture.js";
import { ConsoleSession } from "./src/console.js";
import { RecordingBuffer } from "./src/recording.js";
import { SUPPORTED_VEHICLES, canUseEquinoxConsole, vehicleAvailability, vehicleEvidence, type CatalogVehicle } from "./src/garage/catalog.js";
import { garageDocumentStore } from "./src/garage/documentStore.js";
import { LOCAL_INTEREST_NOTICE, createGarageFlow, type GarageState, type Interest, type Ownership } from "./src/garage/flow.js";

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

function EquinoxConsole({ vehicle }: { vehicle: CatalogVehicle }) {
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
    if (!canUseEquinoxConsole(vehicle)) { setStatus("Equinox console unavailable for this model year."); return undefined; }
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
    if (!canUseEquinoxConsole(vehicle)) { setStatus("Equinox capture unavailable for this model year."); return; }
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
    <Text style={{ color: colors.text, fontWeight: "bold" }}>2024 Chevrolet Equinox EV debug console and capture only</Text>
    <Text style={{ color: colors.text }}>{status}</Text>
    <Text style={{ color: colors.muted }}>{connection ? `Connected ${connection.deviceName ?? connection.deviceId}; MTU ${String(connection.mtu)}; write ${connection.writeCharacteristicUuid}; notify ${connection.notifyCharacteristicUuid}` : "Not connected"}</Text>
    <Button title="Scan" color={colors.buttonBackground} disabled={!permitted || !!connection || connecting || capturing} onPress={startScan} />
    <Button title="Disconnect" color={colors.buttonBackground} disabled={!connection || pending} onPress={() => { teardown("Disconnected by user."); }} />
    <FlatList data={devices} keyExtractor={(item) => item.id} renderItem={({ item }) => <Button title={`${item.name ?? "Unnamed"} (${item.id}) RSSI ${item.rssi === undefined ? "?" : String(item.rssi)}`} color={colors.buttonBackground} disabled={!!connection || connecting} onPress={() => void connect(item)} />} />
    <TextInput style={[styles.input, inputColors]} value={note} onChangeText={setNote} placeholder="Vehicle-state note" placeholderTextColor={colors.placeholder} editable={!recordingActive} />
    <Button title={recordingActive ? "Stop recording" : "Start recording"} color={colors.buttonBackground} disabled={!canUseEquinoxConsole(vehicle) || pending || capturing || (!recordingActive && !connection)} onPress={recordingActive ? stopRecording : startRecording} />
    <Button title="Run capture" color={colors.buttonBackground} disabled={!canUseEquinoxConsole(vehicle) || !connection || !note.trim() || recordingActive || pending || capturing} onPress={() => void capture()} />
    {captureStep ? <Text style={{ color: colors.text }}>{captureStep}</Text> : null}
    {captureLast ? <Text style={{ color: colors.muted }}>{captureLast}</Text> : null}
    <TextInput style={[styles.input, inputColors]} value={command} onChangeText={setCommand} placeholder="Read-only command" placeholderTextColor={colors.placeholder} autoCapitalize="characters" />
    <Button title="Send" color={colors.buttonBackground} disabled={!connection || !recordingActive || pending || capturing} onPress={() => void send()} />
    <Button title="Export recording" color={colors.buttonBackground} disabled={!frozenJsonl || capturing} onPress={() => void exportRecording()} />
    <ScrollView style={[styles.console, { backgroundColor: colors.consoleBackground, borderColor: colors.border }]}>{transcript.map((line, index) => <Text key={index} style={[styles.consoleText, { color: colors.consoleText }]}>{line}</Text>)}</ScrollView>
  </View>;
}

const garageFlow = createGarageFlow(garageDocumentStore);

export function App() {
  const colors = palettes[useColorScheme() === "dark" ? "dark" : "light"];
  const [state, setState] = useState<GarageState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"garage" | "picker" | "interest" | "console">("garage");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<number>();
  const [tag, setTag] = useState<Ownership>("mine");
  const [interest, setInterest] = useState({ make: "", model: "", year: "", joinBeta: false });
  const [interestSaved, setInterestSaved] = useState(false);
  const load = () => { setError(""); void garageFlow.load().then(setState, (cause: unknown) => { setError(`Garage load error: ${cause instanceof Error ? cause.message : String(cause)}`); }); };
  useEffect(load, []);
  const change = async (action: () => Promise<GarageState>, after?: () => void) => {
    setBusy(true); setError("");
    try { setState(await action()); after?.(); }
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

  if (!state) return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <Text style={title}>Garage</Text><Text style={normal}>{error || "Loading saved garage…"}</Text>
    {error ? <Button title="Retry garage load" onPress={load} /> : null}
  </View>;

  const consoleVehicle = SUPPORTED_VEHICLES.find((item) => item.id === "chevrolet-equinox-ev-2024");
  if (view === "console" && consoleVehicle && canUseEquinoxConsole(consoleVehicle)) return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Button title="Back to garage" onPress={() => { setView("garage"); }} />
    <EquinoxConsole vehicle={consoleVehicle} />
  </View>;

  return <ScrollView contentContainerStyle={[styles.garage, { backgroundColor: colors.background }]}>
    <Text style={title}>{view === "garage" ? "Garage" : view === "picker" ? "Add a vehicle" : "Unsupported vehicle interest"}</Text>
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
          <Button title={entry.ownership === "mine" ? "Change to checked" : "Change to mine"} disabled={busy} onPress={() => void change(() => garageFlow.changeOwnership(entry.id, entry.ownership === "mine" ? "checked" : "mine"))} />
          <Button title="Remove" disabled={busy} onPress={() => void change(() => garageFlow.remove(entry.id))} />
          {canUseEquinoxConsole(vehicle) ? <Button title="Open 2024 Equinox-only debug console" disabled={busy} onPress={() => { if (canUseEquinoxConsole(vehicle)) setView("console"); }} /> : null}
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
