import type { ComponentProps, ReactNode } from "react";
import { ScrollView, StyleSheet, View, type Text as NativeText, type TextStyle } from "react-native";
import { Card as PaperCard, Text as PaperText, TouchableRipple, useTheme } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FONTS, useTokens } from "./theme.js";

/** Body type by default (§Design Type: body 15, line height 1.5). A bold style maps to the Manrope 700 family instead of synthetic bold. */
export function Text({ style, children, ...props }: ComponentProps<typeof NativeText>) {
  const tokens = useTokens();
  // flatten returns undefined for an absent style at runtime, whatever its type says.
  const flat = (StyleSheet.flatten(style) as TextStyle | undefined) ?? {};
  const family = flat.fontFamily ? undefined : { fontFamily: flat.fontWeight === "bold" || flat.fontWeight === "700" ? FONTS.bold : FONTS.medium, fontWeight: "normal" as const };
  const lineHeight = flat.fontSize && !flat.lineHeight ? { lineHeight: Math.round(flat.fontSize * 1.5) } : undefined;
  return <PaperText {...props} style={[styles.body, { color: tokens.text }, style, family, lineHeight]}>{children}</PaperText>;
}

/**
 * Keeps React Native Button's props so the screens stay unchanged until C1–C4.
 * Built on TouchableRipple, not Paper's Button, because Paper's label is one line and would truncate
 * titles that carry state (the Ready switch, the scanned device's name and RSSI).
 */
export function Button({ title, onPress, disabled = false, color }: { title: string; onPress: () => void; disabled?: boolean; color?: string }) {
  const theme = useTheme();
  const tokens = useTokens();
  return <TouchableRipple accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} borderless
    style={[styles.button, { backgroundColor: disabled ? theme.colors.surfaceDisabled : color ?? tokens.accent }]}>
    <Text style={[styles.buttonLabel, { color: disabled ? theme.colors.onSurfaceDisabled : tokens.onAccent }]}>{title}</Text>
  </TouchableRipple>;
}

/** Today's two page shells, now inside the safe area: a scrolling list page, or a fixed page (gates, detail, console). */
export function Screen({ scroll = false, children }: { scroll?: boolean; children: ReactNode }) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  // §Design Spacing: 16 dp side margin plus the insets (status bar and cutout on top, gesture or 3-button nav at the bottom).
  const pad = { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 };
  if (scroll) return <ScrollView style={{ backgroundColor: tokens.bg }} contentContainerStyle={[styles.garage, pad]}>{children}</ScrollView>;
  return <View style={[styles.container, pad, { backgroundColor: tokens.bg }]}>{children}</View>;
}

export function Card({ children }: { children: ReactNode }) {
  const tokens = useTokens();
  return <PaperCard mode="contained" style={[styles.card, { backgroundColor: tokens.surface }]}><View style={styles.cardContent}>{children}</View></PaperCard>;
}

// §Design Spacing and shape: cards radius 24, buttons radius 16 and 52 high (min height, so a wrapped title still fits).
const styles = StyleSheet.create({ container: { flex: 1, gap: 8 }, garage: { gap: 8, minHeight: "100%" }, card: { borderRadius: 24 }, cardContent: { padding: 16, gap: 8 }, body: { fontSize: 15, lineHeight: 22 }, button: { minHeight: 52, borderRadius: 16, paddingHorizontal: 24, paddingVertical: 12, justifyContent: "center" }, buttonLabel: { fontFamily: FONTS.semibold, fontSize: 16, textAlign: "center" }, input: { borderWidth: 1, padding: 8 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, console: { borderWidth: 1, flex: 1, padding: 8 }, consoleText: { fontFamily: "monospace" } });
export { styles };
