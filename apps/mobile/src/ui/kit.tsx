import type { ComponentProps, ReactNode } from "react";
import { ScrollView, StyleSheet, View, type DimensionValue, type Text as NativeText, type TextStyle } from "react-native";
import { Card as PaperCard, Icon, Text as PaperText, TouchableRipple, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ratingWord } from "obd-battery/rating";
import { FONTS, useTokens, type Rating } from "./theme.js";

// Each loaded Manrope weight is its own family (App.tsx useFonts: 500, 600, 700, 800); anything else renders as 500.
const WEIGHT_FAMILY: Partial<Record<string, string>> = { bold: FONTS.bold, "600": FONTS.semibold, "700": FONTS.bold, "800": FONTS.extrabold };

/** Body type by default (§Design Type: body 15, line height 1.5). A 600/700/800 or bold style maps to that Manrope family instead of synthetic bold. */
export function Text({ style, children, ...props }: ComponentProps<typeof NativeText>) {
  const tokens = useTokens();
  // flatten returns undefined for an absent style at runtime, whatever its type says.
  const flat = (StyleSheet.flatten(style) as TextStyle | undefined) ?? {};
  const family = flat.fontFamily ? undefined : { fontFamily: WEIGHT_FAMILY[String(flat.fontWeight)] ?? FONTS.medium, fontWeight: "normal" as const };
  const lineHeight = flat.fontSize && !flat.lineHeight ? { lineHeight: Math.round(flat.fontSize * 1.5) } : undefined;
  return <PaperText {...props} style={[styles.body, { color: tokens.text }, style, family, lineHeight]}>{children}</PaperText>;
}

/**
 * Keeps React Native Button's props so the screens stay unchanged until C1–C4.
 * Built on TouchableRipple, not Paper's Button, because Paper's label is one line and would truncate
 * titles that carry state (the Ready switch, the scanned device's name and RSSI).
 */
export function Button({ title, onPress, disabled = false, color, tonal = false }: { title: string; onPress: () => void; disabled?: boolean; color?: string; tonal?: boolean }) {
  const theme = useTheme();
  const tokens = useTokens();
  // Tonal (M3): the container colour with its on-colour, for the second action next to a primary one.
  const fill = tonal ? tokens.container : color ?? tokens.accent;
  return <TouchableRipple accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} borderless
    style={[styles.button, { backgroundColor: disabled ? theme.colors.surfaceDisabled : fill }]}>
    <Text style={[styles.buttonLabel, { color: disabled ? theme.colors.onSurfaceDisabled : tonal ? tokens.onContainer : tokens.onAccent }]}>{title}</Text>
  </TouchableRipple>;
}

/** Today's two page shells, now inside the safe area: a scrolling list page, or a fixed page (gates, detail, console). */
export function Screen({ scroll = false, blocks = false, children }: { scroll?: boolean; blocks?: boolean; children: ReactNode }) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  // §Design Spacing: 16 dp side margin plus the insets (status bar and cutout on top, gesture or 3-button nav at the bottom).
  // Redesigned pages space their blocks 14 dp apart; pages not yet redesigned keep 8 dp.
  const pad = { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, paddingLeft: insets.left + 16, paddingRight: insets.right + 16, ...(blocks ? { gap: 14 } : {}) };
  if (scroll) return <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={[styles.garage, pad]}>{children}</ScrollView>;
  return <View style={[styles.container, pad, { backgroundColor: tokens.bg }]}>{children}</View>;
}

/** §Design Type: section label 13/700, uppercase, 0.06em tracking. */
export function SectionLabel({ children }: { children: string }) {
  const tokens = useTokens();
  return <Text accessibilityRole="header" style={[styles.sectionLabel, { color: tokens.muted }]}>{children.toUpperCase()}</Text>;
}

