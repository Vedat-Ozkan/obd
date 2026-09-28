import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { usePalette } from "./theme.js";

// Stage A renders exactly today's RN widgets; Stage B swaps these for Paper-based ones.
export { Button, Text } from "react-native";

/** Today's two page shells: a scrolling list page, or a fixed page (gates, detail, console). */
export function Screen({ scroll = false, children }: { scroll?: boolean; children: ReactNode }) {
  const colors = usePalette();
  if (scroll) return <ScrollView contentContainerStyle={[styles.garage, { backgroundColor: colors.background }]}>{children}</ScrollView>;
  return <View style={[styles.container, { backgroundColor: colors.background }]}>{children}</View>;
}

export function Card({ children }: { children: ReactNode }) {
  const colors = usePalette();
  return <View style={[styles.card, { borderColor: colors.border }]}>{children}</View>;
}

const styles = StyleSheet.create({ container: { flex: 1, gap: 8, padding: 16 }, garage: { gap: 8, padding: 16, minHeight: "100%" }, card: { borderWidth: 1, padding: 8, gap: 4 }, input: { borderWidth: 1, padding: 8 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, console: { borderWidth: 1, flex: 1, padding: 8 }, consoleText: { fontFamily: "monospace" } });
export { styles };
