# X-2026-09-23-write-safety task run

## Ownership

- Last tool: Claude
- Last role: reviewer (round 3 — final, spawned 2026-09-23)
- Current stage: CLOSED 2026-09-24 with owner-accepted follow-ups
- Completed stages: preflight, architecture (Claude architect 2026-09-23), open question answered, scope confirmation (owner: "start the implementer"; T0.5 committed first as `f22c970`), implementation (Claude implementer 2026-09-23)
- Other active tool or role: another session is editing `apps/mobile` for T0.8c; this task must not touch those files

## Contract

- Task: the T0.7 prerequisite from T0.4 review round 3 (PLAN T0.7 row; `docs/task-runs/T0.4.md`): (a) reject empty or whitespace-only sends, which reportedly make an ELM327 repeat the last command — source that behaviour in `docs/ELM327.md` first; (b) block other UDS reset/clear/write-type services from a checked-in, sourced service table (not just `04`, `2E`, `2F`, `31`); (c) block `ATCAF0` (formatting off, where the caller supplies the PCI byte) or check the service byte after a caller-supplied PCI — source the CAF semantics first. Applies to the `obd-core` session write guard; say whether the app console allowlist (`apps/mobile/src/console.ts`) and the future relay need matching changes.
- Spec paths: `docs/specs/X-2026-09-23-write-safety.md`
- Approved decisions: owner "start the T0.7 write-safety prerequisite" (2026-09-23); spec question: add the header/protocol sequence rule now (owner, as recommended)
- Repair count: 2 of 2 (last allowed)
- Escalation count: 0
- Escalation reason: none

## Baseline

