import type { Interest } from "../garage/flow.js";

// docs/specs/X-2026-09-28-app-redesign.md §Interfaces: a plain route stack, no navigation library (ADR-021).
export type Route =
  | { name: "garage" } | { name: "addVehicle" } | { name: "interest"; saved?: Interest }
  | { name: "car"; entryId: string } | { name: "check"; entryId: string; intent: "check" | "charge" }
  | { name: "history"; entryId: string } | { name: "report"; entryId: string; scannedAt: string; recording: string }
  | { name: "section"; entryId: string; scannedAt: string; recording: string; section: "soc" | "cells" | "capacity" | "twelveVolt" }
  | { name: "codes" | "aiSummary"; entryId: string; scannedAt: string; recording: string }
  | { name: "module"; entryId: string; scannedAt: string; recording: string; ecu: string }
  | { name: "settings" | "beta" | "theme" | "saveFolder" | "privacy" | "licenses" };

/** System back. `locked` is true while the check screen runs a diagnosis or a charge log. */
export function back(stack: readonly Route[], locked: boolean): readonly Route[] | "blocked" | "exit" {
  if (stack.length <= 1) return "exit";
  // Popping the check screen would unmount the console mid-run.
  if (locked && stack[stack.length - 1]?.name === "check") return "blocked";
  return stack.slice(0, -1);
}
