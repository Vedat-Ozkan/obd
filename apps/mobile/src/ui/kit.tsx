import type { ComponentProps, ReactNode } from "react";
import { ScrollView, StyleSheet, View, type DimensionValue, type Text as NativeText, type TextStyle } from "react-native";
import { Card as PaperCard, Icon, Text as PaperText, TouchableRipple, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ratingWord } from "obd-battery/rating";
import { FONTS, useTokens, type Rating } from "./theme.js";

const WEIGHT_FAMILY: Partial<Record<string, string>> = { bold: FONTS.bold, "600": FONTS.semibold, "700": FONTS.bold, "800": FONTS.extrabold };

export function Text({ style, children, ...props }: ComponentProps<typeof NativeText>) {
  const tokens = useTokens();
  const flat = (StyleSheet.flatten(style) as TextStyle | undefined) ?? {};
  const family = flat.fontFamily ? undefined : { fontFamily: WEIGHT_FAMILY[String(flat.fontWeight)] ?? FONTS.medium, fontWeight: "normal" as const };
  const lineHeight = flat.fontSize && !flat.lineHeight ? { lineHeight: Math.round(flat.fontSize * 1.5) } : undefined;
  return <PaperText {...props} style={[styles.body, { color: tokens.text }, style, family, lineHeight]}>{children}</PaperText>;
}

export function Button({ title, onPress, disabled = false, color, tonal = false }: { title: string; onPress: () => void; disabled?: boolean; color?: string; tonal?: boolean }) {
  const theme = useTheme();
  const tokens = useTokens();
  const fill = tonal ? tokens.container : color ?? tokens.accent;
  return <TouchableRipple accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} borderless
    style={[styles.button, { backgroundColor: disabled ? theme.colors.surfaceDisabled : fill }]}>
    <Text style={[styles.buttonLabel, { color: disabled ? theme.colors.onSurfaceDisabled : tonal ? tokens.onContainer : tokens.onAccent }]}>{title}</Text>
  </TouchableRipple>;
}

export function Screen({ scroll = false, blocks = false, children }: { scroll?: boolean; blocks?: boolean; children: ReactNode }) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const pad = { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, paddingLeft: insets.left + 16, paddingRight: insets.right + 16, ...(blocks ? { gap: 14 } : {}) };
  if (scroll) return <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={[styles.garage, pad]}>{children}</ScrollView>;
  return <View style={[styles.container, pad, { backgroundColor: tokens.bg }]}>{children}</View>;
}

export function SectionLabel({ children }: { children: string }) {
  const tokens = useTokens();
  return <Text accessibilityRole="header" style={[styles.sectionLabel, { color: tokens.muted }]}>{children.toUpperCase()}</Text>;
}

export function ListRow({ title, subtitle, icon, right, onPress, disabled = false, selected }: {
  title: string; subtitle?: string; icon?: string; right?: ReactNode; onPress?: () => void; disabled?: boolean; selected?: boolean;
}) {
  const tokens = useTokens();
  const chevron = !!onPress && selected === undefined;
  const color = disabled ? tokens.muted : tokens.text;
  const content = <View style={styles.row}>
      {icon ? <Icon source={icon} size={24} color={tokens.muted} /> : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color }]}>{title}</Text>
        {subtitle ? <Text style={[styles.caption, { color: tokens.muted }]}>{subtitle}</Text> : null}
      </View>
      {typeof right === "string" ? <Text style={{ color: tokens.muted }}>{right}</Text> : right}
      {selected ? <Icon source="check" size={24} color={tokens.accent} /> : null}
      {chevron ? <Icon source="chevron-right" size={24} color={tokens.muted} /> : null}
    </View>;
  if (!onPress) return <View accessible style={[styles.listRow, { borderBottomColor: tokens.divider }]}>{content}</View>;
  return <TouchableRipple accessibilityRole={selected === undefined ? "button" : "radio"} accessibilityState={{ disabled, ...(selected === undefined ? {} : { checked: selected }) }} disabled={disabled} onPress={onPress}
    style={[styles.listRow, { borderBottomColor: tokens.divider }]}>{content}</TouchableRipple>;
}

