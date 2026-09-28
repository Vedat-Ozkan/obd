import { renderBatteryDiagnosis, type BatteryDiagnosisReport } from "obd-battery/report";
import { ScrollView } from "react-native";
import { batteryReportRows } from "../batteryScan.js";
import type { GarageVehicle } from "../garage/flow.js";
import { Button, Card, Screen, styles, Text } from "../ui/kit.js";
import { usePalette, useTokens } from "../ui/theme.js";
import { DevelopmentSummary } from "./DevelopmentSummary.js";

function ReportHistory({ historyReports, openReport }: { historyReports: readonly BatteryDiagnosisReport[]; openReport: (report: BatteryDiagnosisReport) => void }) {
  const colors = usePalette();
  const normal = { color: colors.text };
  const muted = { color: colors.muted };
  return <>
    {historyReports.length === 0 ? <Text style={normal}>No battery reports saved for this car.</Text> : null}
    {batteryReportRows(historyReports).map((row) => <Card key={`${row.report.scannedAt}-${row.report.recording}`}>
      <Text style={normal}>{row.label}</Text>
      <Text style={muted}>{row.report.recording}</Text>
      <Button title="Open report" onPress={() => { openReport(row.report); }} />
    </Card>)}
  </>;
}

function ReportDetail({ detail, selectedEntry, openHistory, error }: { detail: BatteryDiagnosisReport; selectedEntry: GarageVehicle; openHistory: (id: string) => Promise<void>; error: string }) {
  const colors = usePalette();
  const tokens = useTokens();
  return <Screen>
    <Button title="Back to report history" onPress={() => { void openHistory(selectedEntry.id); }} />
    {error ? <Text style={{ color: tokens.error }}>{error}</Text> : null}
    <ScrollView style={[styles.console, { backgroundColor: colors.consoleBackground, borderColor: colors.border }]}>
      <Text style={[styles.consoleText, { color: colors.consoleText }]}>{renderBatteryDiagnosis(detail)}</Text>
      {__DEV__ ? <DevelopmentSummary key={`${detail.scannedAt}-${detail.recording}`} report={detail} /> : null}
    </ScrollView>
  </Screen>;
}

export { ReportDetail, ReportHistory };
