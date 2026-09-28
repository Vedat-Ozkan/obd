import type { BatteryDiagnosisReport } from "obd-battery/report";
import { Alert, View } from "react-native";
import { Button as TextButton } from "react-native-paper";
import { removeGarageVehicleWithReports } from "../batteryScan.js";
import { canUseEquinoxConsole, vehicleAvailability, type CatalogVehicle } from "../garage/catalog.js";
import type { GarageState, GarageVehicle, Ownership } from "../garage/flow.js";
import { batteryHistory, garageFlow } from "../app/runtime.js";
import { socHero } from "../app/reportView.js";
import { Button, Hero, ListRow, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";
import { ownershipLabel } from "./GarageScreen.js";

type Change = (action: () => Promise<GarageState>, after?: () => void) => Promise<void>;

function checkedOn(scannedAt: string): string {
  return new Date(scannedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** One car (spec §Screens 2). `reports` is this car's saved history, newest first (batteryHistory.list). */
function CarScreen({ entry, vehicle, reports, busy, change, openReport, openCheck, openHistory, onRemoved }: {
  entry: GarageVehicle; vehicle: CatalogVehicle; reports: readonly BatteryDiagnosisReport[]; busy: boolean; change: Change;
  openReport: (report: BatteryDiagnosisReport) => void; openCheck: (intent: "check" | "charge") => void; openHistory: () => void; onRemoved: () => void;
}) {
  const tokens = useTokens();
  const latest = reports.at(0);
  const hero = latest ? socHero(latest) : undefined;
  const usable = canUseEquinoxConsole(vehicle);
  const setOwnership = (ownership: Ownership) => {
    if (ownership !== entry.ownership) void change(() => garageFlow.changeOwnership(entry.id, ownership));
  };
  const chooseOwnership = () => {
    Alert.alert("Ownership", "Is this your car, or one you are checking?", [
      { text: "Cancel", style: "cancel" },
      { text: "Checking", onPress: () => { setOwnership("checked"); } },
      { text: "Mine", onPress: () => { setOwnership("mine"); } },
    ]);
  };
  const remove = () => {
    Alert.alert("Remove from garage?", "This car is removed from the garage on this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => {
        void change(async () => { await removeGarageVehicleWithReports(garageFlow, batteryHistory, entry.id); return garageFlow.load(); }, onRemoved);
      } },
    ]);
  };
  return <>
    {latest ? <Hero label="State of charge" value={hero?.percent.toFixed(1)} unit={hero ? "%" : undefined} empty="Not read" percent={hero?.percent}
      caption={`Last check ${checkedOn(latest.scannedAt)}`} onPress={() => { openReport(latest); }}
      accessibilityLabel={`${hero ? `State of charge ${hero.percent.toFixed(1)} percent` : "State of charge not read"}, last check ${checkedOn(latest.scannedAt)}. Opens the latest report.`} />
      : <Hero label="State of charge" empty="No check yet" accessibilityLabel="State of charge: no check yet" />}
    {usable ? null : <Text style={{ color: tokens.muted }}>{vehicleAvailability(vehicle)}</Text>}
    <Button title="Run check" disabled={busy || !usable} onPress={() => { openCheck("check"); }} />
    <Button title="Log a charge" tonal disabled={busy || !usable} onPress={() => { openCheck("charge"); }} />
    <View>
      <ListRow icon="history" title="Report history" right={String(reports.length)} disabled={busy} onPress={openHistory} />
      <ListRow icon="account-outline" title="Ownership" right={ownershipLabel(entry.ownership)} disabled={busy} onPress={chooseOwnership} />
    </View>
    <View style={{ alignItems: "flex-start" }}>
      <TextButton mode="text" textColor={tokens.error} disabled={busy} onPress={remove} style={{ minHeight: 48, justifyContent: "center" }}>Remove from garage</TextButton>
    </View>
  </>;
}

export { CarScreen };
