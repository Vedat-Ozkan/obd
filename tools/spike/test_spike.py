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
