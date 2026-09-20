# Evaluation and ground truth

The claim this project wants to make is not "it diagnoses cars" but "on these labeled cases, it ranked the true fault first N times out of M, at this cost, and here is every case." That requires real labeled data, which means inducing real faults.

## Fixtures

```
fixtures/
  recordings/<car>/<date>-<slug>.jsonl          immutable transcript (see ARCHITECTURE.md format)
  recordings/<car>/<date>-<slug>.label.json     label, when the recording is a labeled case
  recordings/<car>/<date>-<slug>.log.jsonl      drive log (Phase 1), same naming
  synthetic/<slug>.jsonl + .label.json          hand-written; always labeled synthetic: true
  README.md                                     format + label schema
```

Label schema (zod in `obd-eval`):

```json
{
  "car": "chrysler-200-2013",
  "condition": "healthy" | "fault",
  "fault": { "id": "vacuum-leak", "detail": "brake booster hose disconnected", "induced_at_s": 412 },
  "expected_dtcs": ["P0171"],
  "acceptable_hypotheses": ["vacuum leak", "unmetered air"],
  "notes": "ambient 6 °C, cold start, 22 min drive",
  "synthetic": false
}
```

`acceptable_hypotheses` is a short list of phrasings the grader accepts as a match for top-k; the grader normalizes and matches on these, and the report shows the raw hypothesis text so a human can check the grader.

## Scoring

Per case: top-1 hit, top-3 hit, whether the top hypothesis's evidence references exist in the case (an evidence pointer to a feature that is not there is a hard fail), tokens in/out/cached, cost, latency, model, effort. Per run: the per-case table, plus aggregates with n shown next to every percentage. No single headline number without its n.

Healthy baselines are scored too: a run that hallucinates a fault on a healthy log is a false positive and counts.

Compare arms by changing one factor at a time: model, supported effort setting, prompt version, fine-tuning, or serving configuration. Exact model IDs and provider capabilities are verified in the task spec. Results go to `docs/eval-results.md` with git SHA, date, model revision, prompt version, and dataset/split identity. A synthetic case never counts toward the real-case headline table; it appears in a separate table.

## ML training and evaluation contract

ML1–ML6 follow the Phase 1 baseline; see [ML.md](ML.md). Compare the tuned model with the same untuned model using matched inputs and decoding settings, plus a larger hosted reference. Record all attempted configurations; select prompts/checkpoints on validation data and evaluate the frozen selection on held-out test data.

Split by independent source case/session before producing windows, paraphrases, or teacher-generated variants. Audit duplicates across datasets and keep each parent and its derivatives together. Keep labels out of model inputs. Hold out vehicles/fault families when coverage permits and state when it does not. Real, synthetic, and external-domain results have separate denominators and tables. Nine fault sessions do not become thousands of independent test cases by slicing them into windows.

Score top-1/top-3 ranking, healthy-case false positives, schema validity, reference resolution, unsupported conclusions, missing-evidence handling, and appropriate abstention. Review whether cited evidence actually supports each claim: a valid pointer alone is insufficient. Record the rubric and human adjudication for semantic judgments, including any model-assisted grading. Self-reported confidence is not calibrated probability; report calibration as unestablished unless there is enough independent evidence to assess it.

Required scenarios include healthy baselines, known faults, ambiguous evidence, missing sensors, conflicting observations, and out-of-coverage cases. Synthetic scenarios test behavior but cannot substitute for required real recordings. Report denominators and per-case failures; quantify uncertainty only with methods appropriate to independent cases, not correlated windows.

## Serving experiments

For ML5, independently vary prefix caching, inference precision, concurrency, and input/output size. Repeat quality evaluation after configuration changes. Record cold/warm state, hardware/runtime, exact model/adapter, workload and request count, output limits, errors, time to first token where exposed, time to complete validated output, p50/p95 latency, throughput, peak GPU memory, and cost. Do not infer first-token timing from a non-streaming response.

Include dated rates, training/rental expense, idle/startup cost, and marginal request cost separately. Load tests are laboratory workloads, not evidence of production demand. Publish reproducible commands/configurations and raw permitted measurements with the report; a regression or lack of improvement is a result, not a failed learning milestone.

Normal CI uses fixtures and does not require GPUs or paid API calls. Mocked unit tests are not model evaluation. Required training/serving runs marked NOT RUN leave the relevant milestone incomplete; they cannot use the vehicle hardware-only exception. Every report lists PASS, FAIL, and NOT RUN with reasons.

## Induced-fault protocol

Performed by the owner on the owner's cars. Each session: baseline read → induce → drive (or idle) → capture → restore → clear codes (Mode 04, confirmed) → drive to confirm baseline → next fault another day. One fault per session so labels are unambiguous. Record ambient temperature and whether the engine was cold.

| # | Fault | How | Car(s) | Expected signature | Stop condition / safety |
|---|---|---|---|---|---|
| 1 | Vacuum leak | Disconnect a small vacuum hose (PCV or brake-booster-adjacent line); leave others intact | Both | STFT/LTFT strongly positive at idle, normalizing under load; P0171 possible; rough idle | Do not disconnect the brake booster line itself while driving. Idle plus a short low-speed loop only. |
| 2 | MAF unplugged | Unplug the MAF connector, engine off, then start | Both | P0101/P0102; ECU falls back to speed-density; fuel trims odd; MAF reading zero or fixed | Short drive; some cars go into limp. Restore before any highway. |
| 3 | Single-cylinder misfire | Unplug one coil connector at idle | Chrysler only | P030x, misfire counts (Mode 06) if supported; RPM roughness; STFT swings | **Seconds, not minutes.** Unburned fuel reaches the catalytic converter. Idle only, then reconnect and clear. |
| 4 | Coolant temp sensor unplugged | Unplug ECT sensor, engine off, then start | Both | P0117/P0118; default coolant value (often −40 or 90 °C); rich cold-start behavior; fan may run | Short idle session only; the ECU may run the fan constantly. |
| 5 | Upstream O2 sensor unplugged | Unplug bank 1 sensor 1 | Chrysler only | P0131/P0134 family; open loop; LTFT frozen | Short session; stays in open loop, so fuel economy is poor but safe. |
| 6 | EVAP leak | Loosen or remove the gas cap; drive normally for several days | Chrysler only | P0455/P0456; slow; needs EVAP monitor to complete | No safety issue; calendar cost. Start early in Phase 1. |

Not done: anything requiring removal of fuel, ignition, or emissions hardware beyond a connector; anything on the EV; anything while a passenger is in the car; anything that would leave the car undrivable overnight.

Each fault gets, at minimum: the PPI-style read before and after, a drive log with the anchor pressed when the symptom is felt, and a label file. The Elantra does faults 1, 2, and 4 only.

## What the eval cannot claim

Nine fault cases on two cars, plus baselines, is a small set. The report shows every case. It can show that the engine is confidently wrong on a type of fault; it cannot support an accuracy percentage as a product claim. If this ever ships to other people, the honest label is "tested on N cases from two cars, listed here."
