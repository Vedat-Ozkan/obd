"""Offline checks for targeted.py (spec T2.3b, Verification "Here"). Fake BLE client; no bleak, no car."""

import asyncio
import json
import os

import discover
import go
import pytest
import targeted
from spike import Recorder
from test_discover import FORBIDDEN, FakeClient, read, replay_ok, txs

D = os.path.join(go.REPO, "fixtures", "recordings", "chevrolet-equinox-ev-2024", "2026-09-23-discovery.jsonl")
CORE = ["2979", "297D", "2982", "27CD", "27CE", "27AF", "276D", "2AF7", "2AF5",
        *(f"2AE{i}" for i in range(1, 8)), "2B43"]


def is_f1xx(did: str) -> bool:
    return "F180" <= did <= "F1FF"


def is_vin(did: str) -> bool:
    return f"22 {did}" in discover._VIN


def test_watch_list_shape(tmp_path) -> None:
    core, rotate = targeted.load_watch_list()
    assert core == [("CB", d) for d in CORE]
    assert len(rotate) == 838
    cb = [d for m, d in rotate if m == "CB"]
    assert [m for m, _ in rotate] == ["CB"] * len(cb) + ["17"] * (len(rotate) - len(cb))
    assert cb == sorted(cb) and [d for m, d in rotate if m == "17"] == sorted(d for m, d in rotate if m == "17")
    assert len(set(rotate)) == len(rotate) and not set(rotate) & set(core)
    assert not [d for _, d in rotate if is_f1xx(d) or d == "2E8E"]
    for _, did in core + rotate:
        discover.check_allowed(f"22 {did}")
    with open(targeted.WATCH_LIST, encoding="utf-8") as f:
        data = json.load(f)
    for bad in ([["CB", "2979", 1], ["CB", "2979", 2]], [["28", "2000", 1]], [["17", "F190", 1]]):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps({**data, "rotate": bad}), encoding="utf-8")
        with pytest.raises(ValueError):
            targeted.load_watch_list(str(path))


def test_watch_list_cites_recording() -> None:
    if not os.path.exists(D):
        pytest.skip("NOT RUN: gitignored recording not on disk")
    lines = read(D)
    start = next(i for i, x in enumerate(lines) if x.get("phase") == "B")
    end = next(i for i, x in enumerate(lines) if "positives" in x)
    # Every phase-B positive: (module, did) -> (1-based tx line, single frame), module = last ATSH before it.
    found, module = {}, None
    for i in range(start, end):
        data = lines[i].get("data", "") if lines[i]["dir"] == "tx" else ""
        if data.startswith("ATSH DA"):
            module = data[7:9]
        if data.startswith("22 "):
            nxt = next((j for j in range(i + 1, len(lines)) if lines[j]["dir"] == "tx"), len(lines))
            reply = "".join(x["data"] for x in lines[i + 1:nxt] if x["dir"] == "rx")
            did = int(data[3:7], 16)
            if discover.classify_22(reply, module, did) == "positive":
                found[(module, data[3:7])] = (i + 1, discover._single(reply, module, did))
    positives = lines[end]["positives"]
    assert sorted(found) == sorted((m, d) for m, v in positives.items() for d in v)
    watched = set(lines[end + 1]["watch"]["CB"])  # T2.3a phase-C watch meta
    with open(targeted.WATCH_LIST, encoding="utf-8") as f:
        data = json.load(f)
    # Selection rule (spec Selection rule + Decisions 1 and 2), applied to line 49772 positives.
    # VIN-bearing DIDs are excluded by the allowlist (X-2026-09-23-vin-redaction Decision 3).
    keep = [d for d in positives["CB"] if d not in CORE and d != "2E8E" and not is_f1xx(d) and not is_vin(d)]
    rotate = [("CB", d) for d in sorted(d for d in keep if not found[("CB", d)][1] or d not in watched)]
    rotate += [("17", d) for d in positives["17"] if not is_f1xx(d) and not is_vin(d)]
    assert data["core"] == [["CB", d, found[("CB", d)][0]] for d in CORE]
    assert data["rotate"] == [[m, d, found[(m, d)][0]] for m, d in rotate]


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        return self.now