/** A list row: icon, label (16/600) and optional subtitle, a value or tag on the right, and a chevron when it opens something. At least 60 dp. */
export function ListRow({ title, subtitle, icon, right, onPress, disabled = false, selected }: {
  title: string; subtitle?: string; icon?: string; right?: ReactNode; onPress?: () => void; disabled?: boolean; selected?: boolean;
}) {
  const tokens = useTokens();
  const chevron = !!onPress && selected === undefined;
  const color = disabled ? tokens.muted : tokens.text;
  // A choice row (selected defined) marks the current choice with a check, not colour alone.
  return <TouchableRipple accessibilityRole={selected === undefined ? onPress ? "button" : undefined : "radio"} accessibilityState={{ disabled, ...(selected === undefined ? {} : { checked: selected }) }} disabled={disabled || !onPress} onPress={onPress}
    style={[styles.listRow, { borderBottomColor: tokens.divider }]}>
    <View style={styles.row}>
      {icon ? <Icon source={icon} size={24} color={tokens.muted} /> : null}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color }]}>{title}</Text>
        {subtitle ? <Text style={[styles.caption, { color: tokens.muted }]}>{subtitle}</Text> : null}
      </View>
      {typeof right === "string" ? <Text style={{ color: tokens.muted }}>{right}</Text> : right}
      {selected ? <Icon source="check" size={24} color={tokens.accent} /> : null}
      {chevron ? <Icon source="chevron-right" size={24} color={tokens.muted} /> : null}
    </View>
  </TouchableRipple>;
}

/**
 * The hero (§Design Direction): a monospaced number over a charge bar, on the container colour, radius 28.
 * `percent` fills the bar. Without a value the hero shows `empty` in Manrope instead (for example "No check yet"):
 * JetBrains Mono is for hero numbers only (§Design Type).
 */
export function Hero({ value, unit, empty, label, caption, percent, tag, children, onPress, accessibilityLabel }: {
  value?: string; unit?: string; empty?: string; label: string; caption?: string; percent?: number; tag?: ReactNode; children?: ReactNode; onPress?: () => void; accessibilityLabel: string;
}) {
  const tokens = useTokens();
  return <TouchableRipple accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={accessibilityLabel} disabled={!onPress} onPress={onPress} borderless
    style={[styles.hero, { backgroundColor: tokens.container }]}>
    <View style={styles.heroContent}>
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
    </View>
  </TouchableRipple>;
}

/** A provenance tag (§Design): the signal tier, or a neutral word for anything derived or not read. */
export function Tag({ tone, label }: { tone: "verified" | "community" | "neutral"; label: string }) {
  const tokens = useTokens();
  return <View style={[styles.tag, { backgroundColor: tokens.tag[tone].bg }]}><Text style={[styles.tagText, { color: tokens.tag[tone].fg }]}>{label}</Text></View>;
}

// §Design Rating chips: the glyph names confirmed in the installed MaterialCommunityIcons map (Stage B record).
const CHIP_ICONS: Record<Rating, string> = {
  great: "star-circle", good: "check-circle", ok: "alert-circle-outline", poor: "close-circle", "not-rated": "minus-circle-outline",
};

/** A rating chip: always an icon and a word, never colour alone. Only the icon wears the status colour; the word wears the text token (text on text tokens). */
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

// §Design Spacing and shape: cards radius 24, hero 28, buttons radius 16 and 52 high (min height, so a wrapped title still fits),
// list rows at least 60. §Design Type: h1 28/700, section label 13/700 with 0.06em (0.78 dp at 13) tracking, row label 16/600, caption 13.
const styles = StyleSheet.create({ container: { flex: 1, gap: 8 }, garage: { gap: 8, minHeight: "100%" }, card: { borderRadius: 24 }, cardContent: { padding: 16, gap: 8 }, body: { fontSize: 15, lineHeight: 22 }, button: { minHeight: 52, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 12, justifyContent: "center" }, buttonLabel: { fontFamily: FONTS.semibold, fontSize: 16, textAlign: "center" }, input: { borderWidth: 1, padding: 8 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, console: { borderWidth: 1, flex: 1, padding: 8 }, consoleText: { fontFamily: "monospace" },
  h1: { fontSize: 28, fontWeight: "700" }, sectionLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 0.78 }, rowLabel: { fontSize: 16, fontWeight: "600" }, caption: { fontSize: 13 },
  listRow: { minHeight: 60, justifyContent: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth }, rowText: { flex: 1, gap: 2 },
  hero: { borderRadius: 28 }, heroContent: { padding: 20, gap: 8 }, heroValue: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" }, heroNumber: { fontFamily: FONTS.mono, fontSize: 48, lineHeight: 60 }, heroUnit: { fontFamily: FONTS.mono, fontSize: 24, lineHeight: 32 },
  bar: { height: 12, borderRadius: 6, overflow: "hidden" }, barFill: { height: 12, borderRadius: 6 },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }, tagText: { fontSize: 13, fontWeight: "600" }, chip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 } });
export { styles };
