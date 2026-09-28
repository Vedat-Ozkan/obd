import { useEffect, useState } from "react";
import type { BatteryDiagnosisReport } from "obd-battery/report";
import { Alert, AppState, StatusBar, View } from "react-native";
import { useFonts } from "expo-font";
import { Manrope_500Medium } from "@expo-google-fonts/manrope/500Medium";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { Manrope_800ExtraBold } from "@expo-google-fonts/manrope/800ExtraBold";
import { JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono/600SemiBold";
import { PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { BetaStatus } from "./src/beta/outbox.js";
import { SUPPORTED_VEHICLES, canUseEquinoxConsole } from "./src/garage/catalog.js";
import type { GarageState, Interest, Ownership } from "./src/garage/flow.js";
import { batteryHistory, betaOutbox, garageFlow } from "./src/app/runtime.js";
import { Button, Screen, Text } from "./src/ui/kit.js";
import { FONTS, paperTheme, usePalette, useScheme } from "./src/ui/theme.js";
import { AddVehicleScreen, InterestScreen } from "./src/screens/AddVehicleScreen.js";
import { ConsentScreen } from "./src/screens/ConsentScreen.js";
import { EquinoxConsole } from "./src/screens/ConsoleScreen.js";
import { GarageScreen } from "./src/screens/GarageScreen.js";
import { ReportDetail, ReportHistory } from "./src/screens/ReportScreens.js";

export function App() {
  const colors = usePalette();
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
  const [beta, setBeta] = useState<BetaStatus>();
  const [consentShare, setConsentShare] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [betaMessage, setBetaMessage] = useState("");
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const refreshBeta = () => { void betaOutbox.status().then(setBeta); };
  // T2.9: uploads resume by themselves on start and whenever the app comes to the foreground.
  useEffect(() => {
    const drain = () => { refreshBeta(); void betaOutbox.drain().then(refreshBeta); };
    drain();
    const subscription = AppState.addEventListener("change", (next) => { if (next === "active") drain(); });
    return () => { subscription.remove(); };
  }, []);
  useEffect(refreshBeta, [view]);
  const decideBeta = async (share: boolean) => {
    setBusy(true); setBetaMessage("");
    try { await betaOutbox.decide(share); if (share) void betaOutbox.drain().then(refreshBeta); }
    catch (cause) { setBetaMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setConsentOpen(false); setConsentShare(false); setBusy(false); refreshBeta(); }
  };
  const deleteBeta = () => {
    Alert.alert("Delete my data?", "Every beta file already uploaded from this phone is deleted, and sharing turns off.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        setBusy(true);
        void betaOutbox.deleteMyData().then(setBetaMessage).finally(() => { setBusy(false); refreshBeta(); });
      } },
    ]);
  };
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

  const consentVisible = beta !== undefined && view === "garage" && (beta.needsConsent || consentOpen);
  // Every appearance of the consent screen starts unticked, even after an async view change left it mid-choice.
  useEffect(() => { if (consentVisible) setConsentShare(false); }, [consentVisible]);

  if (beta && consentVisible) return <ConsentScreen beta={beta} betaMessage={betaMessage} consentShare={consentShare} setConsentShare={setConsentShare} busy={busy} decideBeta={decideBeta} />;

  // Until the beta status is known, nothing that starts a run is shown: the consent screen may still be due.
  if (!beta) return <Screen>
    <Text style={title}>Garage</Text><Text style={normal}>Loading beta sharing…</Text>
  </Screen>;

  if (!state) return <Screen>
    <Text style={title}>Garage</Text><Text style={normal}>{error || "Loading saved garage…"}</Text>
    {error ? <Button title="Retry garage load" onPress={load} /> : null}
  </Screen>;

  const selectedEntry = state.vehicles.find((entry) => entry.id === selectedEntryId);
  const consoleVehicle = SUPPORTED_VEHICLES.find((item) => item.id === selectedEntry?.catalogId);
  if (view === "console" && selectedEntry && consoleVehicle && canUseEquinoxConsole(consoleVehicle)) return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <EquinoxConsole vehicle={consoleVehicle} entry={selectedEntry} onBack={() => { setView("garage"); }} onSaved={openSaved} />
  </View>;

  if (view === "detail" && detail && selectedEntry) return <ReportDetail detail={detail} selectedEntry={selectedEntry} openHistory={openHistory} error={error} />;

  return <Screen scroll>
    <Text style={title}>{view === "garage" ? "Garage" : view === "picker" ? "Add a vehicle" : view === "history" ? `Battery reports for car ${selectedEntryId ?? ""}` : "Unsupported vehicle interest"}</Text>
    {error ? <Text style={{ color: "#B00020" }}>{error}</Text> : null}
    {view !== "garage" ? <Button title="Back to garage" onPress={() => { setView("garage"); }} /> : null}
    {view === "garage" ? <GarageScreen state={state} reportCounts={reportCounts} busy={busy} beta={beta} betaMessage={betaMessage} privacyOpen={privacyOpen} setPrivacyOpen={setPrivacyOpen} openHistory={openHistory} change={change} setSelectedEntryId={setSelectedEntryId} setView={setView} clearPicker={clearPicker} reopenInterest={reopenInterest} decideBeta={decideBeta} setConsentOpen={setConsentOpen} deleteBeta={deleteBeta} /> : null}
    {view === "history" ? <ReportHistory historyReports={historyReports} setDetail={setDetail} setView={setView} /> : null}
    {view === "picker" ? <AddVehicleScreen make={make} setMake={setMake} model={model} setModel={setModel} year={year} setYear={setYear} tag={tag} setTag={setTag} busy={busy} change={change} setView={setView} reopenInterest={reopenInterest} /> : null}
    {view === "interest" ? <InterestScreen interest={interest} setInterest={setInterest} interestSaved={interestSaved} setInterestSaved={setInterestSaved} busy={busy} change={change} /> : null}
  </Screen>;
}

/** Providers, fonts and a status bar that follows the scheme; App itself is unchanged below them. */
export function Root() {
  const scheme = useScheme();
  const [fontsLoaded, fontError] = useFonts({ [FONTS.medium]: Manrope_500Medium, [FONTS.semibold]: Manrope_600SemiBold, [FONTS.bold]: Manrope_700Bold, [FONTS.extrabold]: Manrope_800ExtraBold, [FONTS.mono]: JetBrainsMono_600SemiBold });
  // A font that fails to load falls back to the system font rather than blocking the app.
  if (!fontsLoaded && !fontError) return null;
  return <SafeAreaProvider>
    <PaperProvider theme={paperTheme(scheme)}>
      <StatusBar barStyle={scheme === "dark" ? "light-content" : "dark-content"} />
      <App />
    </PaperProvider>
  </SafeAreaProvider>;
}

export default Root;
