# Evaluation and ground truth

The claim this project wants to make is not "it knows your battery's health" but "on these vehicles and sessions, the estimate was within X of the reference, the interval covered the reference N times out of M, and here is every session." That requires real logged charges, not synthetic curves.

## Fixtures

```
fixtures/
  recordings/<car>/<date>-<slug>.jsonl          immutable transcript (see ARCHITECTURE.md format)
  recordings/<car>/<date>-<slug>.label.json     label, when the recording is a labeled session
  recordings/<car>/<date>-<slug>.log.jsonl      charge-session log (Phase 2), same naming
  synthetic/<slug>.jsonl + .label.json          hand-written or injected; always labeled synthetic: true
  README.md                                     format + label schema
```

`<car>` for a vehicle the owner does not own (beta tester, inspection customer, borrowed car) is make-model-year plus a short anonymous id; the meta line records consent and provenance, never the VIN.

Label schema (zod in `obd-eval`), one per labeled session:

```json
{
  "car": "chevrolet-equinox-ev-2024",
  "session": "charge" | "snapshot",
  "condition": "healthy" | "fault",
  "reference": { "method": "integrated-energy" | "charger-kwh", "capacity_kwh": 0, "soc_start": 0, "soc_end": 0 },
  "fault": { "id": "cell-imbalance", "detail": "injected +40 mV on one cell group", "injected_at_s": 1200 },
  "notes": "ambient 6 °C, Level 2 charger",
  "synthetic": false
}
```

`reference` is present for charge sessions with enough ΔSOC to compute one; `fault` only for injected (synthetic) faults. The numbers above are placeholders for the shape, not data.

## Scoring

**Deterministic report (T2.4–T2.7).** Replay tests assert every report field against the recording. A report number that does not trace to a logged value fails.

**Capacity estimates (T2.4 baseline, BM2 models).** Per session: estimate, reference, absolute and relative error, interval and whether it covers the reference, reference method. Per run: the per-session table plus per-vehicle aggregates with n next to every number, and empirical coverage of the nominal interval. Split by vehicle and session before any windowing (see [ML.md](ML.md)); calibration sessions never appear in the test split. When there are few vehicles, report leave-one-vehicle-out results.

**Imbalance anomaly detection (BM3).** Detection rate and time to detection on injected faults; false positives on healthy real sessions. Injected-fault results are synthetic and always in a separate table from healthy real sessions.

**12 V (T2.5).** Deterministic thresholds with sources; tested on recordings, not scored as a model.

**In-app LLM (T2.10, T2.11; BM5).** Per generated summary or answer: every number checked against the report or tool results (mismatch is a hard fail and the app falls back to the template), unsupported claims counted, omissions of flagged items counted, citations resolve, correct refusal when data is missing, tokens, cost, latency, model, prompt version. Semantic grading by an LLM judge is reported with its agreement against the owner's labels and n. Prompt-injection cases are pass/fail. A CI suite replays saved responses through the checkers; live model runs are `pnpm eval` only. See [ML.md](ML.md).

**Agent-driven discovery (T2.3).** Proposal precision: candidates the agent proposed that the owner verified, over all it proposed; plus candidates the owner found that the agent missed, session cost, and time. Blocked commands logged by the MCP allowlist are listed.

Results go to `docs/eval-results.md` with git SHA, date, model or code revision, dataset version, and split identity. A synthetic case never counts toward a real-data table.

## Signal verification

A signal is `verified` for a vehicle only when a recording from that vehicle shows it and a plausibility check passes (for example, current sign flips between charge and drive; temperature tracks ambient at rest; SOC agrees with the dash). The recording path goes in the vehicle profile. Everything else is `community` and labeled so in the app.

## Faults and safety

No faults are induced on any vehicle. The EV's high-voltage system is never touched; battery faults exist in this project only as synthetic injections into real logs. The only write the software sends is Mode 04 (clear codes) after an explicit confirmation, used when recording the "recently cleared" fixture on the Chrysler (T0.7).

## What the eval cannot claim

One owned EV, a handful of beta vehicles, and a few charge sessions each is a small set. The reference capacity is itself an estimate. The report shows every session and vehicle. It can show that an estimate is biased or that an interval is too narrow; it cannot support a certified state-of-health claim. If this ships to other people, the honest label is "observed data; estimate compared against N logged charges on M vehicles, listed here."
