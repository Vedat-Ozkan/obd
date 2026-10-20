export type ThemePreference = "system" | "light" | "dark";

export function consentSections(text: string): { intro: string; sections: readonly { title: string; body: string }[] } {
  const [intro = "", ...rest] = text.split("\n\n");
  const sections = rest.map((paragraph) => {
    const match = /^\*\*([^*]+):\*\* ([\s\S]*)$/.exec(paragraph);
    if (!match) throw new Error(`consent paragraph without a bold title: ${paragraph.slice(0, 40)}`);
    return { title: match[1], body: match[2] };
  });
  return { intro, sections };
}

type Span = { text: string; bold?: boolean; italic?: boolean };

function spans(line: string): readonly Span[] {
  return line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).flatMap((part, index) => part === "" ? []
    : index % 2 === 0 ? [{ text: part }] : part.startsWith("**") ? [{ text: part.slice(2, -2), bold: true }] : [{ text: part.slice(1, -1), italic: true }]);
}

export function noteBlocks(text: string): readonly { kind: "heading" | "para" | "bullet"; spans: readonly Span[] }[] {
  return text.split("\n").filter((line) => line !== "").map((line) => {
    if (line.startsWith("- ")) return { kind: "bullet" as const, spans: spans(line.slice(2)) };
    const parts = spans(line);
    return { kind: parts.length === 1 && parts[0]?.bold ? "heading" as const : "para" as const, spans: parts };
  });
}

export function parseThemePreference(text: string | undefined): ThemePreference {
  const value = text?.trim();
  return value === "light" || value === "dark" ? value : "system";
}
