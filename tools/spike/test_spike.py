"""Offline check of the recording format contract (spec T0.2, Interfaces). Does not import bleak."""

import json
import os

from spike import Recorder


def test_recorder_format(tmp_path) -> None:
    path = tmp_path / "chrysler-200-2013" / "rec.jsonl"  # dir must be created by Recorder
    rec = Recorder(str(path))
    rec.meta(car="chrysler-200-2013", note="synthetic")
    rec.event("tx", "ATZ\r")
    rec.event("rx", "\r\rELM327 v1.5\r\r>")
    rec.event("rx", bytes([0x00, 0x7F, 0x80, 0xE9, 0xFF]).decode("iso-8859-1"))
    raw = path.read_bytes()
    assert b"\r" not in raw
    lines = [json.loads(l) for l in raw.decode("utf-8").split("\n") if l]
    assert len(lines) >= 3
    assert [ln["dir"] for ln in lines] == ["meta", "tx", "rx", "rx"]
    assert lines[2]["data"] == "\r\rELM327 v1.5\r\r>"
    assert lines[3]["data"].encode("iso-8859-1") == bytes([0x00, 0x7F, 0x80, 0xE9, 0xFF])
    assert [ln["t"] for ln in lines] == sorted(ln["t"] for ln in lines)


def test_go_never_reuses_a_recording_path(tmp_path, monkeypatch) -> None:
    import go

    monkeypatch.setattr(go, "REPO", str(tmp_path))
    first = go.next_out_path("chevrolet-equinox-ev-2024", "2026-09-22")
    assert first.endswith("2026-09-22-spike.jsonl")
    os.makedirs(os.path.dirname(first))
    open(first, "x").close()
    assert go.next_out_path("chevrolet-equinox-ev-2024", "2026-09-22").endswith("2026-09-22-spike-2.jsonl")


def test_send_records_tx_before_a_reply_that_arrives_during_the_write(tmp_path, monkeypatch, capsys) -> None:
    """T2.3b Decision 5: fake bleak module whose client delivers the whole reply before write_gatt_char returns."""
    import asyncio
    import sys
    import types
    import typing

    import spike

    class FakeBleakClient:
        def __init__(self, address: str) -> None:
            char = types.SimpleNamespace(uuid="fff1", properties=["write-without-response", "notify"])
            self.services = types.SimpleNamespace(get_service=lambda _: types.SimpleNamespace(characteristics=[char]))
            self.mtu_size, self.cb = 23, None

        async def __aenter__(self) -> "typing.Self":
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def start_notify(self, char: object, cb: object) -> None:
            self.cb = cb

        async def stop_notify(self, char: object) -> None:
            self.cb = None

        async def write_gatt_char(self, char: object, data: bytes, response: bool) -> None:
            if data.endswith(b"\r"):
                self.cb(None, bytearray(b"OK\r\r>"))  # synthetic reply

    monkeypatch.setitem(sys.modules, "bleak", types.SimpleNamespace(BleakClient=FakeBleakClient, BleakScanner=None))
    monkeypatch.setattr(spike.importlib.metadata, "version", lambda _: "fake")
    path = tmp_path / "rec.jsonl"
    monkeypatch.setattr(sys, "argv", ["spike.py", "--car", spike.CARS[0], "--address", "x", "--out", str(path),
                                      "--note", "synthetic"])
    asyncio.run(spike.main())
    lines = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines()]
    assert [ln["dir"] for ln in lines] == ["meta"] + ["tx", "rx"] * len(spike.COMMANDS)
    assert [ln["data"][:-1] for ln in lines if ln["dir"] == "tx"] == spike.COMMANDS
    assert "| 2 | ATZ |" in capsys.readouterr().out  # printed line = the tx line
