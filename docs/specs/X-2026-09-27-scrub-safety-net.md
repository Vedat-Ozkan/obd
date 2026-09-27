# X-2026-09-27: Pin lowercase and concatenated-rx scrub safety checks

## Goal

Close the two test gaps left by the approved T2.9 Stage A review. Synthetic in-test recordings passed through the public `scrubRecording` entry point prove that a VIN serial learned from a `0902` reply causes a fail-closed `ScrubRefusal` when it later survives only as lowercase hex in one output line, or only as uppercase hex formed across concatenated `rx` chunks after carriage returns and spaces are removed. Each regression must catch the corresponding R2 or R5 mutation recorded by the Stage A reviewer.

The current implementation already performs both checks. This follow-up adds test coverage only.

## Non-goals

- Do not change `UploadScrubber`, `scrubRecording`, scrub rules, refusal text, serialization, exports, or `SCRUB_VERSION`.
- Do not expand failure mode 13 beyond the two reviewer-recorded gaps, and do not address T2.9 Decisions 18 or 19.
- Do not add or edit recordings, synthetic fixture files, the scrub summary artifact, the T2.9 spec or task record, the plan, decisions, or product code.
- Do not repeat parity, intake, mobile upload, backend, or hardware work already covered by T2.9.
- Do not add a mutation framework or a reusable test abstraction for two cases.

## Interfaces

No public interface changes. Both cases call the existing export:

```ts
export function scrubRecording(text: string): { text: string; report: ScrubReport };
```

The observable contract is unchanged: a learned serial surviving in any safety-net form throws `ScrubRefusal`; its message identifies the masking failure without containing the VIN or serial.

## Files

- `packages/obd-core/test/beta-scrub.test.ts` — modify — add two synthetic cases to isolated scrubber failure mode 13.

No other implementation or test file is in scope. The orchestrator separately owns `docs/task-runs/X-2026-09-27-scrub-safety-net.md`.

## Dependencies

None. Use the existing Vitest setup and the helpers already local to `beta-scrub.test.ts`.

## Sources

| Constant / behavior | Source |
|---|---|
| A serial learned from `vin-0902` is checked in pass 2 as ASCII, upper- or lowercase hex anywhere in the text, hex in each exchange's concatenated `rx` after `\r` and spaces are removed, and bytes in reassembled payloads | `docs/specs/T2.9-beta-data-upload.md` §Scrub rules, refusal 4; §Sources “Safety-net search forms” |
| The reference safety net searches `s.hex()` and `s.hex().upper()` in the full output, and searches both hex forms in normalized concatenated replies | `tools/spike/redact_vin.py` `_safety_net` |
| Failure mode 13 requires refusal when a learned serial survives outside a masking rule | `docs/specs/T2.9-beta-data-upload.md` §Verification, Stage A, isolated failure mode 13 |
| Existing failure mode 13 covers ASCII, a serial learned from `4193`, and a raw serial visible only in a reassembled payload, but does not isolate lowercase hex or concatenated-`rx` hex | `packages/obd-core/test/beta-scrub.test.ts`, test `13 safety-net` |
| The approved Stage A reviewer found the exact gaps: lowercase-hex mutation R2 and concatenated-`rx` mutation R5 survived | `docs/task-runs/T2.9.md` Stage A re-review entry dated 2026-09-25; `docs/task-runs/X-2026-09-27-scrub-safety-net.md` baseline |
| Synthetic VIN and ISO-TP builders used by the existing scrub tests | `packages/obd-core/test/beta-scrub.test.ts` constants `VIN`, `SERIAL`, and helpers `frames`, `exchange`, `file`, `vin0902` |

No OBD constant, command, header, PID, DID, scaling formula, or DTC rule is introduced. The tests reuse the existing synthetic `0902` source exchange and existing non-rule test shapes.

## Verification

These are isolated safety-property tests because no committed recording contains the two leak forms. The failure modes and their counterfactual mutations are specified before implementation so the added tests do not merely restate the current code.

### Failure modes listed before test changes

1. **R2, lowercase hex is accepted.** Pass 1 learns the six-character serial from a synthetic `0902` reply and masks that reply, but pass 2 checks only ASCII and uppercase hex. A later meta line containing only the serial's lowercase hex survives and the file is accepted.
2. **R5, hex split across `rx` records is accepted.** Pass 1 learns and masks the same serial, but pass 2 checks each JSON line and reassembled payloads without checking the exchange's normalized concatenated `rx`. The uppercase serial hex is divided between two later `rx` records, with `\r` and spaces between pieces, so no individual line or reassembled payload contains it; the file is accepted.

### Required tests

