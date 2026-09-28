import { StyleSheet, View, type DimensionValue } from "react-native";
import { Text } from "./kit.js";
import { useTokens } from "./theme.js";

// Both charts are plain Views (spec §Non-goals: no react-native-svg). Colours: §Design chart data and highlight (§Decisions 9).
const pct = (fraction: number) => `${String(Math.min(100, Math.max(0, fraction * 100)))}%` as DimensionValue;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Chart 2, scan history: one SoC dot per check on a 0–100 % axis, oldest on the left. Below two checks it shows an honest
 * empty state. The latest dot is larger and labelled, so it never depends on the highlight colour alone (light CVD WARN).
 */
export function ScanHistory({ points }: { points: readonly { scannedAt: string; percent: number }[] }) {
  const tokens = useTokens();
  const latest = points.at(-1);
  if (points.length < 2 || !latest) return <Text style={[styles.caption, { color: tokens.muted }]}>Appears after your second check</Text>;
  const highlight = tokens.chart.highlight ?? tokens.chart.data;
  const summary = points.map((p) => `${shortDate(p.scannedAt)} ${p.percent.toFixed(1)}%`).join(", ");
  return <View accessible accessibilityLabel={`State of charge at each check: ${summary}. Latest ${latest.percent.toFixed(1)}%.`} style={styles.history}>
    <View style={styles.historyBody}>
      <View style={styles.axis}>
        <Text style={[styles.caption, { color: tokens.muted }]}>100%</Text>
        <Text style={[styles.caption, { color: tokens.muted }]}>0%</Text>
      </View>
      <View style={[styles.plot, { borderColor: tokens.divider }]}>
        {points.map((p, i) => {
          const last = i === points.length - 1;
          const size = last ? 16 : 10;
          return <View key={`${p.scannedAt}-${String(i)}`} style={[styles.dot, {
            left: pct(i / (points.length - 1)), bottom: pct(p.percent / 100), width: size, height: size, borderRadius: size / 2,
            marginLeft: -size / 2, marginBottom: -size / 2, backgroundColor: last ? highlight : tokens.chart.data,
          }]} />;
        })}
      </View>
    </View>
    <View style={styles.legend}>
      <Text style={[styles.caption, { color: tokens.muted }]}>{shortDate(points[0]?.scannedAt ?? latest.scannedAt)}</Text>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: highlight }]} />
        <Text style={[styles.caption, { color: tokens.text }]}>{`Latest ${latest.percent.toFixed(1)}%, ${shortDate(latest.scannedAt)}`}</Text>
      </View>
    </View>
  </View>;
}

/** Chart 4, cell range strip: lowest, average and highest cell on a mV axis padded by the spread on each side. */
export function CellRangeStrip({ minMv, avgMv, maxMv }: { minMv: number; avgMv: number; maxMv: number }) {
  const tokens = useTokens();
  const pad = Math.max(maxMv - minMv, 1);
  const lo = minMv - pad;
  const span = maxMv + pad - lo;
  const at = (value: number) => (value - lo) / span;
  const label = (word: string, value: number) => <Text style={[styles.caption, { color: tokens.onContainer }]}>{`${word} ${value.toFixed(1)}`}</Text>;
  return <View accessible accessibilityLabel={`Cell voltage: lowest ${minMv.toFixed(1)}, average ${avgMv.toFixed(1)}, highest ${maxMv.toFixed(1)} millivolts.`} style={styles.strip}>
    <View style={[styles.track, { backgroundColor: tokens.track }]}>
      <View style={[styles.range, { left: pct(at(minMv)), width: pct(at(maxMv) - at(minMv)), backgroundColor: tokens.chart.data }]} />
      <View style={[styles.avg, { left: pct(at(avgMv)), backgroundColor: tokens.onContainer }]} />
    </View>
    <View style={styles.stripLabels}>{label("Min", minMv)}{label("Avg", avgMv)}{label("Max", maxMv)}</View>
    <Text style={[styles.caption, { color: tokens.containerMuted }]}>mV</Text>
  </View>;
}

const styles = StyleSheet.create({
  caption: { fontSize: 13 },
  history: { gap: 8 }, historyBody: { flexDirection: "row", gap: 8, height: 132 }, axis: { justifyContent: "space-between" },
  plot: { flex: 1, borderLeftWidth: 1, borderBottomWidth: 1, marginVertical: 8, marginRight: 8 },
  dot: { position: "absolute" },
  legend: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 }, legendDot: { width: 16, height: 16, borderRadius: 8 },
  strip: { gap: 6 }, track: { height: 20, borderRadius: 10, justifyContent: "center" },
  range: { position: "absolute", top: 4, height: 12, borderRadius: 6 }, avg: { position: "absolute", width: 3, height: 20, marginLeft: -1.5 },
  stripLabels: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
});
