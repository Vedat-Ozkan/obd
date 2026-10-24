# Owner queue

Every open item that only the owner can do: car, phone, builds, accounts, pushes, and decisions. Built 2026-10-23 at `4919240` from the `docs/task-runs/` records. The source record holds the details; this file is the index. When an item is done, record the result in its source record and delete the row here. New owner items go here as well as in their record.

`rec/` = `docs/task-runs/`.

## Desk decisions (no hardware)

| # | Item | Source | Unblocks |
|---|---|---|---|
| D1 | Push main to origin; hosted CI has not seen `1c74db4..4919240` | `git status -sb` | hosted CI |
| D2 | T2.3: keep or drop the "agent proposal precision against the owner's verdicts" requirement; discovery ran as scripted laptop sessions (T2.3a/T2.3b), not agent-driven | `docs/PLAN.md` T2.3 row | T2.3 |
| D3 | Approve redacting the local `2026-09-28-phone-console-2.jsonl` (likely the 19-command codes scan behind the committed `2026-09-28-codes-report.md`), then replay and reconcile T0.9 Stage B at the desk | `rec/T0.9.md:8`, `rec/T0.9b.md:9` | T0.9 |
| D4 | Fill `docs/spike-2026-09.md` (still the blank worksheet, `Decision: NOT DECIDED`) from the committed redacted spike recordings, so T0.2's Gate A line exists | `rec/T0.2.md:5`, `docs/spike-2026-09.md:123` | T0.2 |
| D5 | T2.7: may it tick on software evidence plus the manual run; confirm no scan-time ownership tag | `rec/T2.7.md:8` | T2.7 |
| D6 | Choose the privacy-note contact email; review consent and privacy wording | `rec/T2.9.md:44, 65` | T2.9 Stage E |
| D7 | Go/no-go on the paid T2.11b Stage 2 four-arm eval (stop rules US$0.05/0.15/0.05/0.25); its precondition, T2.10's paid phone check, passed 2026-09-29 | `rec/T2.11.md:13, 22` | T2.11, BM5 |
| D8 | Answer the four T2.11c outline questions (car removal with chats, session ids, history size, model on phone) | `rec/T2.11.md:13` | T2.11c |
| D9 | Thresholds task (cell balance, 12 V) and the paid summary comparison: start or keep paused | `rec/X-2026-09-29-explanatory-summary.md:13`, `rec/X-2026-09-29-summary-wording-polish.md:11` | summary "Not rated" areas |
| D10 | T2.10 rewarded-ad path (ledger, signed callback, T2.10b/c2/d2, US$5-capped live eval): pursue or re-scope | `rec/T2.10.md:17` | T2.10 |
| D11 | Keep or drop the two unlinked 2026-10-23 audits, `docs/ACCESSIBILITY.md` and `docs/ANALYTICS.md` (untracked) | `git status` | — |

## Build first

| # | Item | Source | Unblocks |
|---|---|---|---|
| B1 | EAS dev client from current main, then the phone-only parts of the redesign matrix (Stage A (a)–(f), B 2–6, C1–C4) and the persistent-dongle checks A1–A10, B1–B3 | `rec/X-2026-09-28-app-redesign.md:148-163`, `rec/X-2026-09-28-persistent-dongle.md:11` | every phone item below |

## One parked session at the car (Ready/Park, phone, laptop relay up)

One fresh diagnosis scan covers P4, P5, P6 and the T0.9b codes leg.

| # | Item | Source | Unblocks |
|---|---|---|---|
| P1 | `pnpm hil:smoke` through the phone relay, redact, replay (the 2026-09-28 relay-smoke file predates the encoding fix `f58887d` and is not evidence) | `rec/T0.6.md:20, 31`, `rec/X-2026-09-29-relay-recording-encoding.md:13` | T0.6 |
| P2 | Same relay session: 2E refusal, 04 Cancel denial, mid-command disconnect, broker URL pasted in the app | `rec/T0.6.md:31` | T0.6 |
| P3 | T0.9b phone checklist steps 1–9, or note which the 2026-09-28 session covered | `rec/T0.9b.md:9` | T0.9 |
| P4 | T2.6d checklist: fresh scan, force-stop and reopen, second same-model garage entry isolation | `rec/T2.6.md:20-25` | T2.6 |
| P5 | The `checked` own-car flow | `rec/T2.7.md:9, 11` | T2.7 |
| P6 | Upgraded parked scan, reopen, redacted export | `rec/T2.14.md:11` | T2.14; T2.15 real-recording coverage |
| P7 | T2.16 Stage B: Developer tools module DTC capture (`19 02 FF`, five Mode 09 responders), redact | `rec/T2.16.md:17-18` | T2.16 Stages B, C |
| P8 | Unplug-reminder screenshot (optionally a rested 12 V reading) | `rec/T2.5.md:7, 9` | T2.5 |
| P9 | T2.8a picker UI and native persistence check | `rec/T2.8.md:7, 9` | T2.8 (partial) |
| P10 | T2.9 Stage D phone steps 1–6 against `wrangler dev --local` | `docs/specs/T2.9-beta-data-upload.md:580-592`, `rec/T2.9.md:229` | T2.9 |
| P11 | Only if the dash SOC is far from 70 %, and with the laptop: `uv run tools/spike/go.py` capture with a dash note | `rec/T2.2.md:8` | T2.2 |

## One 10-minute drive

| # | Item | Source | Unblocks |
|---|---|---|---|
| R1 | T2.13 Stage B confirming drive: Developer tools > Record test drive; pass = `checked`, no flag, Skew bracket median < 1.843 s | `rec/T2.13.md:11, 13` | T2.13 Stage C, T2.18 |

## One overnight charge

| # | Item | Source | Unblocks |
|---|---|---|---|
| C1 | T2.4 B2 driveway check the same evening; watch the rest/no-current misattribution and the BleManager remount race | `rec/T2.4.md:31, 74-75` | T2.4 Stage C |
| C2 | One real multi-hour charge log, screen off, rested windows at both ends (the 2026-09-28 charge-log files are car-off failures) | `rec/T2.4.md:32, 75` | T2.4, T2.6 capacity gate, T0.10, T2.8, BM1+ |

## Accounts and outward steps

| # | Item | Source | Unblocks |
|---|---|---|---|
| A1 | T2.9 owner steps 2–8 (Cloudflare, R2 `obd-beta`, lifecycle, `wrangler deploy`, token, logs off, version bump) and the Stage E deployed run | `rec/T2.9.md:65`, `docs/specs/T2.9-beta-data-upload.md:594-600, 680-696` | T2.9, beta |
| A2 | Review and open the upstream OBDb PR | `rec/T2.2.md:8` | T2.2 |
| A3 | Recruit beta testers; promote a second Ultium model from a real beta recording (after A1, D6) | `docs/specs/T2.9-beta-data-upload.md:692` | T2.8 last gate, Phase 2 milestone |

## Not startable yet

- T2.17 cold-soak `2AF1` reading: needs a spec first.
- T2.18 guided buyer flow: needs T2.13 Stage C.
