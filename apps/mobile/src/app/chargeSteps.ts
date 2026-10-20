import { POST_REST_S, PRE_REST_S } from "obd-battery/session";

export type ChargeStep = 1 | 2 | 3 | 4 | 5;

export const CHARGE_STEP_LABELS = [`Rest ${String(PRE_REST_S / 60)} min`, "Plug in", "Charge", `Rest ${String(POST_REST_S / 60)} min`, "Saved"] as const;

export function chargeStep(line: string): ChargeStep | undefined {
  if (line.startsWith("Charge log stopped")) return line.includes("NOT SAVED: ") ? undefined : 5;
  if (line.startsWith("Charge done. Resting ")) return 4;
  if (line.startsWith("Charging. ")) return 3;
  if (line === "Plug in the charger now.") return 2;
  if (line.endsWith("Do not plug in yet.")) return 1;
  return undefined;
}

export function reachedStep(reached: ChargeStep | undefined, line: string): ChargeStep | undefined {
  const step = chargeStep(line);
  return step === undefined || step === 5 || step <= (reached ?? 0) ? reached : step;
}

export type StepMark = "done" | "now" | "logged" | "not-reached";

export function stepMarks(reached: ChargeStep | undefined, saved: boolean): readonly (StepMark | undefined)[] {
  return [1, 2, 3, 4, 5].map((n) => reached === undefined ? undefined
    : saved ? n === 5 ? "done" : n <= reached ? "logged" : "not-reached"
    : n < reached ? "done" : n === reached ? "now" : undefined);
}
