import type { Interest } from "../garage/flow.js";

export type Route =
  | { name: "garage" } | { name: "addVehicle" } | { name: "interest"; saved?: Interest }
  | { name: "car"; entryId: string } | { name: "check"; entryId: string; intent: "check" | "charge" }
  | { name: "history"; entryId: string } | { name: "report"; entryId: string; scannedAt: string; recording: string }
  | { name: "section"; entryId: string; scannedAt: string; recording: string; section: "soc" | "cells" | "capacity" | "twelveVolt" }
  | { name: "codes" | "aiSummary"; entryId: string; scannedAt: string; recording: string }
  | { name: "module"; entryId: string; scannedAt: string; recording: string; ecu: string }
  | { name: "settings" | "beta" | "theme" | "saveFolder" | "privacy" | "licenses" };

export function back(stack: readonly Route[], locked: boolean): readonly Route[] | "blocked" | "exit" {
  if (stack.length <= 1) return "exit";
  if (locked && stack[stack.length - 1]?.name === "check") return "blocked";
  return stack.slice(0, -1);
}
