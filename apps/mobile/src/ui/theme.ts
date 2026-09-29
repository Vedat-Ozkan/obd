import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import { configureFonts, MD3DarkTheme, MD3LightTheme, type MD3Theme } from "react-native-paper";
import type { Rating } from "obd-battery/rating";
import type { ThemePreference } from "./text.js";

export type Scheme = "light" | "dark";
export type { Rating };
export interface Tokens {
  bg: string; surface: string; container: string; onContainer: string; containerMuted: string; track: string;
  text: string; muted: string; outline: string; divider: string; accent: string; onAccent: string;
  error: string;
  tag: Record<"verified" | "community" | "neutral", { bg: string; fg: string }>;
  rating: Record<Rating, { fg: string; bg: string }>;
  chart: { data: string; highlight?: string };
}

// Every value: docs/specs/X-2026-09-28-app-redesign.md §Design (Tokens, provenance tags, rating chips);
// the dark chart highlight is §Decisions item 9 (validator PASS against #3FA884 on #242A26).
// error is react-native-paper 5.15.3's MD3 error40 (light) and error80 (dark), src/styles/themes/v3/tokens.tsx;
// WCAG contrast on bg/surface: light 5.91/6.30, dark 9.57/8.58 (the old #B00020 was 2.23/2.00 in dark).
const TOKENS: Record<Scheme, Tokens> = {
  light: {
    bg: "#F2F4F1", surface: "#FAFBF9", container: "#DFE7E1", onContainer: "#24302A", containerMuted: "#4C5B53", track: "#C6D3CA",
    text: "#2A302C", muted: "#5C6660", outline: "#CFD6D1", divider: "#E7EBE8", accent: "#4E7D6A", onAccent: "#FFFFFF", error: "#B3261E",
    tag: { verified: { bg: "#EDF2EE", fg: "#3F6A58" }, community: { bg: "#F2EBDF", fg: "#735623" }, neutral: { bg: "#EEF1EE", fg: "#4F5853" } },
    rating: {
      great: { fg: "#2E7D4F", bg: "#E4EFE7" }, good: { fg: "#2E7D4F", bg: "#E4EFE7" }, ok: { fg: "#A8841A", bg: "#F4EEDA" },
      poor: { fg: "#BF3B3B", bg: "#F6E3E1" }, "not-rated": { fg: "#5C6660", bg: "#EEF1EE" },
    },
    chart: { data: "#1E8060", highlight: "#C2702A" },
  },
  dark: {
    bg: "#1C211E", surface: "#242A26", container: "#2E3A34", onContainer: "#D4DED8", containerMuted: "#A8B7AE", track: "#3C4B43",
    text: "#D6DCD8", muted: "#A3ADA7", outline: "#3C4540", divider: "#2F3632", accent: "#8DB5A2", onAccent: "#17251E", error: "#F2B8B5",
    tag: { verified: { bg: "#2B3A33", fg: "#A9CCBA" }, community: { bg: "#3A3427", fg: "#D6BE90" }, neutral: { bg: "#2C322E", fg: "#B9C2BC" } },
    rating: {
      great: { fg: "#3A9C80", bg: "#25372E" }, good: { fg: "#3A9C80", bg: "#25372E" }, ok: { fg: "#B08B24", bg: "#3A3427" },
      poor: { fg: "#D65A7A", bg: "#3D2A30" }, "not-rated": { fg: "#A3ADA7", bg: "#2C322E" },
    },
    chart: { data: "#3FA884", highlight: "#C97A3C" },
  },
};

// Family names are the keys App.tsx registers with useFonts; each weight is its own family, so no synthetic bold.
const FONTS = { medium: "Manrope_500Medium", semibold: "Manrope_600SemiBold", bold: "Manrope_700Bold", extrabold: "Manrope_800ExtraBold", mono: "JetBrainsMono_600SemiBold" };

// Settings › Theme (C4): one choice per JS runtime, read from theme.txt at start (runtime.ts); every useScheme follows it.
let themePreference: ThemePreference = "system";
const themeListeners = new Set<() => void>();
function setThemePreference(preference: ThemePreference) {
  themePreference = preference;
  themeListeners.forEach((listener) => { listener(); });
}
const subscribeTheme = (listener: () => void) => { themeListeners.add(listener); return () => { themeListeners.delete(listener); }; };
function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, () => themePreference);
}

function useScheme(): Scheme {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const preference = useThemePreference();
  return preference === "system" ? system : preference;
}

function useTokens(): Tokens {
  return TOKENS[useScheme()];
}

function paperTheme(scheme: Scheme): MD3Theme {
  const base = scheme === "dark" ? MD3DarkTheme : MD3LightTheme;
  const t = TOKENS[scheme];
  const heading = (key: string) => key.startsWith("display") || key.startsWith("headline") || key.startsWith("title");
  const fonts = configureFonts({ config: Object.fromEntries(Object.keys(base.fonts).filter((key) => key !== "default").map((key) => [key, { fontFamily: heading(key) ? FONTS.bold : FONTS.medium }])) });
  return {
    ...base,
    fonts: { ...fonts, default: { ...base.fonts.default, fontFamily: FONTS.medium } },
    colors: {
      ...base.colors,
      primary: t.accent, onPrimary: t.onAccent, primaryContainer: t.container, onPrimaryContainer: t.onContainer,
      secondaryContainer: t.container, onSecondaryContainer: t.onContainer,
      background: t.bg, onBackground: t.text, surface: t.surface, onSurface: t.text, surfaceVariant: t.container, onSurfaceVariant: t.muted,
      outline: t.outline, outlineVariant: t.divider,
    },
  };
}

export { FONTS, paperTheme, setThemePreference, TOKENS, useScheme, useThemePreference, useTokens };
