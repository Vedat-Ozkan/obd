import { POST_REST_S, PRE_REST_S } from "obd-battery/session";

export type ChargeStep = 1 | 2 | 3 | 4 | 5;

// docs/specs/X-2026-09-28-app-redesign.md §Screens 9: the minutes come from obd-battery/session PRE_REST_S and POST_REST_S.
export const CHARGE_STEP_LABELS = [`Rest ${String(PRE_REST_S / 60)} min`, "Plug in", "Charge", `Rest ${String(POST_REST_S / 60)} min`, "Saved"] as const;

/**
 * 1 Rest 10 min … 5 Saved; undefined keeps the previous step (retry, recovery, starting lines).
 * Lines: runChargeLog's update() (src/chargeLogger.ts), its final line, and the console's own charge-log lines.
 */
export function chargeStep(line: string): ChargeStep | undefined {
  // A log file that could not be created saved nothing ("NOT SAVED: …"); a failed folder copy still left the log in app storage.
  if (line.startsWith("Charge log stopped")) return line.includes("NOT SAVED: ") ? undefined : 5;
  if (line.startsWith("Charge done. Resting ")) return 4;
  if (line.startsWith("Charging. ")) return 3;
  if (line === "Plug in the charger now.") return 2;
  if (line.endsWith("Do not plug in yet.")) return 1;
  return undefined;
}

/** The furthest step (1–4) this console has seen the run reach; unmapped, Saved and lower lines keep it, so it never moves back. */
export function reachedStep(reached: ChargeStep | undefined, line: string): ChargeStep | undefined {
  const step = chargeStep(line);
  return step === undefined || step === 5 || step <= (reached ?? 0) ? reached : step;
}

export type StepMark = "done" | "now" | "logged" | "not-reached";

/**
 * One mark per step. Once saved, step 5 is Done, steps the run reached are Logged and the rest Not reached, so a run stopped
 * early never shows the charge as done. With reached undefined this console did not observe the run (the final line was
 * replayed on mount), so no step gets a mark.
 */
export function stepMarks(reached: ChargeStep | undefined, saved: boolean): readonly (StepMark | undefined)[] {
  return [1, 2, 3, 4, 5].map((n) => reached === undefined ? undefined
    : saved ? n === 5 ? "done" : n <= reached ? "logged" : "not-reached"
    : n < reached ? "done" : n === reached ? "now" : undefined);
}