class CapturingRecorder(Recorder):
    def __init__(self, path: str) -> None:
        super().__init__(path)
        self.states: list[str] = []

    def meta(self, **fields: object) -> None:
        super().meta(**fields)
        if "state" in fields and "note" not in fields:
            self.states.append(str(fields["state"]))


class QueuedPressClient(FakeClient):
    """Queues presses during ATRV writes, before that cycle reaches its input boundary."""

    def __init__(self, clock: Clock, marks: "asyncio.Queue[str]") -> None:
        super().__init__()
        self.clock, self.marks = clock, marks
        self.rec: CapturingRecorder | None = None
        self.cycles: dict[str, int] = {}
        self.fresh_states: list[str] = []
        self.charging_elapsed_at_fresh: float | None = None

    async def write_gatt_char(self, char: object, data: bytes, response: bool) -> None:
        if bytes(data) == b"ATRV\r" and self.rec is not None and self.rec.states:
            state = self.rec.states[-1]
            cycle = self.cycles[state] = self.cycles.get(state, 0) + 1
            # Charging needs six cycles to reach five logical minutes, but rotation is complete after three.
            # This makes the charging-time gate independently observable.
            self.clock.now += 50 if state == targeted.CHARGE_STATE else 100
            if (state == discover.STATES[0] and cycle == 1) or (state == targeted.CHARGE_STATE and cycle == 1):
                for _ in range(3):
                    self.marks.put_nowait("\n")
            if state == discover.STATES[0] and cycle == 3:  # final ineligible rotation cycle
                self.marks.put_nowait("\n")
            if state == targeted.CHARGE_STATE and cycle == 4:
                # Rotation ended in cycle 3; this must still be ignored until the five-minute gate ends.
                self.marks.put_nowait("\n")
            fresh_cycle = 5 if state == discover.STATES[0] else 8 if state == targeted.CHARGE_STATE else 4
            if cycle == fresh_cycle:
                self.fresh_states.append(state)
                if state == targeted.CHARGE_STATE:
                    self.charging_elapsed_at_fresh = self.clock.now
                # The second mark crosses a state boundary and must be drained while the next state is ineligible.
                for _ in range(2 if state == discover.STATES[0] else 1):
                    self.marks.put_nowait("\n")
        await super().write_gatt_char(char, data, response)


class SurplusPressClient(FakeClient):
    """Uses a one-entry rotation so an inherited armed flag would accept a surplus mark immediately."""

    def __init__(self, clock: Clock, marks: "asyncio.Queue[str]") -> None:
        super().__init__()
        self.clock, self.marks = clock, marks
        self.rec: CapturingRecorder | None = None
        self.cycles: dict[str, int] = {}

    async def write_gatt_char(self, char: object, data: bytes, response: bool) -> None:
        if bytes(data) == b"ATRV\r" and self.rec is not None and self.rec.states:
            state = self.rec.states[-1]
            cycle = self.cycles[state] = self.cycles.get(state, 0) + 1
            self.clock.now += 1
            if cycle == 2:
                for _ in range(2 if state == discover.STATES[0] else 1):
                    self.marks.put_nowait("\n")
        await super().write_gatt_char(char, data, response)


