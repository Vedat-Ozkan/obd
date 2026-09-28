# X-2026-09-27-power-state-meta: battery-scan power state as its own meta key

## Goal

A battery scan's power state ("Ready, Park confirmed in app" or unknown) survives the beta upload scrubber. Today the app puts it only in the first meta `note` (`apps/mobile/App.tsx:225`). `packages/obd-battery/src/report.ts:110` reads it from any meta note that matches `ready`, and `scrub.ts` replaces the first note with `"removed before upload"`. So an uploaded scan replays with `powerState` `"unknown"`: information is lost, though nothing leaks. This is T2.9 Decision 19 ("decided yes", `docs/task-runs/T2.9.md`). When this task is done:

- the app writes a closed-value `powerState` key on the scan's start meta line;
- the scrubber keeps that key only for values in the closed set and refuses the file for any other value (the Decision 15 pattern);
- `report.ts` prefers the key and falls back to the note, so every committed recording replays exactly as before.

What a test can see: an app-written scan goes through `runAndSaveBatteryDiagnosis`, then the outbox (scrub, parts, manifest), then the fake backend and the in-process Worker. It replays into 12 V observations with `powerState` `"ready"` (toggle yes) or `"unknown"` (toggle unknown), equal to the local report's.

## Non-goals

- Power state for capture, codes, debug-send or charge-log runs. Their note is free user text. The charge log has its own `state` key, which stays dropped (T2.9 Decision 15).
- A `"other"` value, or any new UI. The app has one toggle, yes/unknown (`App.tsx:345`), and cannot write `"other"`.
- Changing the note text, the `USER_NOTE` replacement, or the note regex fallback.
- `packages/obd-battery/scripts/twelve-volt-report.ts`. It has the same regex but reads only committed fixtures, and none of them have the key. It is left as is.
- `tools/spike/redact_vin.py`, its `VERSION`, and `tools/beta-intake/` (see §Python parity).
- Consent or privacy copy (open question 5).
- Editing any recording (hard rule 2), or re-recording anything.
- **Off-limits (Codex T2.10, in flight):** `packages/obd-assist/`, `tools/summary-backend/`, `fixtures/synthetic/t2.10-*`, `docs/specs/T2.10*`, `docs/task-runs/T2.10.md`. Do not read-modify-write or stage them.

## Interfaces

**`apps/mobile/src/recording.ts`**

```ts
// before
export interface RecordingMeta { car: "chevrolet-equinox-ev-2024"; dongle: "veepeak-obdcheck-ble"; note: string; writeChar: string; notifyChar: string; mtu: number }
// after: optional; only the battery scan sets it
export interface RecordingMeta { car: …; dongle: …; note: string; powerState?: "ready" | "unknown"; writeChar: string; notifyChar: string; mtu: number }
```

**`apps/mobile/src/batteryDiagnosisFlow.ts`** (new export)

This moves the literal out of `App.tsx` so that the E2E exercises the exact line the app writes.

```ts
import type { BleConnection } from "./ble/BleTransport.js"; // type-only, erased: no BLE import at runtime
export function batteryScanMeta(link: Pick<BleConnection, "writeCharacteristicUuid" | "notifyCharacteristicUuid" | "mtu">, ready: boolean): RecordingMeta;
// Returns, in this key order (pythonJsonLine keeps insertion order):
// { car: "chevrolet-equinox-ev-2024", dongle: "veepeak-obdcheck-ble",
//   note: ready ? "battery diagnosis; Ready, Park confirmed in app" : "battery diagnosis; vehicle power state unknown",
//   powerState: ready ? "ready" : "unknown",
//   writeChar: link.writeCharacteristicUuid, notifyChar: link.notifyCharacteristicUuid, mtu: link.mtu }
```

**`apps/mobile/App.tsx`**: in `diagnose`, replace the start literal at line 225 with `scanRecording.start(batteryScanMeta(active, diagnosisReady))`. Nothing else changes.

**`packages/obd-core/src/recording/scrub.ts`**

```ts
// before
export const SCRUB_VERSION = 1;
const META_KEYS = new Set([... "event", "reason"]);
// after
export const SCRUB_VERSION = 2;
const META_KEYS = new Set([... "event", "reason", "powerState"]);
// apps/mobile/src/batteryDiagnosisFlow.ts batteryScanMeta; this task's spec.
const POWER_STATES = new Set(["ready", "unknown"]);
```