export function Hero({ value, unit, empty, label, caption, percent, tag, children, onPress, accessibilityLabel }: {
  value?: string; unit?: string; empty?: string; label: string; caption?: string; percent?: number; tag?: ReactNode; children?: ReactNode; onPress?: () => void; accessibilityLabel: string;
}) {
  const tokens = useTokens();
  const content = <View style={styles.heroContent}>
      <View style={styles.row}><Text style={[styles.caption, { color: tokens.containerMuted, flex: 1 }]}>{label}</Text>{tag}</View>
      {value === undefined ? <Text style={[styles.h1, { color: tokens.onContainer }]}>{empty}</Text> : <View style={styles.heroValue}>
        <Text style={[styles.heroNumber, { color: tokens.onContainer }]}>{value}</Text>
        {unit ? <Text style={[styles.heroUnit, { color: tokens.onContainer }]}>{unit}</Text> : null}
      </View>}
      {percent === undefined ? null : <View style={[styles.bar, { backgroundColor: tokens.track }]}>
        <View style={[styles.barFill, { width: `${String(Math.min(100, Math.max(0, percent)))}%` as DimensionValue, backgroundColor: tokens.accent }]} />
      </View>}
      {children}
      {caption ? <Text style={[styles.caption, { color: tokens.containerMuted }]}>{caption}</Text> : null}
    </View>;
  if (!onPress) return <View accessible accessibilityLabel={accessibilityLabel} style={[styles.hero, { backgroundColor: tokens.container }]}>{content}</View>;
  return <TouchableRipple accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} borderless
    style={[styles.hero, { backgroundColor: tokens.container }]}>{content}</TouchableRipple>;
}

export function Tag({ tone, label }: { tone: "verified" | "community" | "neutral"; label: string }) {
  const tokens = useTokens();
  return <View style={[styles.tag, { backgroundColor: tokens.tag[tone].bg }]}><Text style={[styles.tagText, { color: tokens.tag[tone].fg }]}>{label}</Text></View>;
}

const CHIP_ICONS: Record<Rating, string> = {
  great: "star-circle", good: "check-circle", ok: "alert-circle-outline", poor: "close-circle", "not-rated": "minus-circle-outline",
};

export function Chip({ rating }: { rating: Rating }) {
  const tokens = useTokens();
  const { fg, bg } = tokens.rating[rating];
  const icon = CHIP_ICONS[rating];
  const word = ratingWord[rating];
  return <View accessible accessibilityLabel={`Rating: ${word}`} style={[styles.chip, { backgroundColor: bg }]}>
    <Icon source={icon} size={16} color={fg} />
    <Text style={[styles.tagText, { color: tokens.text }]}>{word}</Text>
  </View>;
}

export function Card({ children }: { children: ReactNode }) {
  const tokens = useTokens();
  return <PaperCard mode="contained" style={[styles.card, { backgroundColor: tokens.surface }]}><View style={styles.cardContent}>{children}</View></PaperCard>;
}

const styles = StyleSheet.create({ container: { flex: 1, gap: 8 }, garage: { gap: 8, minHeight: "100%" }, card: { borderRadius: 24 }, cardContent: { padding: 16, gap: 8 }, body: { fontSize: 15, lineHeight: 22 }, button: { minHeight: 52, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 12, justifyContent: "center" }, buttonLabel: { fontFamily: FONTS.semibold, fontSize: 16, textAlign: "center" }, input: { borderWidth: 1, padding: 8, minHeight: 48 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, console: { borderWidth: 1, flex: 1, padding: 8 }, consoleText: { fontFamily: "monospace" },
  h1: { fontSize: 28, fontWeight: "700" }, sectionLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 0.78 }, rowLabel: { fontSize: 16, fontWeight: "600" }, caption: { fontSize: 13 },
  listRow: { minHeight: 60, justifyContent: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth }, rowText: { flex: 1, gap: 2 },
  hero: { borderRadius: 28 }, heroContent: { padding: 20, gap: 8 }, heroValue: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" }, heroNumber: { fontFamily: FONTS.mono, fontSize: 48, lineHeight: 60 }, heroUnit: { fontFamily: FONTS.mono, fontSize: 24, lineHeight: 32 },
  bar: { height: 12, borderRadius: 6, overflow: "hidden" }, barFill: { height: 12, borderRadius: 6 },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }, tagText: { fontSize: 13, fontWeight: "600" }, chip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 } });
export { styles };
