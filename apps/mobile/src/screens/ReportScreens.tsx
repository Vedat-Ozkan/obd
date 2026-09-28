import type { BatteryDiagnosisReport } from "obd-battery/report";
import { View } from "react-native";
import { historyPoints, reportSummary } from "../app/reportView.js";
import { ScanHistory } from "../ui/charts.js";
import { Button, Chip, Hero, ListRow, SectionLabel, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

function checkedOn(scannedAt: string): string {
  return new Date(scannedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * History (spec §Screens 6): chart 2, the battery checks (newest first, as batteryHistory.list returns them), then charge logs.
 * Charge-log files are not linked to a garage car yet, so that section is an honest empty state (spec §Decisions 4).
 */
function ReportHistory({ historyReports, openReport }: { historyReports: readonly BatteryDiagnosisReport[]; openReport: (report: BatteryDiagnosisReport) => void }) {
  const tokens = useTokens();
  const muted = { color: tokens.muted };
  // Two checks on one day are told apart by the time.
  const when = (scannedAt: string) => new Date(scannedAt).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <>
    <View style={{ gap: 8 }}>
      <SectionLabel>Scan history</SectionLabel>
      <ScanHistory points={historyPoints(historyReports)} />
    </View>
    <View>
      <SectionLabel>Battery checks</SectionLabel>
      {historyReports.length === 0 ? <Text style={muted}>No battery checks saved for this car.</Text> : null}
      {historyReports.map((report) => <ListRow key={`${report.scannedAt}-${report.recording}`} icon="car-battery" title={when(report.scannedAt)}
        subtitle={report.scanStatus === "partial" ? "Partial scan" : "Complete scan"} onPress={() => { openReport(report); }} />)}
    </View>
    <View style={{ gap: 8 }}>
      <SectionLabel>Charge logs</SectionLabel>
      <Text style={muted}>Charge logs are saved to your capture folder; showing them per car comes later.</Text>
    </View>
  </>;
}

/** Report summary (spec §Screens 3): the SoC hero, four rows with value and rating chip, and one primary action. */
function ReportSummary({ report, canCheck, busy, openSection, openCodes, openCheck, openAiSummary }: {
  report: BatteryDiagnosisReport; canCheck: boolean; busy: boolean; openSection: (section: "soc" | "cells" | "capacity" | "twelveVolt") => void;
  openCodes: () => void; openCheck: () => void; openAiSummary: () => void;
}) {
  const summary = reportSummary(report);
  const soc = summary.soc;
  const caption = `Checked ${checkedOn(report.scannedAt)}${report.scanStatus === "partial" ? " · partial scan" : ""}`;
  return <>
    <Hero label="State of charge" value={soc?.percent.toFixed(1)} unit={soc ? "%" : undefined} empty="Not read" percent={soc?.percent} caption={caption}
      onPress={() => { openSection("soc"); }} accessibilityLabel={`${soc ? `State of charge ${soc.percent.toFixed(1)} percent` : "State of charge not read"}, ${caption}. Opens state of charge.`} />
    <View>
      {summary.rows.map((row) => <ListRow key={row.section} title={row.label} subtitle={row.value} disabled={busy} right={<Chip rating={row.rating.rating} />}
        onPress={() => { if (row.section === "codes") openCodes(); else openSection(row.section); }} />)}
      {__DEV__ ? <ListRow icon="creation-outline" title="AI summary (development)" disabled={busy} onPress={openAiSummary} /> : null}
    </View>
    <Button title="Run a new check" disabled={busy || !canCheck} onPress={openCheck} />
  </>;
}

export { ReportHistory, ReportSummary };