In `meta()`, next to the event/reason check, add this rule. When `powerState` is present (any JSON value, `null` included) and is not a string in `POWER_STATES`, the scrubber throws `ScrubRefusal(n, "meta powerState outside the battery-scan allowlist")`. The message never includes the value. The key is allowed on any meta line, as `event`/`reason` are. Nothing else in the file changes. `SCRUB_RULES` gains no new rule, because a kept key is not "masked".

**`packages/obd-battery/src/report.ts`** (`batteryDiagnosisFromRecording`, line 110)

```ts
// before
const powerState: VehiclePowerState = lines.some(<meta note matches /(?:^|[, ]+)ready(?:[, ]+|$)/i>) ? "ready" : "unknown";
// after: the key on the session-start line (the one meta line with `car`; already required unique above) wins.
// It must be "ready" or "unknown", otherwise throw Error("battery scan power state meta is invalid").
// With no key, the existing note regex runs unchanged over all meta lines.
```

`scrubReport.version` and `betaProvenanceSchema.scrubVersion` stay `typeof SCRUB_VERSION` and `z.literal(SCRUB_VERSION)`, so both become 2 (open question 3).

## Files

1. `packages/obd-core/src/recording/scrub.ts`: modify. Add the `powerState` key, `POWER_STATES`, the refusal rule, and `SCRUB_VERSION` 2.
2. `packages/obd-core/test/beta-scrub.test.ts`: modify. Add isolated cases S1–S3.
3. `packages/obd-core/test/beta-provenance.test.ts`: modify. The hardcoded `scrubVersion: 1` (line 16) becomes `SCRUB_VERSION`. The bump forces this change; no new cases.
4. `packages/obd-battery/src/report.ts`: modify. Prefer the key, fall back to the note.
5. `packages/obd-battery/test/battery-diagnosis.test.ts`: modify. Add isolated cases R1–R2.
6. `apps/mobile/src/recording.ts`: modify. Add the optional `powerState` to `RecordingMeta`.
7. `apps/mobile/src/batteryDiagnosisFlow.ts`: modify. Export `batteryScanMeta`.
8. `apps/mobile/App.tsx`: modify. `diagnose` starts the scan with `batteryScanMeta(active, diagnosisReady)`.
9. `apps/mobile/test/beta-outbox.test.ts`: modify. Add E2E E1 inside the existing `describe.each(BACKENDS)`.
10. `docs/specs/T2.9-beta-data-upload.md`: modify. Edit the §Scrub rules `meta-key` row in place to the final rule: add `powerState` to the key list, with values `ready` and `unknown`; any other value refuses the file. Decision 19 stays as frozen text. The orchestrator marks it done in `docs/task-runs/T2.9.md`.

No new dependencies. The orchestrator owns the task records (`docs/task-runs/X-2026-09-27-power-state-meta.md`, and the Decision 19 line in `docs/task-runs/T2.9.md`), so they are not implementer files.

## Sources

| Constant / behavior | Source |
|---|---|
| Values `ready` / `unknown` and when each is written | `apps/mobile/App.tsx:225`: the two note strings chosen by `diagnosisReady`. `App.tsx:345`: the toggle has only yes/unknown |
| `VehiclePowerState` (`"ready" \| "other" \| "unknown"`); `"other"` is never written | `packages/obd-battery/src/twelve-volt.ts:1` |
| Note fallback regex, kept byte-for-byte | `packages/obd-battery/src/report.ts:110` |
| Closed-value allowlisted meta key, otherwise refuse | T2.9 Decision 15; `scrub.ts` `SESSION_EVENT`/`SESSION_REASONS` and the `meta()` check |
| Key name must not be `state` (charge-log key, stays dropped) | T2.9 Decision 15; `packages/obd-battery/src/session.ts:49` |
| First meta note replaced, later notes date-masked | `scrub.ts` `meta()`; T2.9 §Scrub rules `user-note`, `date-in-note` |
| App meta lines in Python `json.dumps` form, insertion order | `apps/mobile/src/recording.ts` `pythonJsonLine` |
| Old files keep the power state in the note: `"ready, park, …"`, `"Equinox Ready, Park; …"` | first meta line of each committed recording under `fixtures/recordings/chevrolet-equinox-ev-2024/*.redacted.jsonl`; `fixtures/synthetic/battery-diagnosis-full-scan.jsonl` line 1 |
| `redact_vin.py` passes meta keys through | `tools/spike/redact_vin.py` `redact()`: only 0902/224193 rx lines are re-dumped, every other line is copied verbatim, and a marker is appended |

This task touches no PID, AT command, header or DTC format. `ATRV` handling in `report.ts` is unchanged.

