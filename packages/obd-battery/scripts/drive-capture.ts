import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseElmResponse } from "../../obd-core/src/elm/reader.js";
import { reassemble } from "../../obd-core/src/elm/isotp.js";
import { parseRecording, type RecordingLine } from "../../obd-core/src/recording/format.js";
import { importObdbMode22 } from "../../obd-core/src/vehicles/obdb/import.js";
import { chargeLogFromRecording, num, span, type Point } from "../src/session.js";

// Layout: docs/specs/T2.12-test-drive-capture.md §Design, Analysis script. Decoding is chargeLogFromRecording's (T2.4); this file only
// measures the times and the steps around the decoded samples.
const root = fileURLToPath(new URL("../../../", import.meta.url));

/** Policy value, not a vehicle constant: just under the smallest step BM8 names, the ~26 A charger step (docs/ML.md §Methods). */
export const STEP_MIN_A = 20;
/** Skew: the two currents bracketing a group set count as "the same" within this many amps. */
const BRACKET_SAME_A = 10;

interface Tx { line: number; t: number; command: string; session: number; target: string }
interface Sample { point: Point; tx: number; session: number }

/** Nearest rank: the smallest value with at least p of the sample at or below it. */
const rank = (sorted: readonly number[], p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? NaN;
const sortedCopy = (values: readonly number[]) => [...values].sort((a, b) => a - b);
const stats = (values: readonly number[]): string => {
  if (values.length === 0) return "n=0";
  const sorted = sortedCopy(values);
  return `n=${String(values.length)}, median ${num(rank(sorted, 0.5))} s, p90 ${num(rank(sorted, 0.9))} s, max ${num(sorted.at(-1) ?? NaN)} s`;
};
const gaps = (pairs: readonly (readonly [Sample, Sample])[]) => pairs.map(([a, b]) => span(a.point.t, b.point.t));

/** Recorded reply text of the tx at `index` of the lines: the rx lines up to the next tx, cut at the first '>'. */
function replyText(lines: readonly RecordingLine[], index: number): string {
  let text = "";
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines.at(i);
    if (line?.dir === "tx") break;
    if (line?.dir === "rx") text += line.data;
  }
  const end = text.indexOf(">");
  return end < 0 ? text : text.slice(0, end);
}

/** The 2AF1 payload after its 62 2A F1 echo, as printed hex, from the reassembled reply. */
function rawHex(text: string): string {
  const frame = reassemble(parseElmResponse(text, "22 2AF1").lines).frames.find((f) => f.header === "18DAF1CB" && f.data[0] === 0x62 && f.data[1] === 0x2a && f.data[2] === 0xf1);
  return frame === undefined ? "none" : [...frame.data.subarray(3)].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("") || "empty";
}

