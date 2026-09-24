"""Offline checks for targeted.py (spec T2.3b, Verification "Here"). Fake BLE client; no bleak, no car."""

import asyncio
import hashlib
import json
import os
import time

import discover
import go
import pytest
import targeted
from spike import Recorder
from test_discover import FORBIDDEN, FakeClient, read, replay_ok, txs

D = os.path.join(go.REPO, "fixtures", "recordings", "chevrolet-equinox-ev-2024", "2026-09-23-discovery.jsonl")
D_SHA256 = "520fc8fba7dd2453474a8471c22dd50dfb946c360cbde46d5d3f1a648e92cc53"
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
    assert data["source"]["sha256"] == D_SHA256
    for bad in ([["CB", "2979", 1], ["CB", "2979", 2]], [["28", "2000", 1]], [["17", "F190", 1]]):
        path = tmp_path / "bad.json"
        path.write_text(json.dumps({**data, "rotate": bad}), encoding="utf-8")
        with pytest.raises(ValueError):
            targeted.load_watch_list(str(path))


def test_watch_list_cites_recording() -> None:
    if not os.path.exists(D):
        pytest.skip("NOT RUN: gitignored recording not on disk")
    with open(D, "rb") as f:
        assert hashlib.sha256(f.read()).hexdigest() == D_SHA256
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


class Presses:
    """Stands in for the stdin queue; watch_targeted asks once per cycle. Per state: one early Enter (after
    cycle 1, before a full rotation; in the charging state after cycle 4, rotation done but before CHARGE_MIN_S),
    then Enter from cycle 4 on, and in the charging state only once 1.5 * CHARGE_MIN_S has passed."""

    def __init__(self) -> None:
        self.state, self.cycle, self.entered, self.early = 0, 0, 0.0, False

    def empty(self) -> bool:
        self.cycle += 1
        charging = discover.STATES[self.state] == targeted.CHARGE_STATE
        if self.cycle == 1:
            self.entered = time.monotonic()
        if self.cycle == (4 if charging else 1):
            self.early = True
            return False
        return self.cycle < 4 or (charging and time.monotonic() - self.entered < 1.5 * targeted.CHARGE_MIN_S)

    def get_nowait(self) -> str:
        if self.early:
            self.early = False
        else:
            self.state, self.cycle = self.state + 1, 0
        return "\n"


def test_fake_run(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(targeted, "ROTATE_S", 0)
    monkeypatch.setattr(targeted, "CHARGE_MIN_S", 0.2)
    core, rotate = [("CB", "27C6"), ("CB", "2AF5")], [("CB", "2B43"), ("17", "2000"), ("17", "2001")]
    path = tmp_path / "rec.jsonl"

    async def run() -> None:
        rec = Recorder(str(path))
        elm = discover.Elm(FakeClient(), "w", "n", True, rec)
        await elm.start()
        await discover.sweep(elm, rec)
        await targeted.watch_targeted(elm, rec, core, rotate, Presses())

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
    ignored = [x["state"] for x in lines if x.get("note") == "early mark ignored"]
    assert ignored == list(discover.STATES)  # one per state: before a full rotation / before CHARGE_MIN_S
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
    t = {x["state"]: x["t"] for x in lines if "state" in x and "note" not in x}
    assert lines[-1]["phase"] == "end"
    assert t["unplugged"] - t[targeted.CHARGE_STATE] >= targeted.CHARGE_MIN_S - 0.001  # t is rounded to ms
    assert replay_ok(lines, strict=True)
