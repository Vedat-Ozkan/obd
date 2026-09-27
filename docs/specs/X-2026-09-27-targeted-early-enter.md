# X-2026-09-27: Drain early Enter presses in the targeted watch

## Goal

Fix the open T2.3b queue defect in `tools/spike/targeted.py`. Once an Enter is rejected because the current state has not completed its full rotation or, for charging, its minimum time, every Enter already queued during that ineligible interval is discarded. When the state first becomes eligible, the tool establishes a clean queue boundary and waits for a new Enter submitted after that boundary. Queued early input can therefore end neither the current state nor a later state.

The offline fake-car run is deterministic: it uses a controlled logical clock and a real `asyncio.Queue`, proves the old implementation fails, and writes the normalized artifact `/tmp/x-2026-09-27-targeted-early-enter.json`. No vehicle session is required.

## Non-goals

- Do not change the five states, watch list, poll order, rotation pointer, state minimums, BLE behavior, allowlist, commands, recording format, or hardware run card from T2.3b.
- Do not change `discover.py`'s separate mark handling. It has no eligibility interval or ignored-mark path.
- Do not add command-line options, general input abstractions, queue subclasses in production, or a reusable state-machine layer.
- Do not edit recordings, the T2.3b spec or task record, the plan, or other documentation.
- Do not repeat the completed Equinox hardware session. This repair changes local stdin queue handling only.

## Interfaces

The callable signature remains unchanged:

```python
async def watch_targeted(
    elm: Elm,
    rec: Recorder,
    core: list[tuple[str, str]],
    rotate: list[tuple[str, str]],
    marks: "asyncio.Queue[str]",
) -> None: ...
```

For each state, `watch_targeted` has two input phases:

1. **Ineligible.** The full rotating list has not yet been polled, or the charging minimum has not elapsed. After each completed poll cycle, drain the queue synchronously with repeated `get_nowait()` calls until `asyncio.QueueEmpty`. Do not `await` between those calls. If at least one mark was drained, write one existing `early mark ignored` meta for that cycle and print one retry message. A batch of marks is one ignored event; no new recording field is required.
2. **Eligible.** On the first cycle for which nothing is missing, drain the queue once more before arming the state, because those marks could have arrived during the final ineligible polling cycle. This is the eligibility boundary. Any drained marks receive the same ignored meta and a message that the state is now ready but a new Enter is required. Do not end the state on this cycle. On a later cycle, accept one queued mark and advance. Because queue draining and arming contain no `await`, a producer coroutine cannot insert a mark inside that boundary; a mark queued after the boundary is fresh.

Reset the armed/eligibility-boundary flag at every new state. Continue to examine marks only between complete polling cycles. Extra marks queued together with an accepted fresh mark remain harmless: the next state's ineligible drain, or its first eligible boundary for a one-entry synthetic rotation, removes them before that state can advance.

The existing visible rules remain true: a state needs a full rotation; charging also needs `CHARGE_MIN_S`; an ignored mark records `note="early mark ignored"`; and the user presses Enter again after the tool says the state is ready.

## Files

- `tools/spike/test_targeted.py` — modify first; replace the wall-clock-sensitive press fake with deterministic queue/timing coverage, including the normalized artifact.
- `tools/spike/targeted.py` — modify only the between-cycle mark handling in `watch_targeted`; keep its signature and all polling behavior.

No other file is in scope.

## Dependencies

None. Use Python 3.11 stdlib `asyncio.Queue`, `asyncio.QueueEmpty`, and existing pytest support.

## Sources

| Behavior | Source |
|---|---|
| Open defect: one ignored early mark consumes only one item, leaving extra presses able to end the same or a later state | `docs/task-runs/T2.3b.md` Review finding 1 |
| Marks are examined between cycles; a mark is eligible only after one full rotation and, while charging, after `CHARGE_MIN_S` | `docs/specs/T2.3b-targeted-watch.md` Interfaces, Phase C steps 4–5 |
| Current one-item consumption (`empty()`, one `get_nowait()`, then eligibility check) | `tools/spike/targeted.py` `watch_targeted`, current lines 104–110 |
| The stdin producer may enqueue any number of lines until EOF | `tools/spike/targeted.py` `main.feed` and `docs/specs/T2.3b-targeted-watch.md` Interfaces, Stdin |
| Current fake uses real elapsed time for the charging case and was recorded as a low-risk timing weakness | `tools/spike/test_targeted.py` `Presses`; `docs/task-runs/T2.3b.md` Review finding 2 |
| Five state names, charging state selection, five-minute production minimum, and rotating/full-cycle behavior remain unchanged | `tools/spike/targeted.py` `STATES`, `CHARGE_STATE`, `CHARGE_MIN_S`, and `watch_targeted`; `docs/specs/T2.3b-targeted-watch.md` Sources and Decisions 6 |

No OBD constant, command, header, PID, DID, scaling formula, or DTC rule is introduced or changed.

## Verification

Write the regression before changing `targeted.py`. Record its failure against the current code in the implementation report.

### Failure modes listed before code

