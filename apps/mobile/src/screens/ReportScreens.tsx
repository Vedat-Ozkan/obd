import type { BatteryDiagnosisReport } from "obd-battery/report";
import { View } from "react-native";
import { renderDriveReport, type DriveReport } from "../../../../packages/obd-battery/src/driveReport.js";
import { historyPoints, reportSummary } from "../app/reportView.js";
import { ScanHistory } from "../ui/charts.js";
import { Button, Chip, Hero, ListRow, SectionLabel, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

function checkedOn(scannedAt: string): string {
  return new Date(scannedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ReportHistory({ historyReports, driveReports, openReport, openDriveReport }: {
  historyReports: readonly BatteryDiagnosisReport[]; driveReports: readonly DriveReport[];
  openReport: (report: BatteryDiagnosisReport) => void; openDriveReport: (report: DriveReport) => void;
}) {
  const tokens = useTokens();
  const muted = { color: tokens.muted };
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
    <View>
      <SectionLabel>Drive reports</SectionLabel>
      {driveReports.length === 0 ? <Text style={muted}>No drive reports saved for this car.</Text> : null}
      {driveReports.map((report) => <ListRow key={`${report.scannedAt}-${report.recording}`} icon="car-arrow-right" title={when(report.scannedAt)}
        subtitle={`${String(report.minutes)} min drive`} onPress={() => { openDriveReport(report); }} />)}
    </View>
    <View style={{ gap: 8 }}>
      <SectionLabel>Charge logs</SectionLabel>
      <Text style={muted}>Charge logs are saved to your capture folder. Their capacity trend is on the car's Trends section.</Text>
    </View>
  </>;
}

function DriveReportView({ report }: { report: DriveReport }) {
  return <Text>{renderDriveReport(report)}</Text>;
}

function ReportSummary({ report, canCheck, canDrive, busy, openSection, openCodes, openCheck, openDrive, openAiSummary }: {
  report: BatteryDiagnosisReport; canCheck: boolean; canDrive?: boolean; busy: boolean; openSection: (section: "soc" | "cells" | "capacity" | "twelveVolt") => void;
  openCodes: () => void; openCheck: () => void; openDrive?: () => void; openAiSummary: () => void;
}) {
  const summary = reportSummary(report);
  const tokens = useTokens();
  const soc = summary.soc;
  const verdict = summary.verdict;
  const { groupAskMv, groupRedMv, spreadAskMv, spreadRedMv } = verdict.policy;
  const policySentence = `Project policy: group ask >${String(groupAskMv)} mV, group red >${String(groupRedMv)} mV; spread ask >${String(spreadAskMv)} mV, spread red >${String(spreadRedMv)} mV.`;
  const caption = `Checked ${checkedOn(report.scannedAt)}${report.scanStatus === "partial" ? " · partial scan" : ""}`;
  return <>
    <View accessibilityRole="summary" accessibilityLabel={[verdict.headline, verdict.scope, ...verdict.findings.map((finding) => finding.detail), policySentence.replaceAll(">", "over "), verdict.limitation, ...(report.scanStatus === "partial" ? ["Partial scan: some checks may be missing."] : []), ...verdict.coverage.map((item) => `${item.check}: ${item.status}${item.reason ? `. ${item.reason}` : ""}`)].join(" ")}
      style={{ padding: 16, borderRadius: 12, borderWidth: 1, borderColor: tokens.muted, gap: 8 }}>
      <SectionLabel>Red-flag screen</SectionLabel>
      <Text>{verdict.headline}</Text>
      <Text>{verdict.scope}</Text>
      {report.scanStatus === "partial" ? <Text>Partial scan: some checks may be missing.</Text> : null}
      {verdict.findings.map((finding, index) => <Text key={`${finding.check}-${String(index)}`}>{finding.detail}</Text>)}
      <Text>{policySentence}</Text>
      <Text>{verdict.limitation}</Text>
      {verdict.coverage.map((item) => <Text key={item.check}>{item.check}: {item.status}{item.reason ? ` — ${item.reason}` : ""}</Text>)}
    </View>
    <Hero label="State of charge" value={soc?.percent.toFixed(1)} unit={soc ? "%" : undefined} empty="Not read" percent={soc?.percent} caption={caption}
      onPress={() => { openSection("soc"); }} accessibilityLabel={`${soc ? `State of charge ${soc.percent.toFixed(1)} percent` : "State of charge not read"}, ${caption}. Opens state of charge.`} />
    <View>
      {summary.rows.map((row) => <ListRow key={row.section} title={row.label} subtitle={row.value} disabled={busy} right={<Chip rating={row.rating.rating} />}
        onPress={() => { if (row.section === "codes") openCodes(); else openSection(row.section); }} />)}
      {__DEV__ ? <ListRow icon="creation-outline" title="AI summary (development)" disabled={busy} onPress={openAiSummary} /> : null}
    </View>
    <Button title="Run a new check" disabled={busy || !canCheck} onPress={openCheck} />
    {canDrive && openDrive ? <Button title="Add a short drive" tonal disabled={busy || !canCheck} onPress={openDrive} /> : null}
  </>;
}

export { DriveReportView, ReportHistory, ReportSummary };
