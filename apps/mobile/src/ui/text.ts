// Pure text helpers for the Settings and Consent screens (X-2026-09-28-app-redesign C4). They only split and mark up
// the pinned beta-1 text (src/beta/consent.ts); no wording changes, so the C-1 digest and CONSENT_VERSION stand (§Decisions 5).

export type ThemePreference = "system" | "light" | "dark";

/** The intro paragraph, then one section per "**Title:** body" paragraph, in the pinned order. */
export function consentSections(text: string): { intro: string; sections: readonly { title: string; body: string }[] } {
  const [intro = "", ...rest] = text.split("\n\n");
  const sections = rest.map((paragraph) => {
    const match = /^\*\*([^*]+):\*\* ([\s\S]*)$/.exec(paragraph);
    // A re-pinned text in another shape must fail loudly here (and in test 5), never show a paragraph partly.
    if (!match) throw new Error(`consent paragraph without a bold title: ${paragraph.slice(0, 40)}`);
    return { title: match[1], body: match[2] };
  });
  return { intro, sections };
}

type Span = { text: string; bold?: boolean; italic?: boolean };

// The note's markdown uses only **bold**, *italic* and "- " bullets; anything else (the backticks included) is shown as is.
function spans(line: string): readonly Span[] {
  // split with a capture group puts the marked runs at odd indices.
  return line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).flatMap((part, index) => part === "" ? []
    : index % 2 === 0 ? [{ text: part }] : part.startsWith("**") ? [{ text: part.slice(2, -2), bold: true }] : [{ text: part.slice(1, -1), italic: true }]);
}

/** One block per non-empty line: a line that is all bold is a heading, "- " starts a bullet, the rest are paragraphs. */
export function noteBlocks(text: string): readonly { kind: "heading" | "para" | "bullet"; spans: readonly Span[] }[] {
  return text.split("\n").filter((line) => line !== "").map((line) => {
    if (line.startsWith("- ")) return { kind: "bullet" as const, spans: spans(line.slice(2)) };
    const parts = spans(line);
    return { kind: parts.length === 1 && parts[0]?.bold ? "heading" as const : "para" as const, spans: parts };
  });
}

/** theme.txt holds one of the three choices; a missing or corrupt file means System default (§Decisions 10). */
export function parseThemePreference(text: string | undefined): ThemePreference {
  const value = text?.trim();
  return value === "light" || value === "dark" ? value : "system";
}