- [ ] Add `13d safety-net-lowercase-hex`. Build the complete input in the test with existing helpers: the first exchange is the existing synthetic `0902` learning exchange; a later non-first meta note contains `toHex(bytes(SERIAL)).toLowerCase()` and no ASCII or uppercase-hex copy of the serial. Assert first that the lowercase form differs from the uppercase form so the case cannot pass vacuously. Calling `scrubRecording(input)` must throw `ScrubRefusal`; its message contains `a VIN serial survives masking`, and `assertQuiet` proves the message contains no VIN or serial form.
- [ ] Add `13e safety-net-rx-concat-hex`. The first exchange is the same learning exchange. A later exchange divides `toHex(bytes(SERIAL))` between at least two `rx` rows and inserts spaces and `\r` so that:
  - neither row nor its serialized JSON line contains the complete hex serial;
  - removing spaces and `\r` from the later exchange's joined `rx` data yields the complete uppercase hex serial;
  - the later data does not form a reassembled payload containing the raw serial.

  Assert those preconditions in the test. Calling `scrubRecording(input)` must throw the same quiet `ScrubRefusal`. Use existing synthetic command/reply shapes; do not add a sourced vehicle constant merely to carry the chunks.
- [ ] Both cases use `scrubRecording`, not direct calls to `UploadScrubber.verify`, private helpers, a copied search expression, or a mock. Keep them beside existing failure mode 13 and retain the existing in-test synthetic data policy. No fixture or artifact file is created.

### Mutation proof

The implementer temporarily applies one mutation at a time to `packages/obd-core/src/recording/scrub.ts`, runs only the named case, records the expected failing assertion, and restores the file byte-for-byte before the next mutation and before any full check. Mutations are evidence only and must not appear in the final diff.

- [ ] **R2:** remove only the lowercase-hex branch from the full-line check in `UploadScrubber.verify` (`line.includes(hexOf(s).toLowerCase())`). Run:

  ```sh
  pnpm exec vitest run packages/obd-core/test/beta-scrub.test.ts -t "13d safety-net-lowercase-hex"
  ```

  Expected evidence: FAIL because `scrubRecording` accepts the synthetic file instead of throwing. Restore `scrub.ts`; the same command passes.
- [ ] **R5:** remove only the uppercase normalized concatenated-`rx` branch from `UploadScrubber.verifyEnd` (`rx.includes(hexOf(s))`). Run:

  ```sh
  pnpm exec vitest run packages/obd-core/test/beta-scrub.test.ts -t "13e safety-net-rx-concat-hex"
  ```

  Expected evidence: FAIL because `scrubRecording` accepts the synthetic file instead of throwing. Restore `scrub.ts`; the same command passes. The construction preconditions must ensure that the full-line and reassembled-payload checks cannot catch this case.
- [ ] After both mutation checks, `git diff -- packages/obd-core/src/recording/scrub.ts` is empty. The reviewer checks that the final product source matches the task baseline; the reviewer does not retain or approve mutated source.

### Required final checks

- [ ] `pnpm exec vitest run packages/obd-core/test/beta-scrub.test.ts -t "13d safety-net-lowercase-hex|13e safety-net-rx-concat-hex"` passes with exactly the two new cases selected.
- [ ] `pnpm -F obd-core test` passes, including all existing scrub E2E, artifact, parity, and isolated cases.
- [ ] `pnpm check` passes.
- [ ] `git diff --check` passes.
- [ ] `git status --short` and the scoped diff show this follow-up changed only `packages/obd-core/test/beta-scrub.test.ts`, this spec, and the orchestrator-owned task record. Pre-existing unrelated work remains untouched.

### Hardware

No hardware check. This follow-up adds deterministic coverage for pass-2 string handling and sends no command to a vehicle.

## Risks / open questions

- The main risk is a false mutation proof: another safety-net branch might refuse the synthetic input after the intended branch is removed. The required construction assertions isolate lowercase full-line matching from uppercase matching, and normalized concatenated-`rx` matching from per-line and payload matching.
- Test names use `R2` and `R5` only as the historical Stage A mutation labels. They are unrelated to Cloudflare R2 or the later Stage C1 repair labels in `docs/task-runs/T2.9.md`.
- No real defect was found in the current implementation. If either case fails before mutation, stop and return to architecture with the observed input and failure; do not expand this test-only spec into a product-code repair.
- No owner decision, recording, network access, or hardware session is required.

## Decisions

- Keep the follow-up test-only because the current public entry point implements both promised checks.
- Add two focused cases under existing failure mode 13 rather than a new fixture or mutation framework.
- Require explicit R2 and R5 counterfactual failures to show that each regression protects a distinct branch.
