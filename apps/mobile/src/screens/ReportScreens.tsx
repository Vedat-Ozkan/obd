import type { BatteryDiagnosisReport } from "obd-battery/report";
import { View } from "react-native";
import { historyPoints, reportSummary } from "../app/reportView.js";
import { ScanHistory } from "../ui/charts.js";
import { Button, Chip, Hero, ListRow, SectionLabel, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

function checkedOn(scannedAt: string): string {
  return new Date(scannedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ReportHistory({ historyReports, openReport }: { historyReports: readonly BatteryDiagnosisReport[]; openReport: (report: BatteryDiagnosisReport) => void }) {
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
    <View style={{ gap: 8 }}>
      <SectionLabel>Charge logs</SectionLabel>
      <Text style={muted}>Charge logs are saved to your capture folder; showing them per car comes later.</Text>
    </View>
  </>;
}

function ReportSummary({ report, canCheck, busy, openSection, openCodes, openCheck, openAiSummary }: {
  report: BatteryDiagnosisReport; canCheck: boolean; busy: boolean; openSection: (section: "soc" | "cells" | "capacity" | "twelveVolt") => void;
  openCodes: () => void; openCheck: () => void; openAiSummary: () => void;
}) {
  const summary = reportSummary(report);
  const tokens = useTokens();
  const soc = summary.soc;
  const verdict = summary.verdict;
  const caption = `Checked ${checkedOn(report.scannedAt)}${report.scanStatus === "partial" ? " · partial scan" : ""}`;
  return <>
    <View accessibilityRole="summary" accessibilityLabel={[verdict.headline, verdict.scope, ...verdict.findings.map((finding) => finding.detail), `Project policy: group ask over ${String(verdict.policy.groupAskMv)} mV, group red over ${String(verdict.policy.groupRedMv)} mV; spread ask over ${String(verdict.policy.spreadAskMv)} mV, spread red over ${String(verdict.policy.spreadRedMv)} mV.`, verdict.limitation, ...(report.scanStatus === "partial" ? ["Partial scan: some checks may be missing."] : []), ...verdict.coverage.map((item) => `${item.check}: ${item.status}${item.reason ? `. ${item.reason}` : ""}`)].join(" ")}
      style={{ padding: 16, borderRadius: 12, borderWidth: 1, borderColor: tokens.muted, gap: 8 }}>
      <SectionLabel>Red-flag screen</SectionLabel>
      <Text>{verdict.headline}</Text>
      <Text>{verdict.scope}</Text>
      {report.scanStatus === "partial" ? <Text>Partial scan: some checks may be missing.</Text> : null}
      {verdict.findings.map((finding, index) => <Text key={`${finding.check}-${String(index)}`}>{finding.detail}</Text>)}
      <Text>Project policy: group ask &gt;{verdict.policy.groupAskMv} mV, group red &gt;{verdict.policy.groupRedMv} mV; spread ask &gt;{verdict.policy.spreadAskMv} mV, spread red &gt;{verdict.policy.spreadRedMv} mV.</Text>
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
  </>;
}

export { ReportHistory, ReportSummary };