## Python parity (`tools/spike/redact_vin.py`)

Nothing is needed. `redact_vin.py` has no meta-key allowlist. It copies non-VIN lines verbatim, so `powerState` survives the C2 intake redact step. Its `VERSION` stays 1, since its own output for any input is unchanged. The Stage A parity test compares the two tools outside VIN messages "except the first meta line and the marker". Its synthetic inputs carry no `powerState`, so it is unaffected.

## SCRUB_VERSION and artifacts

The version is bumped to 2. The fail-closed allowlist changed, and the version is how a later reader (BM1, intake) tells a file where a v1 scrubber stripped the power state from one that never had it. Effects:

- **Stage A artifact `452e1393…`** (`packages/obd-core/test/beta-scrub-summary.md`) stays **byte-identical**. The table has no version column, and none of the four committed recordings has a `powerState` key. Baseline regenerated at 8dcc0e7: `452e139309cd680f824106b1205e50bcb00b973c4697ba86702ebaa7ebacb94b`.
- **Stage B/C1 E2E artifacts** (`/tmp/t2.9-{b,c1}-{codes,charge-log}.jsonl`): only the last line (provenance, `"scrubVersion": 2`) changes. Everything before it (`head -n -1`) is byte-identical to the baseline, and the new full hashes go in this task's record.
- **C2 intake artifact `bfacfd43…`** (log lines only, no content) is expected unchanged. Regenerate and compare.
- A v1 manifest or provenance line fails zod after the bump. The Worker answers 400, and intake refuses. That is accepted: no tester has uploaded yet (T2.9 Stage E not run). See open question 3.

## Verification

Shared checks (every item): `pnpm check` green, `git diff --check` clean, no off-limits path in the diff.

- [ ] **E2E E1 (both backends: fake and `createBetaClient` over the Worker, and both toggle values).**
  1. For `ready ∈ {true, false}`, start `new RecordingBuffer(() => 1)` with `batteryScanMeta({ writeCharacteristicUuid: "fff1", notifyCharacteristicUuid: "fff2", mtu: 23 }, ready)`.
  2. Run `runAndSaveBatteryDiagnosis` over `new ReplayTransport(fixtures/synthetic/battery-diagnosis-full-scan.jsonl)` with a `mine` entry, capturing the kept `jsonl`. Result `saved`.
  3. `outbox.decide(true)`, then `outbox.queue("battery-scan", MINE, kept)`, which returns `"Queued for beta upload."`. This is the same call `App.tsx` makes. Then `drain()`.
  4. The uploaded body (without provenance) equals `scrubRecording(kept).text`, and `scrubRecording(body).text === body` (the intake re-scrub, T2.9 Decision 13). Provenance `kind` is `battery-scan` and `scrubVersion` is `SCRUB_VERSION`.
  5. The body's first line has `note` `"removed before upload"` and `powerState` equal to `"ready"` or `"unknown"`.
  6. `batteryDiagnosisFromRecording(body, …)` gives `twelveVolt.observations` that is non-empty (the fixture has `ATRV`), where every `powerState` is `"ready"` (toggle yes) or `"unknown"` (toggle unknown), and deep-equal to the saved local report's `twelveVolt`.
  7. Artifact: the uploaded bytes go to `/tmp/x-power-state-<b|c1>-<ready|unknown>.jsonl`. The SHA-256 is identical across two runs, and the four hashes go in the record.
  8. Mutation check: reverting `META_KEYS` to without `powerState` makes the `ready` case fail at step 5 or 6.
- [ ] **Backward compatibility, committed recordings.**
  - `node --import tsx packages/obd-battery/scripts/battery-diagnosis.ts fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl --garage-id 1 --scanned-at 2026-09-22T00:00:00.000Z | diff - packages/obd-battery/test/battery-diagnosis-spike.md` gives no diff (still `state ready`, from the note). Baseline PASS at 8dcc0e7.
  - The T2.5a `twelve-volt-reports.md` diff (T2.5a spec, Verification 2) gives no diff.
  - Existing `battery-diagnosis.test.ts`, `battery-diagnosis-flow.test.ts` and the `/tmp/t2.6d-synthetic-report.md` output are unchanged. Those tests keep their own `meta` (no key), so they exercise the note fallback.
- [ ] **Artifacts** as in §SCRUB_VERSION and artifacts:
  - `pnpm exec tsx packages/obd-core/scripts/beta-scrub.ts <four files> | sha256sum` gives `452e1393…`;
  - the B/C1 body hashes (`head -n -1`) equal the baseline. The implementer records the baseline before editing;
  - the C2 intake log is unchanged.
