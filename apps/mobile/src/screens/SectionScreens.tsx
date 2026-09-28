import { useState } from "react";
import type { BatteryDiagnosisReport } from "obd-battery/report";
import type { CodesReport } from "obd-core/report";
import { View } from "react-native";
import { Icon, TouchableRipple } from "react-native-paper";
import { codesView, historyPoints, moduleRows, sectionDetail, type RatingView } from "../app/reportView.js";
import { CellRangeStrip, ScanHistory } from "../ui/charts.js";
import { Button, Card, Chip, Hero, ListRow, SectionLabel, styles, Tag, Text } from "../ui/kit.js";
import { useTokens } from "../ui/theme.js";

type Section = "soc" | "cells" | "capacity" | "twelveVolt";
const SECTION_TITLES: Record<Section, string> = { soc: "State of charge", cells: "Cell balance", capacity: "Capacity", twelveVolt: "12 V battery" };

/** The rating card: the chip and the basis that backs it (spec §Design Rating rules). */
function RatingCard({ rating }: { rating: RatingView }) {
  const tokens = useTokens();
  return <Card>
    <View style={styles.row}><Chip rating={rating.rating} /></View>
    <Text style={{ color: tokens.muted }}>{`Basis: ${rating.basis}`}</Text>
  </Card>;
}

/** Section detail (spec §Screens 4). `history` is this car's saved reports, for the scan-history chart on State of charge. */
function SectionScreen({ report, section, history, canCheck, busy, openCharge }: {
  report: BatteryDiagnosisReport; section: Section; history: readonly BatteryDiagnosisReport[]; canCheck: boolean; busy: boolean; openCharge: () => void;
}) {
  const tokens = useTokens();
  const detail = sectionDetail(report, section);
  const numeric = detail.hero.unit !== undefined;
  const range = detail.cellRange;
  return <>
    <Hero label={SECTION_TITLES[section]} value={numeric ? detail.hero.value : undefined} unit={detail.hero.unit} empty={detail.hero.value}
      percent={section === "soc" && numeric ? Number(detail.hero.value) : undefined} tag={<Tag tone={detail.hero.tag} label={detail.hero.tagLabel} />}
      accessibilityLabel={`${SECTION_TITLES[section]}: ${detail.hero.value}${detail.hero.unit ? ` ${detail.hero.unit}` : ""}, ${detail.hero.tagLabel}`}>
      {range ? <CellRangeStrip minMv={range.minMv} avgMv={range.avgMv} maxMv={range.maxMv} /> : null}
    </Hero>
    {detail.rating ? <RatingCard rating={detail.rating} /> : null}
    {section === "soc" ? <View style={{ gap: 8 }}>
      <SectionLabel>Scan history</SectionLabel>
      <ScanHistory points={historyPoints(history)} />
    </View> : null}
    <View>
      <SectionLabel>Readings</SectionLabel>
      {detail.readings.length === 0 ? <Text style={{ color: tokens.muted }}>Nothing for this section was read in this check.</Text> : null}
      {detail.readings.map((reading) => <ListRow key={reading.label} title={reading.label} subtitle={reading.value}
        right={reading.tier ? <Tag tone={reading.tier} label={reading.tier === "verified" ? "Verified" : "Community"} /> : undefined} />)}
    </View>
    <View style={{ gap: 8 }}>
      <SectionLabel>What this means</SectionLabel>
      <Text>{detail.meaning}</Text>
    </View>
    <View style={{ gap: 8 }}>
      <SectionLabel>Source</SectionLabel>
      <Text style={{ color: tokens.muted }}>{detail.source}</Text>
    </View>
    {section === "capacity" ? <Button title="Log a charge" disabled={busy || !canCheck} onPress={openCharge} /> : null}
  </>;
}

const VERDICT = { indicated: "Yes", "not-indicated": "No", unknown: "Unknown" };

/** Codes (spec §Screens 5): summary, rating, the expandable recently-cleared card, and the modules list. */
function CodesScreen({ codes, busy, openModule }: { codes: CodesReport; busy: boolean; openModule: (ecu: string) => void }) {
  const tokens = useTokens();
  const [open, setOpen] = useState(false);
  const view = codesView(codes);
  // Not rated means no module answered a code read (codesView), so there is no count to show.
  const read = view.rating.rating !== "not-rated";
  const answered = `${String(view.modules.length)} module${view.modules.length === 1 ? "" : "s"} answered`;
  return <>
    <Hero label="Diagnostic codes" value={read ? String(view.codeCount) : undefined} unit={read ? (view.codeCount === 1 ? "code" : "codes") : undefined} empty="Not read" caption={answered}
      accessibilityLabel={`Diagnostic codes: ${read ? `${String(view.codeCount)} reported` : "not read"}, ${answered}`} />
    <RatingCard rating={view.rating} />
    <Card>
      <TouchableRipple accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { setOpen(!open); }} style={{ minHeight: 48, justifyContent: "center" }}>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { flex: 1 }]}>Recently cleared?</Text>
          <Text style={{ color: tokens.muted }}>{VERDICT[codes.recentlyCleared.verdict]}</Text>
          <Icon source={open ? "chevron-up" : "chevron-down"} size={24} color={tokens.muted} />
        </View>
      </TouchableRipple>
      {open ? <View>
        {view.legs.map((leg) => <ListRow key={leg.label} title={leg.label} right={leg.result} />)}
        <Text style={[styles.caption, { color: tokens.muted, marginTop: 8 }]}>
          {`Policy thresholds, set by this project and not taken from a standard: warm-ups below ${String(view.thresholds["30"])}, distance below ${String(view.thresholds["31"])} km, time below ${String(view.thresholds["4E"])} min.`}
        </Text>
      </View> : null}
    </Card>
    <View>
      <SectionLabel>Modules</SectionLabel>
      {view.modules.map((module) => <ListRow key={module.ecu} icon="chip" title={`Module ${module.ecu}`} subtitle={module.summary} disabled={busy} onPress={() => { openModule(module.ecu); }} />)}
    </View>
  </>;
}

/** Module detail (spec §Screens 5): each per-mode row as the module reported it. */
function ModuleScreen({ codes, ecu }: { codes: CodesReport; ecu: string }) {
  const tokens = useTokens();
  const rows = moduleRows(codes, ecu);
  if (!rows) return <Text style={{ color: tokens.muted }}>This module is not in the report.</Text>;
  return <View>{rows.map((row) => <ListRow key={row.label} title={row.label} subtitle={row.value} />)}</View>;
}

export { CodesScreen, ModuleScreen, SECTION_TITLES, SectionScreen };
