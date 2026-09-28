import { Switch, View } from "react-native";
import { CONSENT_SWITCH_LABEL, PRIVACY_NOTE } from "../beta/consent.js";
import type { BetaStatus } from "../beta/outbox.js";
import { removeGarageVehicleWithReports } from "../batteryScan.js";
import { SUPPORTED_VEHICLES, canUseEquinoxConsole, vehicleAvailability } from "../garage/catalog.js";
import { LOCAL_INTEREST_NOTICE, type GarageState, type Interest } from "../garage/flow.js";
import { batteryHistory, garageFlow } from "../app/runtime.js";
import { Button, Card, styles, Text } from "../ui/kit.js";
import { usePalette } from "../ui/theme.js";

function GarageScreen({ state, reportCounts, busy, beta, betaMessage, privacyOpen, setPrivacyOpen, openHistory, change, setSelectedEntryId, setView, clearPicker, reopenInterest, decideBeta, setConsentOpen, deleteBeta }: {
  state: GarageState; reportCounts: Record<string, number>; busy: boolean; beta: BetaStatus; betaMessage: string; privacyOpen: boolean; setPrivacyOpen: (open: boolean) => void;
  openHistory: (id: string) => Promise<void>; change: (action: () => Promise<GarageState>, after?: () => void) => Promise<void>; setSelectedEntryId: (id: string) => void; setView: (view: "console") => void;
  clearPicker: () => void; reopenInterest: (saved?: Interest) => void; decideBeta: (share: boolean) => Promise<void>; setConsentOpen: (open: boolean) => void; deleteBeta: () => void;
}) {
  const colors = usePalette();
  const normal = { color: colors.text };
  const muted = { color: colors.muted };
  return <>
    <Text style={muted}>Vehicles and interests are saved privately on this phone.</Text>
    {state.vehicles.length === 0 ? <Text style={normal}>No vehicles yet.</Text> : null}
    {state.vehicles.map((entry) => {
      const vehicle = SUPPORTED_VEHICLES.find((item) => item.id === entry.catalogId);
      if (!vehicle) return null;
      return <Card key={entry.id}>
        <Text style={normal}>{vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.tier} · {entry.ownership}</Text>
        <Text style={muted}>{vehicleAvailability(vehicle)}</Text>
        <Text style={muted}>Battery reports: {String(reportCounts[entry.id] ?? 0)}</Text>
        <Button title="Report history" disabled={busy} onPress={() => { void openHistory(entry.id); }} />
        <Button title={entry.ownership === "mine" ? "Change to checked" : "Change to mine"} disabled={busy} onPress={() => void change(() => garageFlow.changeOwnership(entry.id, entry.ownership === "mine" ? "checked" : "mine"))} />
        <Button title="Remove" disabled={busy} onPress={() => void change(async () => { await removeGarageVehicleWithReports(garageFlow, batteryHistory, entry.id); return garageFlow.load(); })} />
        {canUseEquinoxConsole(vehicle) ? <Button title="Open battery diagnosis and debug console" disabled={busy} onPress={() => { setSelectedEntryId(entry.id); setView("console"); }} /> : null}
      </Card>;
    })}
    <Button title="Add supported vehicle" disabled={busy} onPress={clearPicker} />
    <Button title="My unsupported vehicle" disabled={busy} onPress={() => { reopenInterest(); }} />
    {state.interests.map((saved, index) => <Card key={`${saved.make}-${saved.model}-${String(saved.year)}-${String(index)}`}>
      <Text style={normal}>{saved.year} {saved.make} {saved.model} · beta interest {saved.joinBeta ? "yes" : "no"}</Text>
      <Text style={muted}>{LOCAL_INTEREST_NOTICE}</Text>
      <Button title="Reopen saved interest" onPress={() => { reopenInterest(saved); }} />
    </Card>)}
    <Card>
      <Text style={normal}>Beta data sharing</Text>
      {/* Switching on shows the consent text again; switching off stops at once. */}
      <View style={styles.row}><Switch value={beta.sharing} disabled={busy} onValueChange={(on) => { if (on) setConsentOpen(true); else void decideBeta(false); }} /><Text style={normal}>{CONSENT_SWITCH_LABEL}</Text></View>
      <Text style={muted}>{beta.line}</Text>
      {beta.betaId ? <Text style={normal}>Beta ID: {beta.betaId}</Text> : null}
      {betaMessage ? <Text style={normal}>{betaMessage}</Text> : null}
      <Text style={[normal, { textDecorationLine: "underline" }]} onPress={() => { setPrivacyOpen(!privacyOpen); }}>Privacy note</Text>
      {privacyOpen ? <Text style={normal}>{PRIVACY_NOTE}</Text> : null}
      <Button title="Delete my data" disabled={busy} onPress={deleteBeta} />
    </Card>
  </>;
}

export { GarageScreen };
