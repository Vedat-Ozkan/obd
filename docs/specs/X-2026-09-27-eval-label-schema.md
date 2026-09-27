# X-2026-09-27: Align the planned eval session-label documentation

## Goal

Update the documented, still-planned `*.label.json` session-label contract so it accurately describes the checked-in T2.4 synthetic charge-log label. A reader should be able to tell that `synthetic-generator` and its `capacity_ah` / `capacity_kwh` values are deterministic generator truth used by one synthetic E2E fixture, that `windows`, `weak_group`, and `planted` are fixture-specific test metadata, and that none of those fields is an independent real-vehicle capacity reference, battery-health evidence, or proof of implemented common zod validation. Add the smallest matching note to `fixtures/README.md` so its inventory and implementation-status language no longer imply that no `*.label.json` exists.

## Non-goals

- Do not change the generated fixture, its generator, its E2E consumer, or any recording bytes.
- Do not implement `packages/obd-eval`, a zod schema, runtime label parsing, migration, or validation.
- Do not redefine `*.replay-label.json`; those files remain protocol-observation labels distinct from session labels.
- Do not add or infer a real Equinox capacity reference, `healthy` condition, state of health, or hardware result.
- Do not promote T2.4's integrated-current estimate or BMS energy figure to independent truth. Preserve the T2.4 and ADR-016 limitations.
- Do not revise scoring, model evaluation, fixture naming, the plan, architecture, decisions, task records, or unrelated stale fixture inventory.
- Do not add dependencies, tests, generated artifacts, or hardware work.

## Interfaces

No runtime TypeScript or Python interface changes.

The documentation describes a **planned common session-label shape**, not an implemented parser. Revise the `docs/EVAL.md` example and adjacent prose to express this minimum contract:

```ts
interface PlannedSessionLabel {
  car: string;
  session: "charge" | "snapshot";
  condition: "healthy" | "fault";
  reference?: {
    method: "integrated-energy" | "charger-kwh" | "synthetic-generator";
    capacity_ah?: number;
    capacity_kwh?: number;
    soc_start: number;
    soc_end: number;
  };
  fault?: { id: string; detail: string; injected_at_s: number };
  notes: string;
  synthetic: boolean;
  // A fixture may carry task-owned extension fields outside the common shape.
}
```

This TypeScript notation is a documentation aid for the implementer; `docs/EVAL.md` may retain its JSON-shaped example. The prose is authoritative for this task:

1. `capacity_ah` and `capacity_kwh` are unit-explicit optional capacity quantities. A label includes the quantity or quantities supplied by its method and fixture; the documentation must not manufacture a value that the evidence does not contain.
2. `integrated-energy` and `charger-kwh` remain planned methods for evidence-backed charge sessions. Their presence in the planned vocabulary does not itself make a measurement independent or establish health; the applicable measurement method, SOC basis, uncertainty, and provenance still control the claim.
3. `synthetic-generator` is permitted only on a label with `synthetic: true`. It denotes deterministic inputs known to a synthetic fixture generator and is a test oracle, not an independent measurement, a real-car reference, or health evidence.
4. The checked-in `charge-log-rested.label.json` uses both `capacity_ah` and `capacity_kwh`. Its `condition: "fault"` describes an injected synthetic scenario only.
5. `windows`, `weak_group`, and `planted` in that label are T2.4 fixture-specific extensions consumed by the owning E2E test. They are not fields of the planned common shape. Their current use through a test-local TypeScript type must not be described as common zod validation.
6. Retain the existing rule that `fault` is for injected synthetic faults and that synthetic results stay separate from real results. Adjust the broad statement that `reference` is present only for a sufficiently large real charge session so it also admits synthetic generator-oracle labels without weakening the real-session evidence rule.

## Files

- `docs/EVAL.md` — modify — align the planned label example and its explanatory prose with the T2.4 generated label and state the evidence and implementation boundaries above.
- `fixtures/README.md` — modify — add one compact inventory/status entry for the generated `synthetic/charge-log-rested.jsonl` plus `charge-log-rested.label.json`, and state that this task-specific label is consumed by the T2.4 test while the common `obd-eval` zod schema remains planned and unimplemented. Keep the existing ten protocol fixtures and their `*.replay-label.json` statement scoped to those ten.

No other implementation file may change. The spec itself is authored before implementation and is not part of the implementer's two-file limit.

## Sources

