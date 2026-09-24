// Markdown codes section from fixed templates: docs/specs/T0.7-codes-report.md "Stage B2: render.ts".
// Numbers are rounded to 3 decimals as scripts/replay.ts readingText does. No VIN (ADR-014, ADR-017; Q6).
import type { PidReading } from "../obd/j1979.js";
import { LOW_COUNTER, type CodesReport, type DtcRead, type FreezeFrame, type ModuleCodes, type PidValue, type Tri } from "./codes.js";

const num = (v: number) => String(Math.round(v * 1000) / 1000);

type Other = Exclude<PidValue, { status: "read" }> | Exclude<FreezeFrame, { status: "stored" } | { status: "none-stored" }>;

function statusWord(s: Other): string {
  if (s.status === "not-read") return "not read";
  if (s.status === "unsupported") return "not supported";
  if (s.reason === "negative") return `not answered (negative response ${(s.code ?? 0).toString(16).padStart(2, "0").toUpperCase()})`;
  return `unreadable reply (${s.reason})`;
}

const dtcText = (d: DtcRead) => (d.status === "read" ? (d.dtcs.length > 0 ? d.dtcs.join(", ") : "none") : statusWord(d));

const pidText = (v: PidValue) =>
  v.status === "read" ? `${num(v.value)}${v.unit === "count" ? "" : ` ${v.unit}`}` : statusWord(v);

function readingText(r: PidReading): string {
  if (r.unit === "enum") return `${r.id} ${String(r.value)}${r.label === undefined ? "" : ` (${r.label})`}`;
  return `${r.id} ${num(r.value)} ${r.unit}`;
}

function freezeText(f: FreezeFrame): string {
  if (f.status === "none-stored") return "none stored";
  if (f.status !== "stored") return statusWord(f);
  return [`stored for ${f.dtc}`, ...f.readings.map(readingText)].join("; ");
}

function readinessLines(m: ModuleCodes): string[] {
  const r = m.readiness;
  if (r.status !== "read") return [`- Readiness (PID 01): ${statusWord(r)}`];
  const monitors = r.monitors.map((x) => `${x.id} ${x.complete ? "complete" : "incomplete"}`).join(", ");
  return [
    `- MIL (PID 01): ${r.mil ? "on" : "off"}; stored emission codes: ${String(r.dtcCount)}`,
    `- Readiness monitors (PID 01): ${monitors === "" ? "none available" : monitors}`,
  ];
}

function moduleSection(m: ModuleCodes): string[] {
  return [
    `### Module ${m.ecu}`,
    "",
    `- Stored codes (Mode 03): ${dtcText(m.stored)}`,
    `- Pending codes (Mode 07): ${dtcText(m.pending)}`,
    `- Permanent codes (Mode 0A): ${dtcText(m.permanent)}`,
    ...readinessLines(m),
    `- Warm-ups since codes cleared (PID 30): ${pidText(m.pids["30"])}`,
    `- Distance since codes cleared (PID 31): ${pidText(m.pids["31"])}`,
    `- Time since codes cleared (PID 4E): ${pidText(m.pids["4E"])}`,
    `- Distance with MIL on (PID 21): ${pidText(m.pids["21"])}`,
    `- Time with MIL on (PID 4D): ${pidText(m.pids["4D"])}`,
    `- Freeze frame (Mode 02): ${freezeText(m.freezeFrame)}`,
    "",
  ];
}

function verdictSentence(r: CodesReport["recentlyCleared"]): string {
  if (r.verdict === "indicated" && r.strong) {
    return "Codes appear to have been cleared recently (strong signal): permanent codes are present, no stored codes are, and a readiness monitor is incomplete. A scan tool cannot clear permanent codes.";
  }
  if (r.verdict === "indicated") {
    return "Codes appear to have been cleared recently: no stored codes, a readiness monitor incomplete, and a counter since codes cleared below the policy threshold.";
  }
  if (r.verdict === "not-indicated") {
    return "No sign of a recent clear: every counter since codes cleared that was read is at or above the policy threshold.";
  }
  if (r.legs.countersLow === "unknown") {
    return "Unknown: no counter since codes cleared (PID 30, 31 or 4E) was read, so the data cannot show when codes were last cleared.";
  }
  return "Unknown: the checks disagree, so the data does not show whether codes were cleared recently.";
}

/** Markdown section from fixed templates; deterministic; no VIN; numbers only from the report. */
export function renderCodesReport(report: CodesReport): string {
  const { legs, verdict } = report.recentlyCleared;
  const n = report.modules.length;
  const row = (check: string, t: Tri) => `| ${check} | ${t} |`;
  return [
    "## Diagnostic codes",
    "",
    `Observed data from ${String(n)} module${n === 1 ? "" : "s"}: ${report.modules.map((m) => m.ecu).join(", ")}. Each value is shown as the module reported it.`,
    "",
    `### Recently cleared: ${verdict === "not-indicated" ? "not indicated" : verdict}`,
    "",
    verdictSentence(report.recentlyCleared),
    "",
    "| Check | Result |",
    "|---|---|",
    row("No stored codes (Mode 03)", legs.noStoredDtcs),
    row("A readiness monitor incomplete (PID 01)", legs.monitorsIncomplete),
    row("A counter since codes cleared below policy (PIDs 30, 31, 4E)", legs.countersLow),
    row("Permanent codes present (Mode 0A)", legs.permanentDtcs),
    "",
    `Policy thresholds, set by this project and not taken from a standard: warm-ups below ${String(LOW_COUNTER["30"])}, distance below ${String(LOW_COUNTER["31"])} km, time below ${String(LOW_COUNTER["4E"])} min.`,
    "",
    ...report.modules.flatMap(moduleSection),
  ].join("\n");
}
