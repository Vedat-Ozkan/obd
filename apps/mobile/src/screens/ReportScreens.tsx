import type { BatteryDiagnosisReport } from "obd-battery/report";
import { View } from "react-native";
import { batteryReportRows } from "../batteryScan.js";
import { reportSummary } from "../app/reportView.js";
import { Button, Card, Chip, Hero, ListRow, Text } from "../ui/kit.js";
import { usePalette } from "../ui/theme.js";

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

function checkedOn(scannedAt: string): string {
  return new Date(scannedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