def test_surplus_accepted_mark_is_drained_by_new_state(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(targeted, "ROTATE_S", 0)
    monkeypatch.setattr(targeted, "CHARGE_MIN_S", 0)
    clock, marks = Clock(), asyncio.Queue[str]()
    client = SurplusPressClient(clock, marks)

    async def run() -> None:
        rec = CapturingRecorder(str(tmp_path / "surplus.jsonl"))
        client.rec = rec
        elm = discover.Elm(client, "w", "n", True, rec)
        await elm.start()
        await targeted.watch_targeted(elm, rec, [("CB", "27C6")], [("CB", "2B43")], marks)

    monkeypatch.setattr(targeted.time, "monotonic", clock.monotonic)
    asyncio.run(run())
    assert client.cycles == {state: 2 for state in discover.STATES}


def test_fake_run(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(targeted, "ROTATE_S", 0)
    monkeypatch.setattr(targeted, "CHARGE_MIN_S", 300)
    core, rotate = [("CB", "27C6"), ("CB", "2AF5")], [("CB", "2B43"), ("17", "2000"), ("17", "2001")]
    path = tmp_path / "rec.jsonl"
    artifact = "/tmp/x-2026-09-27-targeted-early-enter.json"
    clock, marks = Clock(), asyncio.Queue[str]()
    client = QueuedPressClient(clock, marks)

    async def run() -> None:
        rec = CapturingRecorder(str(path))
        client.rec = rec
        elm = discover.Elm(client, "w", "n", True, rec)
        await elm.start()
        await discover.sweep(elm, rec)
        await targeted.watch_targeted(elm, rec, core, rotate, marks)

    monkeypatch.setattr(targeted.time, "monotonic", clock.monotonic)
    asyncio.run(run())
    lines = read(path)
    sent = txs(lines)
    for cmd in sent:
        discover.check_allowed(cmd)
    assert "0902" not in sent and "22 F190" not in sent
    assert not [c for c in sent if c.startswith(FORBIDDEN)]
    phases = [x["phase"] for x in lines if "phase" in x]
    assert [p for n, p in enumerate(phases) if n == 0 or phases[n - 1] != p] == ["A", "C", "end"]
    assert [x["state"] for x in lines if "state" in x and "note" not in x] == list(discover.STATES)
    assert client.cycles[discover.STATES[0]] == 5  # boundary backlog and an empty eligible cycle precede fresh input
    assert client.cycles[discover.STATES[1]] == 4  # surplus accepted with state 0 did not advance state 1
    assert client.cycles[targeted.CHARGE_STATE] == 8  # rotation completes before the charging time gate
    ignored = [x["state"] for x in lines if x.get("note") == "early mark ignored"]
    assert ignored == [discover.STATES[0], discover.STATES[0], discover.STATES[1], targeted.CHARGE_STATE,
                       targeted.CHARGE_STATE]
    assert client.fresh_states == list(discover.STATES)
    assert client.charging_elapsed_at_fresh is not None
    c = next(i for i, x in enumerate(lines) if x.get("phase") == "C")
    watch = txs(lines[c:])
    starts = [i for i, x in enumerate(watch) if x == "ATRV"]
    cycles = [watch[i:j] for i, j in zip(starts, [*starts[1:], len(watch)], strict=True)]
    polled = []
    for cyc in cycles:
        dids = [x[3:] for x in cyc if x.startswith("22 ")]
        assert cyc[1] == "ATSH DACBF1" and dids[:2] == ["27C6", "2AF5"]
        assert len(dids) == 3  # ROTATE_S = 0: exactly one rotating DID per cycle
        polled.append(dids[2])
    assert polled == [rotate[i % 3][1] for i in range(len(cycles))]  # pointer wraps, persists across states
    assert [len(c) for c in cycles][:4] == [7, 10, 10, 7]  # a 17 entry needs its select; CB re-selected each cycle
    assert lines[-1]["phase"] == "end"
    assert client.charging_elapsed_at_fresh >= targeted.CHARGE_MIN_S
    assert replay_ok(lines, strict=True)
    expected = {
        "synthetic": True,
        "states": list(discover.STATES),
        "early_batch_states": [discover.STATES[0], discover.STATES[1], targeted.CHARGE_STATE],
        "advanced_without_fresh_press": False,
        "fresh_presses_accepted": 5,
        "charging_minimum_met": True,
        "strict_replay": True,
        "ended": True,
    }
    assert expected == {
        "synthetic": True,
        "states": [x["state"] for x in lines if "state" in x and "note" not in x],
        "early_batch_states": list(dict.fromkeys(ignored)),
        "advanced_without_fresh_press": any(
            client.cycles[state] < (5 if state == discover.STATES[0] else 8 if state == targeted.CHARGE_STATE else 4)
            for state in discover.STATES
        ),
        "fresh_presses_accepted": len(client.fresh_states),
        "charging_minimum_met": client.charging_elapsed_at_fresh >= targeted.CHARGE_MIN_S,
        "strict_replay": replay_ok(lines, strict=True),
        "ended": lines[-1]["phase"] == "end",
    }
    with open(artifact, "w", encoding="utf-8", newline="\n") as f:
        json.dump(expected, f, sort_keys=True)
        f.write("\n")
