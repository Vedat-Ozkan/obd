import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import { configureFonts, MD3DarkTheme, MD3LightTheme, type MD3Theme } from "react-native-paper";
import type { Rating } from "obd-battery/rating";
import type { ThemePreference } from "./text.js";
import { TOKENS, type Scheme, type Tokens } from "./tokens.js";

export type { Rating };
export type { Scheme, Tokens };

const FONTS = { medium: "Manrope_500Medium", semibold: "Manrope_600SemiBold", bold: "Manrope_700Bold", extrabold: "Manrope_800ExtraBold", mono: "JetBrainsMono_600SemiBold" };

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
