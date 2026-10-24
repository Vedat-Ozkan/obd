import type { Rating } from "obd-battery/rating";

export type Scheme = "light" | "dark";
export interface Tokens {
  bg: string; surface: string; container: string; onContainer: string; containerMuted: string; track: string;
  text: string; muted: string; outline: string; divider: string; accent: string; onAccent: string;
  error: string;
  tag: Record<"verified" | "community" | "neutral", { bg: string; fg: string }>;
  rating: Record<Rating, { fg: string; bg: string }>;
  chart: { data: string; highlight?: string };
}

export const TOKENS: Record<Scheme, Tokens> = {
  light: {
    bg: "#F2F4F1", surface: "#FAFBF9", container: "#DFE7E1", onContainer: "#24302A", containerMuted: "#4C5B53", track: "#C6D3CA",
    text: "#2A302C", muted: "#5C6660", outline: "#828C86", divider: "#E7EBE8", accent: "#4E7D6A", onAccent: "#FFFFFF", error: "#B3261E",
    tag: { verified: { bg: "#EDF2EE", fg: "#3F6A58" }, community: { bg: "#F2EBDF", fg: "#735623" }, neutral: { bg: "#EEF1EE", fg: "#4F5853" } },
    rating: {
      great: { fg: "#2E7D4F", bg: "#E4EFE7" }, good: { fg: "#2E7D4F", bg: "#E4EFE7" }, ok: { fg: "#A8841A", bg: "#F4EEDA" },
      poor: { fg: "#BF3B3B", bg: "#F6E3E1" }, "not-rated": { fg: "#5C6660", bg: "#EEF1EE" },
    },
    chart: { data: "#1E8060", highlight: "#C2702A" },
  },
  dark: {
    bg: "#1C211E", surface: "#242A26", container: "#2E3A34", onContainer: "#D4DED8", containerMuted: "#A8B7AE", track: "#3C4B43",
    text: "#D6DCD8", muted: "#A3ADA7", outline: "#6B766F", divider: "#2F3632", accent: "#8DB5A2", onAccent: "#17251E", error: "#F2B8B5",
    tag: { verified: { bg: "#2B3A33", fg: "#A9CCBA" }, community: { bg: "#3A3427", fg: "#D6BE90" }, neutral: { bg: "#2C322E", fg: "#B9C2BC" } },
    rating: {
      great: { fg: "#3A9C80", bg: "#25372E" }, good: { fg: "#3A9C80", bg: "#25372E" }, ok: { fg: "#B08B24", bg: "#3A3427" },
      poor: { fg: "#D65A7A", bg: "#3D2A30" }, "not-rated": { fg: "#A3ADA7", bg: "#2C322E" },
    },
    chart: { data: "#3FA884", highlight: "#C97A3C" },
  },
};
