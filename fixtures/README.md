# Fixtures

This directory holds immutable ELM327 recordings and hand-written synthetic
fixtures. The implemented recording parser is in
[`packages/obd-core/src/recording/format.ts`](../packages/obd-core/src/recording/format.ts),
and replay behavior is in
[`packages/obd-core/src/transport/replay.ts`](../packages/obd-core/src/transport/replay.ts).
See [the recording format in the architecture](../docs/ARCHITECTURE.md) for the
repository-level format.

## Directory and tracked inventory

Real committed recordings use
`recordings/<car>/<date>-<slug>.redacted.jsonl`. A labeled session may later
have a sibling `.label.json`; Phase 2 charge-session logs use the sibling
`.log.jsonl` name. Hand-written recordings use `synthetic/<slug>.jsonl` and
may later have a companion `.label.json`.

At this baseline, the tracked real recordings are:

- `recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.redacted.jsonl`
- `recordings/chevrolet-equinox-ev-2024/2026-09-22-spike-2.redacted.jsonl`
- `recordings/chevrolet-equinox-ev-2024/2026-09-24-phone-console.redacted.jsonl`

They are protocol captures, not labeled healthy baseline fixtures.

The tracked synthetic recordings are:

- `synthetic/elm-framing.jsonl`
- `synthetic/session-branches.jsonl`
- `synthetic/standard-decoding.jsonl`
- `synthetic/codes-cleared.jsonl`
- `synthetic/codes-permanent.jsonl`
- `synthetic/codes-stored.jsonl`
- `synthetic/codes-conflict.jsonl`

The four `codes-*` fixtures each drive one T0.7 "recently cleared" branch
(indicated, indicated strong, not indicated, unknown because the checks
disagree; `docs/specs/T0.7-codes-report.md`).

Each of these ten recordings has a companion `.replay-label.json` for observed
protocol outcomes. None has a `.label.json` health-session companion.

## Protocol replay observation labels

The ten companion files are the three real recording stems above and the seven
synthetic stems above, each ending in `.replay-label.json`. For a real input,
the companion removes `.redacted.jsonl` before adding that suffix; for a
synthetic input, it removes `.jsonl`.

Each test-only label has `kind: "protocol-replay"`, the repository-relative
`recording` path, its `recording_sha256`, a `synthetic` flag, a nonempty
`observations` array, the exact replay `summary`, and a short `notes` evidence
limit. An observation identifies a one-based `tx_line`, its `command` without
the final carriage return, the replay heading's `outcome` after `->`, and
selected exact `decoded` lines (or an empty array). The E2E test checks these
against the immutable input and public replay output. Replay summaries can be
regenerated with `pnpm replay <recording.jsonl>`.

These labels describe protocol responses only. A supported PID, readiness
state, empty DTC list, or dash-displayed SOC does not establish battery
condition or capacity. The future `*.label.json` files in [docs/EVAL.md](../docs/EVAL.md)
are separate health-session labels with condition and, when justified, a
reference measurement. None of the ten protocol snapshots supplies one.

## Implemented recording JSONL contract

A recording is one JSON object per line. The parser currently implements this
discriminated union:

- Every line has a non-negative numeric `t`, measured in seconds, and `dir`
  equal to `tx`, `rx`, or `meta`.
- A `tx` or `rx` line requires `data`. Every character in `data` must be an
  ISO-8859-1 byte value, from `U+0000` through `U+00FF`.
- A `meta` line requires only `t` and `dir`; it retains free-form additional
  keys.

This is parser enforcement, separate from capture conventions. The parser does
not require timestamps to be non-decreasing, a first `meta` line, command
terminators, or a final ELM prompt. Captures conventionally include `\r` in
transmitted commands and retain received notification chunks. Protocol
completion at `>` is defined by the ELM327 session behavior, not by the
recording parser.

For example, this illustrative fragment follows the architectural format:

```jsonl
{"t": 0.000, "dir": "tx", "data": "ATZ\r"}
{"t": 1.012, "dir": "rx", "data": "\r\rELM327 v1.5\r\r>"}
```

`ReplayTransport` skips `meta` lines. Each caller write must exactly match the
next `tx.data`; it then emits intervening `rx.data` values in recorded order,
preserving their chunk boundaries. Replay does not use `t` to add delays.

## Current metadata conventions

Metadata is descriptive and open-ended because the implemented `meta` schema
is loose. The following are current examples, not required fields for every
recording.

The two real capture files currently put `car`, `dongle`, `note`, `script`,
`bleak`, `platform`, `write_char`, `notify_char`, and `mtu` on their capture
meta line. Their trailing ADR-017 provenance marker currently has
`redacted: "vin-serial"`, `source`, `source_sha256`, `script`,
`script_version`, and `masked_messages`.

The seven synthetic fixtures currently begin with metadata containing
`synthetic: true`, `car: "none"`, `dongle: "none"`, and a `note` explaining
why the data is hand-written and where its sources live. Future synthetic
fixtures should provide equivalent provenance without copying those existing
notes verbatim.

## ADR-017 redaction and immutability workflow

Raw originals stay local, gitignored, and untouched. Recordings are never
hand-edited. Run the ADR-017 script on an original:

```sh
uv run tools/spike/redact_vin.py <recording.jsonl>
```

It writes a sibling `<stem>.redacted.jsonl` and will not overwrite an existing
output. The generated copy retains VIN characters 1–11, masks characters 12–17
in place with ASCII `0`, preserves original line numbers, and appends the
provenance marker described above. Only script-produced `*.redacted.jsonl`
copies are committed under `fixtures/recordings/`.

[ADR-017](../docs/DECISIONS.md#adr-017-committed-recordings-mask-the-vin-serial-originals-stay-local-2026-09-23)
and [`tools/spike/redact_vin.py`](../tools/spike/redact_vin.py) define the
redaction workflow. The script refuses unsafe input or output. Resolve a
failure without hand-editing either the original or the generated copy.

## Future session label schema — planned and not implemented

The following companion-label shape comes from [docs/EVAL.md](../docs/EVAL.md).
It is planned for zod ownership in `obd-eval`; it is not implemented or
validated at this baseline.

One label is planned per labeled session, with:

- `car`
- `session`: `charge` or `snapshot`
- `condition`: `healthy` or `fault`
- optional `reference`: `method` (`integrated-energy` or `charger-kwh`),
  `capacity_kwh`, `soc_start`, and `soc_end`
- optional `fault`: `id`, `detail`, and `injected_at_s`
- `notes`
- boolean `synthetic`

`reference` is present only for a charge session with enough SOC change to
compute one. `fault` is only for injected synthetic faults. Values in
`docs/EVAL.md` are placeholders for the shape, not measurements or labels for
any current fixture.

Synthetic identification has two layers. Current hand-written JSONL fixtures
live under `fixtures/synthetic/` and carry `synthetic: true` in recording
metadata. When companion eval labels are added, those labels also carry
`synthetic: true`. Real and synthetic results remain separate.

## Adding fixtures safely

- Capture real sessions; do not hand-edit them.
- Retain the raw original locally, then run ADR-017 redaction.
- Commit only the generated redacted copy for a real recording.
- Put authored or injected data under `fixtures/synthetic/` with
  `synthetic: true`.
- Add a companion label only from actual evidence and according to the future
  implemented schema; cite its source and provenance.
- Replay through the public entry point required by the task that introduces
  the fixture.

Every real vehicle claim needs a recording path. Synthetic data cannot satisfy
a real-data baseline or table.