export async function driveCaptureSummary(lines: readonly RecordingLine[], recording: string): Promise<string> {
  const signals = importObdbMode22(JSON.parse(readFileSync(resolve(root, "packages/obd-core/vehicles/chevrolet-equinox-ev/default.json"), "utf8")));
  const log = await chargeLogFromRecording(lines, recording, signals);

  // Every tx with its 1-based line number, its session (boundaries seen before it) and the module its 22 read went to.
  const txs: Tx[] = [];
  const txLine: number[] = []; // index into `lines` of txs[i]
  let session = 0;
  let target = "";
  lines.forEach((line, i) => {
    if (line.dir === "meta" && line.event === "charge-log session") session++;
    if (line.dir !== "tx") return;
    const command = line.data.replace(/\r$/, "");
    if (command.startsWith("ATSH DA")) target = command.slice(7, 9);
    txs.push({ line: i + 1, t: line.t, command, session, target });
    txLine.push(i);
  });
  const byTime = new Map(txs.map((tx, i) => [`${tx.command}@${String(tx.t)}`, i]));
  const txAt = (command: string, t: number) => byTime.get(`${command}@${String(t)}`) ?? -1;
  const sampled = (points: readonly Point[], command: string): Sample[] => points.flatMap((point) => {
    const tx = txAt(command, point.t);
    return tx < 0 ? [] : [{ point, tx, session: txs[tx]?.session ?? 0 }];
  });
  const current = sampled(log.current, "22 2414");
  const volts = sampled(log.packVolts, "22 2885");
  const voltAt = new Map(volts.map((v) => [v.tx, v]));
  const group1 = txs.flatMap((tx, i) => tx.command === "22 2AE1" ? [i] : []);
  const between = (a: number, b: number) => group1.some((g) => g > a && g < b);

  // A "fast" pair of consecutive samples has no 22 2AE1 tx between them; the others read across a group set.
  const consecutive = (samples: readonly Sample[]) => samples.slice(1).flatMap((b, i) => {
    const a = samples.at(i);
    return a !== undefined && a.session === b.session ? [[a, b] as const] : [];
  });
  const split = (samples: readonly Sample[]) => {
    const all = consecutive(samples);
    return { fast: all.filter(([a, b]) => !between(a.tx, b.tx)), across: all.filter(([a, b]) => between(a.tx, b.tx)) };
  };
  const currentGaps = split(current);
  const voltGaps = split(volts);

  // The 2885 read that follows its own 2414 read directly.
  const own = (sample: Sample): Sample | undefined => {
    const next = txs.at(sample.tx + 1);
    return next?.command === "22 2885" && next.session === sample.session ? voltAt.get(sample.tx + 1) : undefined;
  };
  const offsets = current.flatMap((c) => { const v = own(c); return v === undefined ? [] : [span(c.point.t, v.point.t)]; });

  // Complete group sets: t is the 22 2AE1 tx; the span runs to the 22 2AE7 tx that follows it.
  const setTx = log.groups.map((g) => txAt("22 2AE1", g.t));
  const setSpans = setTx.map((first) => {
    const last = txs.findIndex((tx, i) => i > first && tx.command === "22 2AE7");
    return last < 0 ? undefined : { first, last, seconds: span(txs[first]?.t ?? 0, txs[last]?.t ?? 0) };
  });
  const setIntervals = log.groups.slice(1).map((g, i) => span(log.groups[i]?.t ?? 0, g.t));

  const skew = setSpans.flatMap((s) => {
    if (s === undefined) return [];
    const previous = current.filter((c) => c.tx < s.first && c.session === txs[s.first]?.session).at(-1);
    const next = current.find((c) => c.tx > s.last && c.session === txs[s.last]?.session);
    if (previous === undefined || next === undefined) return [];
    const before = span(previous.point.t, txs[s.first]?.t ?? 0);
    const after = span(txs[s.last]?.t ?? 0, next.point.t);
    return [{ before, after, bracket: span(0, before + s.seconds + after), same: Math.abs(next.point.value - previous.point.value) <= BRACKET_SAME_A }];
  });

  // Time from a tx to the next tx of the same session, by kind of command.
  const timing = new Map<string, number[]>();
  txs.forEach((tx, i) => {
    const next = txs.at(i + 1);
    if (next === undefined || next.session !== tx.session) return;
    const kind = tx.command.startsWith("AT") ? "AT commands" : tx.command.startsWith("22 ") ? (tx.target === "17" ? "22 on 17" : tx.target === "CB" ? "22 on CB" : undefined) : undefined;
    if (kind !== undefined) timing.set(kind, [...(timing.get(kind) ?? []), span(tx.t, next.t)]);
  });
  const median = (values: readonly number[] | undefined) => values === undefined || values.length === 0 ? "n=0" : `n=${String(values.length)}, median ${num(rank(sortedCopy(values), 0.5))} s`;

  // Steps: consecutive fast current samples with |ΔI| >= STEP_MIN_A, each paired with the 2885 sample of its own pair.
  const steps = currentGaps.fast.flatMap(([a, b]) => {
    const dI = b.point.value - a.point.value;
    const va = own(a); const vb = own(b);
    if (Math.abs(dI) < STEP_MIN_A || va === undefined || vb === undefined) return [];
    const dV = vb.point.value - va.point.value;
    return [{ a, b, va, vb, dI, dV, r: -dV / dI * 1000 }];
  });
  const resistances = sortedCopy(steps.map((s) => s.r));
  const largest = [...steps].sort((x, y) => Math.abs(y.dI) - Math.abs(x.dI)).slice(0, 10);
  const lineOf = (tx: number) => String(txs[tx]?.line ?? "?");
  const mohm = (value: number) => (Math.round(value * 10) / 10).toFixed(1);

  const boundaries = (log.sessions ?? []).filter((s) => s.reason !== "start");
  const first = txs.at(0); const last = txs.at(-1);
  const stopLine = lines.filter((l) => l.dir === "meta" && typeof l.note === "string" && l.note.startsWith("test drive stopped:")).at(-1);
  const socs = log.soc;
  const raw = txs.flatMap((tx, i) => tx.command === "22 2AF1" ? [rawHex(replyText(lines, txLine[i] ?? 0))] : []);
  const amps = log.current.map((p) => p.value);

  const out = [
    `# Test drive: ${recording}`,
    "",
    `Recording: ${recording}`,
    `Synthetic: ${log.synthetic ? "yes" : "no"}`,
    `Stop: ${stopLine?.dir === "meta" && typeof stopLine.note === "string" ? stopLine.note.slice("test drive stopped:".length).trim() : "none recorded"}`,
    `Span: ${first === undefined || last === undefined ? "no tx" : `${num(span(first.t, last.t))} s (t=${num(first.t)} to t=${num(last.t)})`}`,
    `Sessions: ${String(Math.max(1, (log.sessions ?? []).length))}${boundaries.length === 0 ? "" : ` (${boundaries.map((s) => `${s.reason} at t=${num(s.t)}`).join("; ")})`}`,
    "",
    "## Intervals",
    "",
    "Intervals and times are nearest rank; a sample's time is its tx line's t.",
    "",
    `- Current, fast (no group read between): ${stats(gaps(currentGaps.fast))}`,
    `- Current, across a group read: ${stats(gaps(currentGaps.across))}`,
    `- Voltage, fast: ${stats(gaps(voltGaps.fast))}`,
    `- Voltage, across a group read: ${stats(gaps(voltGaps.across))}`,
    `- Current to voltage within a pair: ${stats(offsets)}`,
    `- Complete group sets: ${String(log.groups.length)}, dropped ${String(log.droppedGroupSets.length)}`,
    `- Group set to group set: ${stats(setIntervals)}`,
    `- Group set span (2AE1 tx to 2AE7 tx): ${stats(setSpans.flatMap((s) => s === undefined ? [] : [s.seconds]))}`,
    "",
    "## Skew",
    "",
    `Per complete group set with a decoded current on each side (n=${String(skew.length)} of ${String(log.groups.length)}).`,
    "",
    `- Before (2AE1 tx minus previous 2414 tx): ${stats(skew.map((s) => s.before))}`,
    `- After (next 2414 tx minus 2AE7 tx): ${stats(skew.map((s) => s.after))}`,
    `- Bracket (before + span + after): ${stats(skew.map((s) => s.bracket))}`,
    `- Bracketing currents within ${String(BRACKET_SAME_A)} A: ${String(skew.filter((s) => s.same).length)} of ${String(skew.length)} sets`,
    "",
    "## Command times",
    "",
    "Median time from a tx to the next tx in the same session.",
    "",
    ...["AT commands", "22 on 17", "22 on CB"].map((kind) => `- ${kind}: ${median(timing.get(kind))}`),
    "",
    "## Steps",
    "",
    `Consecutive fast current samples with |ΔI| >= ${String(STEP_MIN_A)} A; R = -ΔV/ΔI, ΔV between the 2885 reads of the same two pairs.`,
    "",
    `- Steps: ${String(steps.length)}`,
    steps.length === 0 ? "- R: n=0" : `- R (mΩ): median ${mohm(rank(resistances, 0.5))}, Q1 ${mohm(rank(resistances, 0.25))}, Q3 ${mohm(rank(resistances, 0.75))}`,
    "",
    ...(largest.length === 0 ? [] : [
      "| t (s) | Δt (s) | I a→b (A) | V a→b (V) | R (mΩ) | tx lines: 2414 a, 2885 a, 2414 b, 2885 b |",
      "|---|---|---|---|---|---|",
      ...largest.map((s) => `| ${num(s.a.point.t)} | ${num(span(s.a.point.t, s.b.point.t))} | ${num(s.a.point.value)} → ${num(s.b.point.value)} | ${num(s.va.point.value)} → ${num(s.vb.point.value)} | ${mohm(s.r)} | ${lineOf(s.a.tx)}, ${lineOf(s.va.tx)}, ${lineOf(s.b.tx)}, ${lineOf(s.vb.tx)} |`),
      "",
    ]),
    "## Context",
    "",
    `- SOC (2B43): ${socs.length === 0 ? "none" : `first ${num(socs[0]?.value ?? NaN)} % at t=${num(socs[0]?.t ?? NaN)}, last ${num(socs.at(-1)?.value ?? NaN)} % at t=${num(socs.at(-1)?.t ?? NaN)}`}`,
    `- 2AF1 raw hex (no scaling): ${raw.length === 0 ? "none" : `first ${raw[0] ?? "none"}, last ${raw.at(-1) ?? "none"}`}`,
    `- Current: ${amps.length === 0 ? "none" : `min ${num(Math.min(...amps))} A, max ${num(Math.max(...amps))} A`}`,
  ];
  return out.join("\n") + "\n";
}

async function main(paths: readonly string[]): Promise<string> {
  const sections: string[] = [];
  for (const path of paths) {
    // As pnpm charge-log: only a redacted recording or a file under fixtures/synthetic.
    const underSynthetic = relative(resolve(root, "fixtures/synthetic"), resolve(path));
    if (!path.endsWith(".redacted.jsonl") && (underSynthetic.startsWith("..") || isAbsolute(underSynthetic))) {
      throw new Error(`expected a redacted or explicitly synthetic JSONL path: ${path}`);
    }
    sections.push(await driveCaptureSummary(parseRecording(readFileSync(resolve(path), "latin1")), path));
  }
  return sections.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) {
    process.stderr.write("usage: drive-capture <*.redacted.jsonl|fixtures/synthetic/*.jsonl>...\n");
    process.exitCode = 1;
  } else {
    main(process.argv.slice(2)).then((output) => process.stdout.write(output)).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
