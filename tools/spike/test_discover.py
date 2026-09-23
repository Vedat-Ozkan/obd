"""Offline checks for discover.py (spec T2.3a, Verification "Here"). Fake BLE client; no bleak, no car."""

import asyncio
import json
import os

import discover
import go
import pytest
from spike import Recorder

# Reply texts from fixtures/recordings/chevrolet-equinox-ev-2024/2026-09-22-spike.jsonl (S1), joined rx
# chunks after the tx on the cited line.
S1_0100 = ("SEARCHING...\r18DAF14506410080000001\r18DAF1CB06410080000001\r18DAF14006410080000001\r"
           "18DAF128064100BFFFF997\r18DAF11706410080080013\r\r>")  # S1 line 24
S1_0120 = ("18DAF14506412000000001\r18DAF14006412000000001\r18DAF11706412080018001\r"
           "18DAF128064120801FE019\r18DAF1CB06412000000001\r\r>")  # S1 line 42
S1_0140 = ("18DAF14506414040000000\r18DAF1CB06414040000000\r18DAF14006414040000000\r"
           "18DAF128064140FED04001\r18DAF11706414040000001\r\r>")  # S1 line 52
S1_27C6 = "18DAF1CB056227C6B236\r\r>"  # S1 line 152
S1_2AF5 = "18DAF1CB100D622AF5998199\r18DAF1CB2177999509022505\r\r>"  # S1 line 156
S1_2B43 = ("18DAF1CB101D622B43B200B2\r18DAF1CB21B2B2B2B3B2B2B2\r18DAF1CB22B2B20000000000\r"
           "18DAF1CB2300000000000000\r18DAF1CB2400000000000000\r\r>")  # S1 line 162
# Synthetic below: 0160 with no next-range bit, one-module Mode 01 PID replies, 0900 flagging 02/04/0A.
SYN_0160 = "18DAF11706416000000000\r18DAF12806416000000000\r\r>"

# Union of flagged non-bitmap PIDs from the S1 0100/0120/0140 bitmaps above (47, per the spec Sources).
S1_MODE01_UNION = ["01", "03", "04", "05", "06", "07", "08", "09", "0A", "0B", "0C", "0D", "0E", "0F", "10", "11",
                   "12", "13", "14", "15", "18", "19", "1C", "1E", "1F", "21", "2C", "2D", "2E", "2F", "30", "31",
                   "32", "33", "3C", "3D", "41", "42", "43", "44", "45", "46", "47", "49", "4A", "4C", "52"]
FORBIDDEN = ("04", "10", "11", "14", "27", "28", "2E", "2F", "31", "3E")
SMALL_SCAN = [("CB", 0x27C4, 0x27C8), ("CB", 0x2AF5, 0x2AF5), ("CB", 0x2B43, 0x2B43),
              ("17", 0x2000, 0x2002), ("45", 0xF18F, 0xF191)]


class FakeCar:
    """Scripted ELM327 + Equinox replies, keyed on the command and the current ATSH module."""

    def __init__(self) -> None:
        self.module = ""

    def __call__(self, cmd: str) -> str:
        fixed = {"ATZ": "\r\rELM327 v1.5\r\r>", "ATDPN": "A0\r\r>", "ATRV": "12.7V\r\r>",
                 "0100": S1_0100, "0120": S1_0120, "0140": S1_0140, "0160": SYN_0160}
        if cmd in fixed:
            return fixed[cmd]
        if cmd.startswith("ATSH DA"):
            self.module = cmd[7:9]
        if cmd.startswith("AT"):
            return "OK\r\r>"
        if cmd.startswith("01"):
            return f"18DAF1CB0341{cmd[2:]}00\r\r>"
        if cmd == "0900":
            return f"18DAF1{self.module}06490050400000\r\r>"
        s1 = {"22 27C6": S1_27C6, "22 2AF5": S1_2AF5, "22 2B43": S1_2B43}
        if self.module == "CB" and cmd in s1:
            return s1[cmd]
        if cmd.startswith("22") and self.module in ("CB", "17"):
            return f"18DAF1{self.module}037F2231\r\r>"
        return "NO DATA\r\r>"


