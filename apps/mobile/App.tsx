import { useEffect, useState, type ReactNode } from "react";
import type { BatteryDiagnosisReport } from "obd-battery/report";
import { Alert, AppState, BackHandler, StatusBar, View } from "react-native";
import { useFonts } from "expo-font";
import { Manrope_500Medium } from "@expo-google-fonts/manrope/500Medium";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { Manrope_800ExtraBold } from "@expo-google-fonts/manrope/800ExtraBold";
import { JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono/600SemiBold";
import { IconButton, PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { BetaStatus } from "./src/beta/outbox.js";
import { SUPPORTED_VEHICLES, canUseEquinoxConsole } from "./src/garage/catalog.js";
import type { GarageState, Interest, Ownership } from "./src/garage/flow.js";
import { back, type Route } from "./src/app/navigation.js";
import { findReport } from "./src/app/reportView.js";
import { batteryHistory, betaOutbox, garageFlow, loadThemePreference } from "./src/app/runtime.js";
import { Button, Screen, styles, Text } from "./src/ui/kit.js";
import { FONTS, paperTheme, setThemePreference, useScheme, useTokens } from "./src/ui/theme.js";
import { AddVehicleScreen, InterestScreen } from "./src/screens/AddVehicleScreen.js";
import { CarScreen } from "./src/screens/CarScreen.js";
import { ConsentScreen } from "./src/screens/ConsentScreen.js";
import { EquinoxConsole } from "./src/screens/ConsoleScreen.js";
import { GarageScreen } from "./src/screens/GarageScreen.js";
import { DevelopmentSummary } from "./src/screens/DevelopmentSummary.js";
import { ReportHistory, ReportSummary } from "./src/screens/ReportScreens.js";
import { CodesScreen, ModuleScreen, SECTION_TITLES, SectionScreen } from "./src/screens/SectionScreens.js";
import { BetaScreen, LicensesScreen, PrivacyScreen, SaveFolderScreen, SettingsScreen, ThemeScreen } from "./src/screens/SettingsScreens.js";

function TopBar({ title, onBack, action }: { title: string; onBack?: () => void; action?: ReactNode }) {
  const tokens = useTokens();
  return <View style={[styles.row, { minHeight: 56 }]}>
    {onBack ? <IconButton icon="arrow-left" iconColor={tokens.text} size={24} style={{ margin: 0, width: 48, height: 48 }} accessibilityLabel="Back" onPress={onBack} /> : null}
    <Text accessibilityRole="header" style={[styles.h1, { flex: 1 }]}>{title}</Text>
    {action}
  </View>;
}

export function App() {
  const tokens = useTokens();
  const [state, setState] = useState<GarageState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stack, setStack] = useState<readonly Route[]>([{ name: "garage" }]);
  const [historyReports, setHistoryReports] = useState<readonly BatteryDiagnosisReport[]>([]);
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
  const [locked, setLocked] = useState(false);
  const route: Route = stack[stack.length - 1] ?? { name: "garage" };
  const push = (next: Route) => { setError(""); setStack((current) => [...current, next]); };
  const pop = () => { setError(""); setStack((current) => current.length > 1 ? current.slice(0, -1) : current); };
  const refreshBeta = () => { void betaOutbox.status().then(setBeta); };
  useEffect(() => {
    const drain = () => { refreshBeta(); void betaOutbox.drain().then(refreshBeta); };
    drain();
    const subscription = AppState.addEventListener("change", (next) => { if (next === "active") drain(); });
    return () => { subscription.remove(); };
  }, []);
  useEffect(refreshBeta, [stack]);
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
  const refreshReports = async () => { await batteryHistory.load(); };
  const load = () => { setError(""); void garageFlow.load().then(async (garage) => { await refreshReports(); setState(garage); }, (cause: unknown) => { setError(`Saved data load error: ${cause instanceof Error ? cause.message : String(cause)}`); }).catch((cause: unknown) => { setError(`Saved data load error: ${cause instanceof Error ? cause.message : String(cause)}`); }); };
  useEffect(load, []);
  const change = async (action: () => Promise<GarageState>, after?: () => void) => {
    setBusy(true); setError("");
    try { const next = await action(); await refreshReports(); setState(next); after?.(); }
    catch (cause) { setError(`Garage storage error: ${cause instanceof Error ? cause.message : String(cause)}`); }
    finally { setBusy(false); }
  };
  const title = { color: tokens.text, fontWeight: "bold" as const, fontSize: 20 };
  const normal = { color: tokens.text };
  const clearPicker = () => { setMake(""); setModel(""); setYear(undefined); setTag("mine"); push({ name: "addVehicle" }); };
  const reopenInterest = (saved?: Interest) => {
    setInterest(saved ? { make: saved.make, model: saved.model, year: String(saved.year), joinBeta: saved.joinBeta } : { make: "", model: "", year: "", joinBeta: false });
    setInterestSaved(!!saved); push(saved ? { name: "interest", saved } : { name: "interest" });
  };
  const listReports = async (id: string) => {
    try { const reports = await batteryHistory.list(id); setHistoryReports(reports); return true; }
    catch (cause) { setError(`Battery report history error: ${cause instanceof Error ? cause.message : String(cause)}`); return false; }
  };
  const openCar = async (id: string) => { setError(""); if (await listReports(id)) push({ name: "car", entryId: id }); };
  const openHistory = async (id: string) => {
    setError("");
    if (!await listReports(id)) return;
    setStack((current) => {
      const at = current.findIndex((item) => item.name === "history" && item.entryId === id);
      return at >= 0 ? current.slice(0, at + 1) : [...current, { name: "history", entryId: id }];
    });
  };
  const openReport = (report: BatteryDiagnosisReport) => { push({ name: "report", entryId: report.garageVehicleId, scannedAt: report.scannedAt, recording: report.recording }); };
  const openSaved = async (report: BatteryDiagnosisReport) => {
    const reports = await batteryHistory.list(report.garageVehicleId);
    const persisted = reports.find((item) => item.scannedAt === report.scannedAt && item.recording === report.recording);
    if (!persisted) throw new Error("Saved diagnosis could not be reopened from private history.");
    await refreshReports();
    setHistoryReports(reports);
    setStack((current) => [...current.filter((item) => item.name !== "check"), { name: "report", entryId: persisted.garageVehicleId, scannedAt: persisted.scannedAt, recording: persisted.recording }]);
  };

  const consentVisible = beta !== undefined && (route.name === "garage" || route.name === "beta") && (beta.needsConsent || consentOpen);
  useEffect(() => { if (consentVisible) setConsentShare(false); }, [consentVisible]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (consentVisible && !beta.needsConsent) { setConsentOpen(false); return true; }
      const next = back(stack, locked);
      if (next === "exit") return false;
      if (next !== "blocked") { setError(""); setStack(next); }
      return true;
    });
    return () => { subscription.remove(); };
  }, [stack, consentVisible, beta, locked]);

  if (beta && consentVisible) return <ConsentScreen beta={beta} betaMessage={betaMessage} consentShare={consentShare} setConsentShare={setConsentShare} busy={busy} decideBeta={decideBeta} />;

  if (!beta) return <Screen>
    <Text style={title}>Garage</Text><Text style={normal}>Loading beta sharing…</Text>
  </Screen>;

  if (!state) return <Screen>
    <Text style={title}>Garage</Text><Text style={normal}>{error || "Loading saved garage…"}</Text>
    {error ? <Button title="Retry garage load" onPress={load} /> : null}
  </Screen>;

  const selectedEntry = "entryId" in route ? state.vehicles.find((entry) => entry.id === route.entryId) : undefined;
  const selectedVehicle = SUPPORTED_VEHICLES.find((item) => item.id === selectedEntry?.catalogId);
  if (route.name === "check" && selectedEntry && selectedVehicle && canUseEquinoxConsole(selectedVehicle)) return <View style={{ flex: 1, backgroundColor: tokens.bg }}>
    <EquinoxConsole vehicle={selectedVehicle} entry={selectedEntry} intent={route.intent} onBack={pop} onSaved={openSaved} onLockChange={setLocked} />
  </View>;

  const page = (heading: string, body: ReactNode, action?: ReactNode) => <Screen scroll blocks>
    <TopBar title={heading} onBack={stack.length > 1 ? pop : undefined} action={action} />
    {error ? <Text style={{ color: tokens.error }}>{error}</Text> : null}
    {body}
  </Screen>;
  const vehicleName = selectedVehicle ? `${String(selectedVehicle.year)} ${selectedVehicle.make} ${selectedVehicle.model}` : "";

  if (route.name === "car" && selectedEntry && selectedVehicle) return page(vehicleName, <CarScreen entry={selectedEntry} vehicle={selectedVehicle} reports={historyReports} busy={busy} change={change}
    openReport={openReport} openCheck={(intent) => { push({ name: "check", entryId: selectedEntry.id, intent }); }} openHistory={() => { void openHistory(selectedEntry.id); }} onRemoved={pop} />);
  const routeReport = "scannedAt" in route ? findReport(historyReports, route) : undefined;
  if (routeReport && selectedEntry && selectedVehicle) {
    const key = { entryId: selectedEntry.id, scannedAt: routeReport.scannedAt, recording: routeReport.recording };
    const canCheck = canUseEquinoxConsole(selectedVehicle);
    const openCheck = (intent: "check" | "charge") => { push({ name: "check", entryId: selectedEntry.id, intent }); };
    if (route.name === "report") return page("Battery report", <ReportSummary report={routeReport} canCheck={canCheck} busy={busy} openSection={(section) => { push({ name: "section", ...key, section }); }}
      openCodes={() => { push({ name: "codes", ...key }); }} openCheck={() => { openCheck("check"); }} openAiSummary={() => { push({ name: "aiSummary", ...key }); }} />);
    if (route.name === "section") return page(SECTION_TITLES[route.section], <SectionScreen report={routeReport} section={route.section} history={historyReports} canCheck={canCheck} busy={busy} openCharge={() => { openCheck("charge"); }} />);
    if (route.name === "codes") return page("Diagnostic codes", <CodesScreen codes={routeReport.codes} busy={busy} openModule={(ecu) => { push({ name: "module", ...key, ecu }); }} />);
    if (route.name === "module") return page(`Module ${route.ecu}`, <ModuleScreen codes={routeReport.codes} ecu={route.ecu} />);
    if (route.name === "aiSummary" && __DEV__) return page("AI summary (development)", <DevelopmentSummary key={`${routeReport.scannedAt}-${routeReport.recording}`} report={routeReport} />);
  }
  if (route.name === "history") return page("Report history", <ReportHistory historyReports={historyReports} openReport={openReport} />);
  if (route.name === "addVehicle") return page("Add a vehicle", <AddVehicleScreen make={make} setMake={setMake} model={model} setModel={setModel} year={year} setYear={setYear} tag={tag} setTag={setTag} busy={busy} change={change} onAdded={pop} reopenInterest={reopenInterest} interests={state.interests} />);
  if (route.name === "interest") return page("Unsupported vehicle interest", <InterestScreen interest={interest} setInterest={setInterest} interestSaved={interestSaved} setInterestSaved={setInterestSaved} busy={busy} change={change} />);
  if (route.name === "settings") return page("Settings", <SettingsScreen beta={beta} openBeta={() => { push({ name: "beta" }); }} openSaveFolder={() => { push({ name: "saveFolder" }); }}
    openTheme={() => { push({ name: "theme" }); }} openPrivacy={() => { push({ name: "privacy" }); }} openLicenses={() => { push({ name: "licenses" }); }} />);
  if (route.name === "beta") return page("Beta data sharing", <BetaScreen beta={beta} betaMessage={betaMessage} busy={busy} decideBeta={decideBeta} setConsentOpen={setConsentOpen} deleteBeta={deleteBeta} />);
  if (route.name === "theme") return page("Theme", <ThemeScreen />);
  if (route.name === "saveFolder") return page("Save folder", <SaveFolderScreen />);
  if (route.name === "privacy") return page("Privacy note", <PrivacyScreen />);
  if (route.name === "licenses") return page("Open-source licenses", <LicensesScreen />);
  return page("Garage", <GarageScreen state={state} busy={busy} openCar={(id) => { void openCar(id); }} addVehicle={clearPicker} />,
    <IconButton icon="cog-outline" iconColor={tokens.text} size={24} style={{ margin: 0, width: 48, height: 48 }} accessibilityLabel="Settings" onPress={() => { push({ name: "settings" }); }} />);
}

export function Root() {
  const scheme = useScheme();
  const [fontsLoaded, fontError] = useFonts({ [FONTS.medium]: Manrope_500Medium, [FONTS.semibold]: Manrope_600SemiBold, [FONTS.bold]: Manrope_700Bold, [FONTS.extrabold]: Manrope_800ExtraBold, [FONTS.mono]: JetBrainsMono_600SemiBold });
  const [themeLoaded, setThemeLoaded] = useState(false);
  useEffect(() => { void loadThemePreference().then((preference) => { setThemePreference(preference); setThemeLoaded(true); }); }, []);
  if ((!fontsLoaded && !fontError) || !themeLoaded) return null;
  return <SafeAreaProvider>
    <PaperProvider theme={paperTheme(scheme)}>
      <StatusBar barStyle={scheme === "dark" ? "light-content" : "dark-content"} />
      <App />
    </PaperProvider>
  </SafeAreaProvider>;
}

export default Root;