- Git state at start: `main` at `9c364ca`. Uncommitted: T0.5 Stages A+B (approved, awaiting the owner's commit: `docs/ELM327.md`, `docs/ARCHITECTURE.md`, `packages/obd-core/{src/obd,test,vehicles,scripts/replay.ts}`, the T0.5 spec/record, a synthetic fixture), orchestrator edits to `docs/PLAN.md` and `docs/task-runs/T0.4.md`, and another session's T0.8c work (`apps/mobile/App.tsx`, `apps/mobile/metro.config.js`, `docs/specs/T0.8c-mobile-follow-up.md`, `docs/task-runs/T0.8.md`).
- Current guard: `packages/obd-core/src/elm/session.ts` rejects non-printable characters, service `04`/`2E`/`2F`/`31` after normalization, and validates the init protocol; `exchange()` re-checks non-printables before the single `transport.write`.
- Constraint: no car or Bluetooth; replay- and fixture-based.

## Touched files

- `docs/task-runs/X-2026-09-23-write-safety.md` (this record)
- `docs/specs/X-2026-09-23-write-safety.md` (architect; Decisions by orchestrator)

## Verification evidence

### Implementation (Claude implementer, 2026-09-23)

- Files: `src/elm/guard.ts` (new), `src/elm/session.ts`, `test/guard.test.ts` (new), `test/session.test.ts`, `docs/ELM327.md` (§Write safety after §J1979 conventions), `docs/ARCHITECTURE.md`.
- Baseline replay summaries captured before the change; after the change all byte-identical (both redacted spikes, three synthetic fixtures; both local discovery files, last line only, temp dir deleted).
- Guard tests G1–G7 incl. 256 first-byte sweep and four spellings of every refused ID; session tests 9 (extended), 14, 15. `pnpm -F obd-core test` PASS (11 files, 205). Five mutations each caught by the named tests. `pnpm check` PASS; `git diff --check` PASS; purity PASS; no new dependencies. Datasheet citations checked against ELM327DSJ (temp dir, deleted; no datasheet text in the repo).
- Deviations: `normalize` exported; comment wording; test 9 title; test 15 timeout case starts from a real ATZ; §Write safety names the Wikipedia article; one extra G7 assertion.

## Review findings

### Round 1 (Claude reviewer, 2026-09-23): REQUEST_CHANGES

1. [blocking, CLOSED round 2] `guard.ts:65` — `afterReply` clears the header flag after any `ATZ` reply, including `STOPPED`/`?`; a busy ELM discards the ATZ (DS p.9, p.48), so the natural timeout→`init()` recovery can leave a 29-bit header active while the guard permits `ATSP6` → frames on 11-bit ID `0x5F1` (DS p.25). Spec defect; amended (clear only on non-error, non-timeout replies; tests).
2. [major, CLOSED round 2] no test that `ATSP` clears the confirmed protocol before the write (mutation passed CI); amended to add a G7 case.
3. [minor, no action] the `exchange()` re-check is untestable alone (defense in depth by design).
- Otherwise: 8/8 items; adversarial inputs refused; datasheet citations verified against rev J; replay output byte-identical for all 7 files; all 5 spec mutations and several extra ones caught; six deviations accepted.

### Repair round 1 (Claude implementer, 2026-09-23)

- `guard.ts`: `ReplyKind`; `afterReply(state, norm, kind)`; `ATZ` with kind `error` leaves state unchanged; `ATSP` confirms only on `ok`. `session.ts`: passes `r.kind` (timeouts throw before `afterReply`). Tests: two new G7 cases; session test 16 (`STOPPED`, `?`). New tests fail on the old code; finding-2 mutation caught. `pnpm -F obd-core test` PASS (209); `pnpm check` PASS; `git diff --check` PASS; all replay outputs byte-identical to the pre-edit baseline (discovery: last line only). Deviation: `ReplyKind` duplicates `ElmResponse["kind"]` to avoid a guard→session import.

### Round 2 (Claude reviewer, 2026-09-23): APPROVE (with a pre-existing major finding)

- Round-1 fixes verified with mutations; 8/8 items; 209 tests; replay outputs byte-identical to HEAD; ATZ reply-kind audit and all state paths (timeouts, write rejections, close, retries, resync, concurrency, LV RESET, stored ATSP default) safe.
- 1. [major, pre-existing since T0.4, open] `session.ts:208-211`, `:240-242` — after a timeout the session writes once the resync window expires even without a `>`, and `runInit()` writes `ATZ` without resync; a busy ELM discards the first received character (DS p.9, p.48), so e.g. `014FFFFFF1` could run as `14 FF FF FF`, `011011` as `11 01`, `02EF190ABCD1` as `2E …`; callers control `timeoutMs`. Unverified on real hardware; do not test it on the car. Orchestrator decision (owner delegation "go ahead as you see fit"): fix now in repair round 2 via spec amendment — no write without a prompt, and exact request lengths per service.
- 2. [minor, open] `docs/ELM327.md` §Write safety lacks the ATZ-with-error sentence; in the same amendment.

### Repair round 2, stop-report (Claude implementer, 2026-09-23)

- Stopped before editing: rule 1 conflicts with `fixtures/synthetic/session-branches.jsonl` lines 37–39 (write after an unanswered timeout) and with two scripted session tests (the synthetic-branches test and test 11). Rule 2: 0 wrong-length requests in all tracked, synthetic and local discovery files (discovery: counts only). No changes made.
- Orchestrator decision (owner delegation): option (a) — update the synthetic fixture and the two tests to the safe behaviour, accept an intended change to that fixture's replay summary, keep every other replay output byte-identical; implement rules 1, 2 and the doc text in the same round. Recorded in the spec.

### Repair round 2 (Claude implementer, 2026-09-23)

- `session.ts`: `resync()` reports whether a `>` arrived; `attempt()` rejects (timeout, stays stale, zero writes) when it did not; `runInit()` no longer clears stale. `guard.ts`: `READ_LENGTHS` (01:4, 02:6, 03:2, 06:4, 07:2, 09:4, 0A:2, 22:6). Tests: G8, G2 sweep, test 9 extended, synthetic-branches/11/replay-timeout updated, new test 17 — the new tests fail on the pre-change source (5 failed). `fixtures/synthetic/session-branches.jsonl`: late `>` added after the `0100` timeout (lines 35–37).
- `pnpm -F obd-core test` PASS (211); `pnpm check` PASS; `git diff --check` PASS; purity PASS.
- Replay: byte-identical for both redacted spikes, `elm-framing`, `standard-decoding`, `discovery-targeted` (last line). Intended change `session-branches`: `data 8 … timeout 1; frames 4` → `data 9 … timeout 0; frames 5`. Second stop: local `2026-09-23-discovery.jsonl` tx line 49776 (the T2.3a ordering defect) now leaves the replay stale; orchestrator accepted (spec note). Orchestrator deleted the leftover `/tmp/ws-src` datasheet download.
- Deviations: late `>` not expressible in `pnpm replay` (ReplayTransport delivers rx immediately), so the resync path is tested with a hold-back wrapper; replay no-`>` case inline; G2 sweep by lengths; test 17 inline.

### Round 3 attempt 1 (2026-09-23): NOT RUN — the reviewer was cut off by the API session limit before producing output. Re-spawned 2026-09-24.

- Context change before the re-run: the owner pruned unit tests across `packages/obd-core/test` and `apps/mobile/test` on 2026-09-24 (AGENTS.md Testing rules). `pnpm check` PASS with obd-core 134 tests (was 211), mobile 46. Session tests 4 and 5 are gone (correction from round 3: test 16 is still present at `session.test.ts:468`; the orchestrator's grep missed it); `guard.test.ts` untouched. This pruning is not part of this task.

### Round 3 (Claude reviewer, 2026-09-24): REQUEST_CHANGES (repair cap reached → owner)

- 8/8 items + 4/4 amendment items satisfied; replays byte-identical except the intended session-branches change; rule 1 and rule 2 mutations all caught; pruning lost no listed coverage.
- 1. [blocking] `docs/ELM327.md:134`, `guard.ts:15-16`: Mode 06 length `4` has no source (no request form in §Standard modes, no recording, T0.5 says "No Mode 06"). The other seven lengths are sourced.
- 2. [major] `docs/ELM327.md:134`: the "no spare payload" claim is false for the 6-character forms (a dropped first character on `22 701x` → `27 01`, `22 C03x` → `2C 03`, `02 90 0x` → `29 00`; the trailing digit is read as a response count, DS p.32). Frame byte of 02 not pinned to `00`. A fresh session starts not stale (session.ts:89), so its first write is outside rule 1 (the T0.6 reconnect case). Unverified whether ECUs honour such forms; do not test on the car.
- 3. [minor] local full discovery replay now takes ~1.5 h (5,615 tx after the stale point × 1 s resync). Note for T2.3b.
- 4. [minor] either allowlist check (session.ts:111, :183) can be removed without a test failing (defense in depth; round-1 finding 3). No action.
- 5. [minor] this record misstated test 16 as removed. Corrected above.

## Blocker

- None. Owner decision 2026-09-24: "Accept as is, fix later". Round-3 findings 1–3 become T0.7 follow-ups (below); task CLOSED with them open.

## Follow-ups (owner-accepted, open)

- Round-3 finding 1: source the Mode 06 request length or refuse `06` until a Mode 06 request is recorded.
- Round-3 finding 2: rewrite the §Write safety "no spare payload" sentence to state the residual for 6-character forms; optionally pin 02 to `02 <pid> 00`; T0.6 relay must handle the fresh-session first write (session starts not stale).
- Round-3 finding 3: the full local discovery replay takes ~1.5 h; note in T2.3b before analysis.

## Next action

- Owner commits. Then T0.6 escalation (relay onto `guard.ts`, OBD_RELAY_TOKEN, base64 padding) including the fresh-session follow-up.