class FakeClient:
    def __init__(self, silent: tuple[str, ...] = (), reply_during_write: bool = False,
                 raise_on: tuple[str, ...] = ()) -> None:
        self.car, self.silent, self.pending, self.writes, self.cb = FakeCar(), silent, b"", [], None
        # reply_during_write: the whole reply is delivered before the last write_gatt_char returns (D line 49775).
        self.reply_during_write, self.raise_on, self.replies = reply_during_write, raise_on, []

    async def start_notify(self, char: object, cb: object) -> None:
        self.cb = cb

    async def stop_notify(self, char: object) -> None:
        self.cb = None

    async def write_gatt_char(self, char: object, data: bytes, response: bool) -> None:
        self.writes.append(bytes(data))
        self.pending += bytes(data)
        if not self.pending.endswith(b"\r"):
            return
        cmd, self.pending = self.pending[:-1].decode("iso-8859-1"), b""
        if cmd in self.raise_on:
            raise OSError("synthetic BLE write failure")
        if cmd in self.silent:
            return
        reply = self.car(cmd).encode("iso-8859-1")
        self.replies.append((cmd, reply.decode("iso-8859-1")))
        if self.reply_during_write:
            self.cb(None, bytearray(reply))
            return
        loop = asyncio.get_running_loop()
        loop.call_soon(self.cb, None, bytearray(reply[: len(reply) // 2]))
        loop.call_soon(self.cb, None, bytearray(reply[len(reply) // 2:]))


def read(path) -> list[dict]:
    return [json.loads(line) for line in open(path, encoding="utf-8")]


def marks_full() -> "asyncio.Queue[str]":
    q: asyncio.Queue[str] = asyncio.Queue()
    for _ in discover.STATES:
        q.put_nowait("\n")
    return q


async def full_run(path, client: FakeClient) -> None:
    rec = Recorder(str(path))
    elm = discover.Elm(client, "w", "n", True, rec)
    await elm.start()
    await discover.sweep(elm, rec)
    await discover.watch(elm, rec, await discover.scan(elm, rec), marks_full())


def replay_ok(lines: list[dict], strict: bool) -> bool:
    """Python mirror of packages/obd-core/test/recordings.test.ts: each tx gets a '>' or a timeout note."""
    for i, line in enumerate(lines):
        if line["dir"] != "tx":
            continue
        rest = []
        for nxt in lines[i + 1:]:
            if nxt["dir"] == "tx":
                break
            rest.append(nxt)
        prompt = any(x["dir"] == "rx" and ">" in x["data"] for x in rest)
        timed = any(x["dir"] == "meta" and x.get("note", "").startswith("timeout waiting for '>'") for x in rest)
        if not (prompt or (timed and not strict)):
            return False
    return True


def txs(lines: list[dict]) -> list[str]:
    return [x["data"][:-1] for x in lines if x["dir"] == "tx"]


def phase_slice(lines: list[dict], start: str, end: str) -> list[dict]:
    i = next(n for n, x in enumerate(lines) if x.get("phase") == start)
    j = next(n for n, x in enumerate(lines) if x.get("phase") == end)
    return lines[i:j]


def test_check_allowed_accepts() -> None:
    for cmd in [*discover.ALLOWED_AT, "0100", "01C0", "0900", "090A", "22 27C6", "22 F18C"]:
        discover.check_allowed(cmd)


@pytest.mark.parametrize("cmd", [
    "04", "0902", "22 F190", "22F190", "2227C6", "22 27C6 2AF5", "10 03", "1003", "11 01", "14FF00",
    "27 01", "28 00", "2E 1234 00", "2F 1234 03", "31 01 1234", "3E 00", "3E80", "19 02 FF", "0100 ",
    "01 00", "010C0D", "atz", "ATMA", "ATSP6", "ATST 19", "ATAR", "ATSH DA1DF1", "ATSH DB33F1", "",
])
def test_check_allowed_refuses(cmd: str) -> None:
    with pytest.raises(ValueError):
        discover.check_allowed(cmd)


def test_refused_send_writes_nothing(tmp_path) -> None:
    client, path = FakeClient(), tmp_path / "rec.jsonl"
    elm = discover.Elm(client, "w", "n", True, Recorder(str(path)))
    with pytest.raises(ValueError):
        asyncio.run(elm.send("0902"))
    assert client.writes == []
    assert not [x for x in read(path) if x["dir"] == "tx"]


def test_bitmaps_from_s1() -> None:
    union: set[int] = set()
    for base, reply in ((0x00, S1_0100), (0x20, S1_0120), (0x40, S1_0140)):
        maps = discover.bitmap_replies(reply, 0x01, base)
        assert set(maps) == {"17", "28", "40", "45", "CB"}
        for bits in maps.values():
            union.update(p for p in discover.flagged(base, bits) if p % 0x20)
    assert [f"{p:02X}" for p in sorted(union)] == S1_MODE01_UNION
    assert len(union) == 47 and 0x42 in union and 0x46 in union
    maps = discover.bitmap_replies(S1_0140, 0x01, 0x40)
    assert {m for m, bits in maps.items() if 0x60 in discover.flagged(0x40, bits)} == {"17", "28"}
    assert discover.bitmap_replies("SEARCHING...\r18DAF1CB2300000000000000\r\r>", 0x01, 0x00) == {}


def test_classify_22() -> None:
    assert discover.classify_22(S1_27C6, "CB", 0x27C6) == "positive"
    assert discover.classify_22(S1_2AF5, "CB", 0x2AF5) == "positive"
    assert discover.classify_22(S1_2B43, "CB", 0x2B43) == "positive"
    assert discover.classify_22("NO DATA\r\r>", "CB", 0x2000) == "nodata"
    assert discover.classify_22("18DAF1CB037F2231\r\r>", "CB", 0x2000) == "negative"  # synthetic
    assert discover.classify_22(S1_27C6, "CB", 0x27C7) != "positive"  # late reply for another DID
    assert discover.classify_22(S1_27C6, "17", 0x27C6) != "positive"  # other header
    # synthetic: stray CF / response-pending line ahead of the real positive (lines split on "\r")
    assert discover.classify_22("18DAF1CB2300000000000000\r" + S1_27C6, "CB", 0x27C6) == "positive"
    assert discover.classify_22("18DAF1CB037F2278\r" + S1_27C6, "CB", 0x27C6) == "positive"
    assert discover._single("18DAF1CB037F2278\r" + S1_27C6, "CB", 0x27C6)


def test_full_fake_run(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(discover, "SCAN", SMALL_SCAN)
    path = tmp_path / "rec.jsonl"
    asyncio.run(full_run(path, FakeClient()))
    lines = read(path)
    sent = txs(lines)
    for cmd in sent:
        discover.check_allowed(cmd)
    assert "0902" not in sent and "22 F190" not in sent
    assert not [c for c in sent if c.startswith(FORBIDDEN)]
    assert [c for c in sent if c.startswith("01")] == ["0100", "0120", "0140", "0160",
                                                        *(f"01{p}" for p in S1_MODE01_UNION)]
    after_sp7 = txs(phase_slice(lines, "A", "B"))
    after_sp7 = after_sp7[after_sp7.index("ATSP7"):]
    expected = ["ATSP7", "ATCP 18"]
    for i, m in enumerate(discover.MODULES):
        expected += [f"ATSH DA{m}F1", f"ATCRA 18DAF1{m}", f"ATFCSH 18DA{m}F1"]
        expected += ["ATFCSD 300000", "ATFCSM 1"] if i == 0 else []
        expected += ["0900", "0904", "090A"]
    assert after_sp7 == expected
    phases = [x["phase"] for x in lines if "phase" in x]
    assert [p for n, p in enumerate(phases) if n == 0 or phases[n - 1] != p] == ["A", "B", "C", "end"]
    assert [x["state"] for x in lines if "state" in x] == list(discover.STATES)
    end_b = next(x for x in lines if "positives" in x)
    assert end_b["positives"]["CB"] == ["27C6", "2AF5", "2B43"] and end_b["stopped_early"] is False
    assert set(end_b["counts"]) == set(discover.MODULES)
    watched = set(txs(phase_slice(lines, "C", "end")))
    selects = {f"{a}{m}{b}" for m in ("CB", "17") for a, b in (("ATSH DA", "F1"), ("ATCRA 18DAF1", ""),
                                                                 ("ATFCSH 18DA", "F1"))}
    assert watched == {"ATRV", "22 27C6", "22 2AF5", "22 2B43"} | selects
    assert replay_ok(lines, strict=True)


def test_deadline(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(discover, "SCAN", SMALL_SCAN)
    monkeypatch.setattr(discover, "SCAN_BUDGET_S", 0)
    path = tmp_path / "rec.jsonl"
    asyncio.run(full_run(path, FakeClient()))
    lines = read(path)
    assert len([c for c in txs(phase_slice(lines, "B", "C")) if c.startswith("22")]) <= 1
    assert next(x for x in lines if "stopped_early" in x)["stopped_early"] is True
    watched = txs(phase_slice(lines, "C", "end"))
    assert watched and all(c == "ATRV" or c.startswith(("ATSH", "ATCRA", "ATFCSH")) for c in watched)
    assert "end" in [x.get("phase") for x in lines]


def test_interrupted_run_leaves_timeout_note(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(discover, "SCAN", SMALL_SCAN)
    path = tmp_path / "rec.jsonl"

    async def run() -> None:
        task = asyncio.create_task(full_run(path, FakeClient(silent=("22 27C6",))))
        while not os.path.exists(path) or "22 27C6\r" not in [x["data"] for x in read(path) if x["dir"] == "tx"]:
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    lines = read(path)
    assert lines[-1]["note"] == "timeout waiting for '>' after 22 27C6 (interrupted: CancelledError)"
    assert replay_ok(lines, strict=False)


def test_tx_recorded_before_a_reply_that_arrives_during_the_write(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(discover, "SCAN", SMALL_SCAN)
    path, client = tmp_path / "rec.jsonl", FakeClient(reply_during_write=True)
    asyncio.run(full_run(path, client))
    lines = read(path)
    got = []
    for i, x in enumerate(lines):
        if x["dir"] == "tx":
            rest = [y for y in lines[i + 1:] if y["dir"] != "meta"]
            n = next((k for k, y in enumerate(rest) if y["dir"] == "tx"), len(rest))
            got.append((x["data"][:-1], "".join(y["data"] for y in rest[:n])))
    assert got == client.replies
    assert replay_ok(lines, strict=True)


def test_write_error_leaves_interrupted_note(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(discover, "SCAN", SMALL_SCAN)
    path = tmp_path / "rec.jsonl"
    with pytest.raises(OSError):
        asyncio.run(full_run(path, FakeClient(raise_on=("22 27C6",))))
    lines = read(path)
    assert lines[-2] == {"t": lines[-2]["t"], "dir": "tx", "data": "22 27C6\r"}
    assert lines[-1]["note"] == "timeout waiting for '>' after 22 27C6 (interrupted: OSError)"
    assert replay_ok(lines, strict=False)


def test_watch_list_cap(tmp_path, monkeypatch) -> None:
    path = tmp_path / "rec.jsonl"
    # Synthetic phase-B times in ms: (did, ms, single_frame).
    positives = {"CB": [(0x2001, 6000.0, False), (0x2002, 5000.0, True), (0x2003, 4000.0, True)],
                 "17": [(0x2004, 5000.0, True), (0x2005, 100.0, False)]}

    async def run() -> None:
        rec = Recorder(str(path))
        elm = discover.Elm(FakeClient(), "w", "n", True, rec)
        await elm.start()
        await discover.watch(elm, rec, positives, marks_full())

    asyncio.run(run())
    meta = next(x for x in read(path) if "watch" in x)
    assert meta["watch"] == {"CB": ["2002", "2003"], "17": ["2004"]}
    assert meta["dropped"] == [["CB", "2001"], ["17", "2005"]]
    ms = {(m, f"{d:04X}"): t for m, v in positives.items() for d, t, _ in v}
    assert sum(ms[(m, d)] for m, v in meta["watch"].items() for d in v) <= discover.WATCH_CYCLE_S * 1000


def test_go_discovery_slug(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(go, "REPO", str(tmp_path))
    first = go.next_out_path(discover.CAR, "2026-09-22", "discovery")
    assert first.endswith(os.path.join("chevrolet-equinox-ev-2024", "2026-09-22-discovery.jsonl"))
    os.makedirs(os.path.dirname(first))
    open(first, "x").close()
    assert go.next_out_path(discover.CAR, "2026-09-22", "discovery").endswith("2026-09-22-discovery-2.jsonl")
