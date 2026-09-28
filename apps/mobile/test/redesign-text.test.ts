// X-2026-09-28-app-redesign C4 (spec §Verification, isolated failures 5–9): the consent sections and the privacy note
// formatting keep the pinned beta-1 text verbatim (§Decisions 5); the licenses list matches the installed packages;
// a missing or corrupt theme.txt falls back to System default (§Decisions 10).
// @ts-expect-error Node built-ins are outside the mobile compilation target.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSENT_TEXT, PRIVACY_NOTE } from "../src/beta/consent.js";
import { LICENSES } from "../src/app/licenses.js";
import { consentSections, noteBlocks, parseThemePreference } from "../src/ui/text.js";

const read = readFileSync as (path: URL, encoding: "utf8") => string;
const mobile = new URL("../", import.meta.url);

describe("consentSections", () => {
  it("5: keeps every paragraph of the pinned CONSENT_TEXT; intro and sections rejoined give the text exactly", () => {
    const { intro, sections } = consentSections(CONSENT_TEXT);
    const rejoined = [intro, ...sections.map((section) => `**${section.title}:** ${section.body}`)].join("\n\n");
    expect(rejoined).toBe(CONSENT_TEXT);
  });

  it("6: the six titles are the owner's, in order", () => {
    expect(consentSections(CONSENT_TEXT).sections.map((section) => section.title))
      .toEqual(["What is sent", "What is removed on your phone first", "How it's labeled", "Why", "How long", "Your control"]);
  });
});

describe("noteBlocks", () => {
  it("7: drops only the markdown markers from PRIVACY_NOTE; the blocks written back as markdown give every line", () => {
    const markdown = noteBlocks(PRIVACY_NOTE).map((block) => (block.kind === "bullet" ? "- " : "")
      + block.spans.map((span) => span.bold ? `**${span.text}**` : span.italic ? `*${span.text}*` : span.text).join(""));
    expect(markdown).toEqual(PRIVACY_NOTE.split("\n").filter((line) => line !== ""));
    // The markers themselves are consumed, never shown as text.
    expect(noteBlocks(PRIVACY_NOTE).flatMap((block) => block.spans).filter((span) => span.text.includes("*"))).toEqual([]);
    expect(noteBlocks(PRIVACY_NOTE).map((block) => block.kind)).toEqual(PRIVACY_NOTE.split("\n").filter((line) => line !== "")
      .map((line) => line.startsWith("- ") ? "bullet" : /^\*\*[^*]+\*\*$/.test(line) ? "heading" : "para"));
  });
});

describe("licenses", () => {
  const dependencies = (JSON.parse(read(new URL("package.json", mobile), "utf8")) as { dependencies: Record<string, string> }).dependencies;
  const runtime = Object.keys(dependencies).filter((name) => !dependencies[name].startsWith("workspace:")).sort();

  it("8: every runtime dependency in apps/mobile/package.json (except workspace:*) has an entry", () => {
    expect(LICENSES.map((entry) => entry.name).sort()).toEqual(runtime);
  });

  it("9: each entry's license is the installed package's package.json license", () => {
    for (const entry of LICENSES) {
      const installed = JSON.parse(read(new URL(`node_modules/${entry.name}/package.json`, mobile), "utf8")) as { license: string };
      expect(entry.license, entry.name).toBe(installed.license);
    }
  });
});

describe("theme preference", () => {
  it("reads the three stored choices", () => {
    expect(["system", "light", "dark"].map(parseThemePreference)).toEqual(["system", "light", "dark"]);
    expect(parseThemePreference("dark\n")).toBe("dark");
  });

  it("falls back to System default for a missing or corrupt theme.txt", () => {
    expect([undefined, "", "Dark", "blue", "light dark", "\u0000"].map(parseThemePreference)).toEqual(Array(6).fill("system"));
  });
});
