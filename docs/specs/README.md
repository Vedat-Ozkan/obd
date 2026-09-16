# Specs

One file per task, written by the `architect` agent, named `<task-id>-<slug>.md` (for example `T0.4-elm327-session.md`). Free-form requests get an `X-` prefix and a date (`X-2026-09-20-fix-vin-parse.md`).

A spec is the contract between the architect, the implementer, and the reviewer. The implementer builds exactly this; the reviewer checks exactly this.

## Template

```markdown
# <task-id>: <title>

## Goal
One paragraph. What outcome is visible to a user or to a test when this is done.

## Non-goals
- Adjacent things this task deliberately does not do.

## Interfaces
```ts
// public signatures, minimal; show before/after for changes
```

## Files
- `packages/obd-core/src/...` — create — one line on what it holds
- ...

## Sources
| Constant / behavior | Source |
|---|---|
| Mode 01 PID 0x0C RPM formula | docs/ELM327.md §Mode 01 table |
| Header DA1D for Equinox EV | packages/obd-core/vehicles/chevrolet-equinox-ev/default.json |
| "SEARCHING..." handling | fixtures/recordings/chrysler-200/2026-09-17-spike.jsonl line 12 |

## Verification
- [ ] `pnpm -F obd-core test` includes `<test file>` covering <behaviors>
- [ ] `pnpm replay fixtures/recordings/<file>` prints <expected>
- [ ] `pnpm check` green
- [ ] Hardware-only: `pnpm hil:smoke` against <car>, expect <response>; record to `fixtures/recordings/<car>/<date>-<slug>.jsonl`

## Risks / open questions
- ...

## Decisions
(filled in by the orchestrator after the user answers open questions)
```