1. **Only one item is discarded.** Two or more Enters queued while rotation/time is incomplete leave a stale item that ends the same state once it becomes eligible.
2. **A stale batch crosses states.** Enough early Enters end the current state and one or more following states without a fresh Enter for each state.
3. **Final-cycle input bypasses the drain.** An Enter arriving during the last ineligible polling cycle is present when eligibility is first observed and is accepted as though it were post-eligibility.
4. **The eligibility boundary accepts its own backlog.** A queued mark present when the boundary is established ends the state on that same cycle.
5. **Fresh input is lost or never accepted.** After the boundary, a new Enter fails to end the eligible state on the next completed cycle.
6. **State reset is wrong.** The next state inherits the previous state's armed status and can accept input that preceded its own eligibility boundary.
7. **Charging timing is nondeterministic or weakened.** The test depends on a 0.2-second scheduling race, or charging advances before the controlled clock reaches `CHARGE_MIN_S`.
8. **The repair disturbs polling or recording.** Command allowlisting, core-per-cycle polling, rotation order, five state metas, phase end, or strict replay changes.

### Required offline checks

- [ ] **Test first / counterfactual:** the new queued-input E2E in `tools/spike/test_targeted.py`, run against the current `targeted.py`, fails because a queued early mark advances a state before the scripted fresh mark. A timeout alone is insufficient evidence; report the assertion showing the unexpected state advance or missing fresh-press requirement.
- [ ] **Deterministic E2E:** exercise the public `watch_targeted` entry point with the existing fake ELM client, a real `asyncio.Queue[str]`, `ROTATE_S = 0`, a small core/rotate list, and a controlled logical clock used by `targeted.py`. Do not use `sleep(0.2)`, elapsed wall time, or an `empty()`/`get_nowait()` test double to decide eligibility. Scheduler yields may coordinate coroutines but may not be the timing oracle.
- [ ] In that run, queue a batch of at least three marks while the first state is ineligible and inject another mark during its final ineligible cycle. Observe at least one further completed poll cycle after the first eligible status without supplying fresh input. Assert that only the first state meta exists. Then supply one fresh mark and assert the second state begins. Repeat enough scripted input to finish all five states, including a charging early batch and one fresh post-boundary mark per state.
- [ ] Assert the run covers failure modes 1–8: states appear exactly once and in `STATES` order; no state advances at its boundary; each advances after its own fresh mark; charging's logical elapsed time is at least `CHARGE_MIN_S`; ignored metas identify the states where early batches were supplied; phases end with `end`; every command passes `discover.check_allowed`; core and rotating polling retain the existing order; and `replay_ok(lines, strict=True)` passes.
- [ ] The E2E writes `/tmp/x-2026-09-27-targeted-early-enter.json` using sorted keys and a trailing newline. The normalized JSON contains `synthetic: true`, the five-state order, the states receiving early batches, `advanced_without_fresh_press: false`, `fresh_presses_accepted: 5`, `charging_minimum_met: true`, `strict_replay: true`, and `ended: true`. It contains no recorder timestamps or wall-clock durations. The test asserts the exact object before writing it; rerunning the command produces byte-identical bytes.
- [ ] Run the focused check twice and compare artifacts:

  ```sh
  uv run --no-project --with pytest pytest -q tools/spike/test_targeted.py
  cp /tmp/x-2026-09-27-targeted-early-enter.json /tmp/x-2026-09-27-targeted-early-enter.first.json
  uv run --no-project --with pytest pytest -q tools/spike/test_targeted.py
  cmp /tmp/x-2026-09-27-targeted-early-enter.first.json /tmp/x-2026-09-27-targeted-early-enter.json
  ```

  Expected evidence: pytest passes both times; `cmp` is silent; the artifact has the exact normalized fields above.
- [ ] `cd tools/hil-bridge && uv run ruff check ../spike` passes.
- [ ] `uv run --no-project --with pytest pytest tools/spike` passes. If the local gitignored T2.3a discovery recording is absent, the existing citation test may report its documented skip; this repair's E2E must pass and create its artifact.
- [ ] `pnpm check` passes.
- [ ] `git diff --check` passes, and `git status --short` shows no task changes outside the two Files entries and the architect spec/orchestrator record.

### Hardware

No hardware check. T2.3b already completed the real five-state session, and this repair has a deterministic offline reproduction at the stdin queue boundary.

## Risks / open questions

- A fresh Enter is accepted only after another poll cycle completes. This preserves the existing rule that marks are taken between cycles and can add up to one cycle of latency after the ready line. It does not add OBD traffic beyond cycles the tool already performs while waiting for input.
- A user may press immediately as the ready line appears while the first eligible-cycle drain is completing. The drain is deliberately conservative: input already queued at that boundary is rejected, and the message asks for another press. This is the only way to guarantee that no input from the final ineligible cycle is reused without adding timestamps or a second input channel.
- No open owner decision is required. The requested invariant determines the conservative boundary behavior.

## Decisions

- Preserve the `watch_targeted` signature and recording meta shape.
- Use a per-state eligibility boundary and synchronous queue drain; do not timestamp individual stdin lines.
- One drained batch produces one existing `early mark ignored` meta, regardless of batch size.
- Use deterministic offline evidence only; no new vehicle recording or dependency.