- [ ] **Isolated tests** (AGENTS.md Testing rules). These are failure modes that E1 cannot catch, listed before any code. Each is one case.
  - S1. An out-of-set string (`"other"`, `"Ready"`, `"ready, park"`, `"2026-09-27"`) is kept or silently dropped instead of refusing. It must throw `ScrubRefusal` with the line number → `beta-scrub.test.ts` `power-state-refusal`.
  - S2. A non-string value (`true`, `1`, `null`, `["ready"]`, `{}`) is kept or dropped instead of refusing → the same case, a second table.
  - S3. The refusal message echoes the value. The message must not contain the test value, for example a VIN-like `"1C4SYNTHETICVIN00"` → the same case.
  - R1. The key does not win over the note. A synthetic start line with `powerState: "unknown"` and a note containing `ready` must give `"unknown"`; with `powerState: "ready"` and a note without `ready`, it must give `"ready"` → `battery-diagnosis.test.ts` `power-state-key-wins`. The inputs are built in the test from the `battery-diagnosis-full-scan.jsonl` lines by replacing only line 1, and labeled synthetic.
  - R2. An invalid key value in a local file (`"other"`, `1`) is silently treated as unknown or as ready. It must throw `"battery scan power state meta is invalid"` → `power-state-invalid`.

  E1 already covers these, so they get no isolated test: the key being dropped, the first note no longer being replaced, non-idempotence, and the app writing the wrong value for the toggle.
- [ ] `pnpm -F obd-core test`, `pnpm -F obd-battery test`, `pnpm -F mobile test`, and `pnpm -F mobile typecheck` are green.
- [ ] **Hardware (optional owner check; not a gate, NOT RUN is acceptable with that reason).** On the phone with the Equinox:
  1. set the toggle to yes and run Battery diagnosis;
  2. the kept private scan's first line has `"powerState": "ready"`;
  3. the rendered 12 V line reads `state ready`.

  No committed recording is produced.

## Risks / open questions

1. **Key name.** Recommendation: `powerState`, the same word as the report field. Not `state`, which the charge log already uses and scrub drops (Decision 15).
2. **Value set.** Recommendation: `{ready, unknown}`, exactly what the app writes. Add `"other"` only when the app can write it, which would mean a scrub version bump.
3. **Provenance accepts only `scrubVersion` 2.** Recommendation: only 2 (`z.literal(SCRUB_VERSION)` unchanged). No tester files exist yet, and a union would be code for a case nobody has. If Stage E ships before this task, revisit and accept `1 | 2`.
4. **Keep the power-state wording in the note.** Recommendation: keep it. It is human-readable in the private file, it is removed before upload anyway, and changing it would change the local `t2.6d` artifacts for no gain.
5. **Consent copy.** The upload now carries the user's "Ready and in Park" toggle. That is a fact about the car's state, not about a person, and the current text ("the replies your car's modules gave the app…") does not list it. Recommendation: no copy change in this task. Fold one clause into the consent-copy cleanup and `beta-1` re-pin that is already pending before Stage E (`docs/task-runs/T2.9.md`, owner quotes).
6. **Intake leg in E1.** Recommendation: no `uvRedact` run in E1. The re-scrub equality check in step 4 is intake's Decision 13 check, and `redact_vin.py` keeping meta keys verbatim is shown by its code (§Sources). Adding the leg would pull in `tools/beta-intake/intake.test.ts` as an eleventh file.
- Risk: `batteryScanMeta` must import `BleConnection` type-only. A value import would pull the BLE module into the Node test run. Mitigation: `import type`, and `pnpm -F mobile test` fails if it is wrong.

## Decisions

(frozen at kickoff; orchestrator records owner answers here)

### Orchestrator decisions (2026-09-27, standing delegation)

Open questions 1–6 are decided as recommended:
1. The key is `powerState`.
2. Its values are `ready` | `unknown` only.
3. `scrubVersion` 2 only.
4. The note keeps its power-state wording.
5. No consent-text change now. One clause is added in the pre-Stage-E consent cleanup.
6. The intake redact step is not part of E1.

The Stage B/C1 upload artifacts (`eb769cd0…`, `e1bb7fee…`) are expected to change only in their final provenance line (the scrub version). Every line before it must stay byte-identical, and the new hashes must be stable across runs. The Stage A artifact `452e1393…` and the C2 intake log `bfacfd43…` must not change.
