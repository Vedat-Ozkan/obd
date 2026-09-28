import { useColorScheme } from "react-native";

// Explicit colors per scheme: without them, Android dark mode draws default dark text on the dark system background.
const palettes = {
  light: { background: "#FFFFFF", text: "#111111", muted: "#555555", border: "#767676", inputBackground: "#FFFFFF", inputText: "#111111", placeholder: "#595959", consoleBackground: "#F4F4F4", consoleText: "#000000", buttonBackground: "#005A9C" },
  dark: { background: "#121212", text: "#EDEDED", muted: "#B3B3B3", border: "#8A8A8A", inputBackground: "#1E1E1E", inputText: "#EDEDED", placeholder: "#A0A0A0", consoleBackground: "#000000", consoleText: "#E6E6E6", buttonBackground: "#005A9C" },
};

export function usePalette() {
  return palettes[useColorScheme() === "dark" ? "dark" : "light"];
}