| Documented behavior | Source |
|---|---|
| Generated label uses `method: "synthetic-generator"`, both `capacity_ah` and `capacity_kwh`, `condition: "fault"`, `synthetic: true`, and the `windows`, `weak_group`, and `planted` extensions | `fixtures/synthetic/charge-log-rested.label.json` |
| Label values and extension objects are deterministically produced by the fixture generator | `packages/obd-battery/scripts/synthetic-charge-log.ts`, `generate()` label object |
| T2.4 test treats Ah/kWh as generator truth, reads extensions through a test-local TypeScript interface, and does not run a common runtime label validator | `packages/obd-battery/test/charge-log.test.ts` `Label` interface and synthetic charge-log cases |
| Synthetic fixture/label creation, byte-identical regeneration, and generator-truth intent | `docs/specs/T2.4-charge-logger.md` Files and Verification > Stage A |
| Integrated-current result is BMS-SOC-referenced and not independent; BMS energy/SOC is a comparison rather than a reference | `docs/specs/T2.4-charge-logger.md` Goal and Estimates and error budgets; `docs/DECISIONS.md` ADR-016 |
| Existing planned common label shape, synthetic/real separation, and limits on health claims | `docs/EVAL.md` Fixtures, Scoring, and What the eval cannot claim |
| Current fixture inventory and explicit planned/unimplemented common-schema boundary | `fixtures/README.md` Directory and tracked inventory, Protocol replay observation labels, and Future session label schema |

No OBD PID, command, CAN header, scaling formula, threshold, or new numeric constant is introduced by this documentation task.

## Verification

No new automated test, Python check, fixture regeneration, or hardware run is required for a two-file documentation-only alignment. Verification combines the repository completion gate with a source and diff review:

- [ ] Run `git diff --check -- docs/EVAL.md fixtures/README.md`; expect exit 0 and no output.
- [ ] Run `git diff -- docs/EVAL.md fixtures/README.md`; confirm the diff is limited to the planned session-label description and the single compact fixture inventory/status alignment described under Files.
- [ ] Run `rg -n 'synthetic-generator|capacity_ah|capacity_kwh|windows|weak_group|planted|planned|not implemented|not independent|health' docs/EVAL.md fixtures/README.md`; confirm the two documents collectively state all six interface rules above without saying that common zod validation exists.
- [ ] Cross-check `docs/EVAL.md` against `fixtures/synthetic/charge-log-rested.label.json` and `packages/obd-battery/scripts/synthetic-charge-log.ts`: every documented current field exists in the generated label, and no fixture-specific extension is promoted into the planned common shape.
- [ ] Cross-check the evidence wording against `packages/obd-battery/test/charge-log.test.ts`, the T2.4 spec, and ADR-016: generator values are described as synthetic test truth only; integrated current remains BMS-SOC-referenced; the BMS figure remains a comparison; no real health or independent-reference claim appears.
- [ ] Run `git status --short -- docs/EVAL.md fixtures/README.md`; expect only those two implementation files changed by the implementer. Preserve all unrelated in-flight work in the shared tree.
- [ ] The implementer runs `pnpm check`; expect exit 0. The independent reviewer reruns `pnpm check` and records its own PASS, as required by `AGENTS.md` and `docs/WORKFLOW.md`. No new test is added for this documentation-only change.

Evidence for review is the bounded two-file diff, successful `git diff --check` output, and reviewer-owned green `pnpm check`. Record every item as PASS or FAIL in the task run. Hardware is **NOT RUN — not applicable to documentation-only work**. No task-specific automated test is added.

## Risks / open questions

- **Largest risk:** the name `reference` can make synthetic generator inputs look like an independent real-world reference. The implementation must keep the field name for alignment with the checked-in fixture while placing the synthetic-only restriction and evidence disclaimer next to the method definition.
- The planned common schema does not yet define runtime rules such as whether one capacity quantity is mandatory or whether unknown extension keys are accepted. This task documents current intent and current fixture facts; the future `obd-eval` implementation must make those validation decisions in its own spec.
- `fixtures/README.md` has other inventory language that may age as Phase 2 adds files. This task updates only the T2.4 session-label contradiction; a broad inventory refresh is outside scope.

No owner decision blocks implementation.

## Decisions

1. Keep `reference` as the documented field name to match the checked-in fixture; qualify `synthetic-generator` at its definition instead of renaming or migrating generated data in a docs-only task.
2. Add `capacity_ah` beside `capacity_kwh` as optional, unit-explicit quantities in the planned shape. Do not prescribe or invent conversion between them.
3. Keep `windows`, `weak_group`, and `planted` outside the planned common shape and identify them as fixture-specific T2.4 extensions.
4. Update `fixtures/README.md` because its current future-only wording is contradicted by the checked-in generated `.label.json`. Limit that edit to one compact inventory/status alignment rather than a general inventory rewrite.
5. Keep the common zod label schema explicitly planned and unimplemented. The existing test-local TypeScript type is consumption of one fixture, not runtime schema validation.
