"""Offline checks for redact_vin.py (spec X-2026-09-23-vin-redaction, Verification). The real VIN never appears
here: tests that need it learn it at runtime from the local originals and report only positions or names."""

import hashlib
import json
import os
import re

import go
import pytest
import redact_vin

VIN = "1C4SYNTHETICVIN00"  # the repo's synthetic VIN (T0.4 spec Sources)
MASKED = VIN[:11] + "000000"
DIR = os.path.join(go.REPO, "fixtures", "recordings", "chevrolet-equinox-ev-2024")
SPIKES = {"2026-09-22-spike": "6c29956dfc2ade5a2f2071f6042120b18747bfc6d0a4b821bf431fb58ba387d5",
          "2026-09-22-spike-2": "910f0d7551e8984b585211f5fed028a2e6f770ac35853581e31469aeadbc9b7f"}
SHA = "0" * 64


def frames(header: str, payload: bytes, sep: str = "") -> list[str]:
    """ISO-TP frames as the ELM prints them with ATH1 (sep " " for ATS1)."""
    def fmt(pci: str, data: bytes) -> str:
        return sep.join([header, *(pci[i:i + 2] for i in range(0, len(pci), 2)), *(f"{b:02X}" for b in data)])
    out = [fmt(f"1{len(payload):03X}", payload[:6])]
    for n, i in enumerate(range(6, len(payload), 7), 1):
        out.append(fmt(f"2{n & 0xF:X}", payload[i:i + 7]))
    return out


def interleave(*lists: list[str]) -> list[str]:
    return [f for group in zip(*lists, strict=True) for f in group]


def recording(tx: str, reply_frames: list[str], chunk: int = 11) -> str:
    reply = "\r".join(reply_frames) + "\r\r>"
    rows = [{"t": 0.5, "dir": "meta", "car": "synthetic"}, {"t": 1.0, "dir": "tx", "data": tx + "\r"}]
    rows += [{"t": 1.1 + i / 1000, "dir": "rx", "data": reply[i:i + chunk]} for i in range(0, len(reply), chunk)]
    return "".join(json.dumps(r) + "\n" for r in rows)


def vin_0902(vin: str) -> bytes:
    return bytes.fromhex("490201") + vin.encode()


def check_redacted(text: str, expected: str, masked: int) -> None:
    out, entries = redact_vin.redact(text, "syn.jsonl", SHA)
    lines, want = out.split("\n")[:-1], expected.split("\n")[:-1]
    assert lines[:-1] == want and [len(x) for x in lines[:-1]] == [len(x) for x in text.split("\n")[:-1]]
    marker = json.loads(lines[-1])
    assert marker == {"t": json.loads(want[-1])["t"], "dir": "meta", "redacted": "vin-serial", "source": "syn.jsonl",
                      "source_sha256": SHA, "script": "tools/spike/redact_vin.py", "script_version": 1,
                      "masked_messages": masked}
    assert len(entries) == masked


def test_29bit_two_ecus() -> None:
    def rec(vin: str) -> str:
        return recording("0902", interleave(frames("18DAF117", vin_0902(vin)), frames("18DAF128", vin_0902(vin))))
    # 11-char chunks of 23-char frames: cuts land inside headers and inside serial bytes
    check_redacted(rec(VIN), rec(MASKED), 2)
    _, entries = redact_vin.redact(rec(VIN), "syn.jsonl", SHA)
    assert entries == ["L2 0902 18DAF117", "L2 0902 18DAF128"]


def test_11bit_spaced() -> None:
    def rec(vin: str) -> str:
        return recording("0902", frames("7E8", vin_0902(vin), " "), chunk=7)
    assert "7E8 10 14 49 02 01" in "".join(json.loads(x).get("data", "") for x in rec(VIN).split("\n")[:-1])
    check_redacted(rec(VIN), rec(MASKED), 1)


def test_did_4193_four_copies() -> None:
    def rec(vin: str) -> str:
        payload = bytes.fromhex("624193") + vin.encode() * 4 + bytes([0x00, 0x7F, 0xFF])
        assert len(payload) >= 72
        return recording("22 4193", frames("18DAF117", payload))
    check_redacted(rec(VIN), rec(MASKED), 1)
    out, _ = redact_vin.redact(rec(VIN), "syn.jsonl", SHA)
    msg = redact_vin.messages([json.loads(x) for x in out.split("\n")[:-1]])[0]
    assert msg.payload == bytes.fromhex("624193") + MASKED.encode() * 4 + bytes([0x00, 0x7F, 0xFF])


def test_look_alikes_untouched() -> None:
    s1_2af5 = recording("22 2AF5", ["18DAF1CB100D622AF5998199", "18DAF1CB2177999509022505"])  # spike line 156
    assert "0902" in "".join(r.get("data", "") for r in read_records(s1_2af5))
    other = bytes.fromhex("490202") + VIN.encode()
    for text in (s1_2af5, recording("0902", frames("18DAF117", other))):
        out, entries = redact_vin.redact(text, "syn.jsonl", SHA)
        assert out.split("\n")[:-2] == text.split("\n")[:-1] and entries == []
        assert json.loads(out.split("\n")[-2])["masked_messages"] == 0


def bad_seq() -> str:
    f = frames("18DAF117", vin_0902(VIN))
    return recording("0902", [f[0], f[1][:8] + "23" + f[1][10:], f[2]])


def cf_without_ff() -> str:
    return recording("0902", frames("18DAF117", vin_0902(VIN))[1:])


def with_rows(text: str, rows: list[dict]) -> str:
    return text + "".join(json.dumps(r) + "\n" for r in rows)


def serial_in_unlisted_did() -> str:
    """Mode 22 reply to a DID no RULES entry covers, carrying the VIN: only the safety net can catch it."""
    reply = "\r".join(frames("18DAF117", bytes.fromhex("621234") + VIN.encode())) + "\r\r>"
    return with_rows(recording("0902", frames("18DAF117", vin_0902(VIN))),
                     [{"t": 2.0, "dir": "tx", "data": "22 1234\r"}, {"t": 2.1, "dir": "rx", "data": reply}])


def serial_in_meta_note() -> str:
    return with_rows(recording("0902", frames("18DAF117", vin_0902(VIN))),
                     [{"t": 2.0, "dir": "meta", "note": "serial " + VIN[11:]}])


@pytest.mark.parametrize(("text", "reason"), [
    ('{"t":1,"dir":"tx","data":"0902\\r"}\n', "line 1 is not in json.dumps form"),
    (bad_seq(), "unexpected CF (sequence 3)"),
    (cf_without_ff(), "unexpected CF (sequence 1)"),
    (recording("0902", frames("18DAF117", vin_0902("1C4SYNTHETIcVIN00"))), "VIN byte outside 0-9A-Z"),
    (serial_in_unlisted_did(), "a VIN serial survives masking"),
    (serial_in_meta_note(), "a VIN serial survives masking"),
])
def test_refusals(text: str, reason: str, tmp_path, capsys) -> None:
    with pytest.raises(ValueError, match=re.escape(reason)):
        redact_vin.redact(text, "syn.jsonl", SHA)
    src = tmp_path / "syn.jsonl"
    src.write_text(text, encoding="utf-8", newline="")
    assert redact_vin.main([str(src)]) == 1
    err = capsys.readouterr().err
    assert err.startswith("refused: ") and reason in err
    assert os.listdir(tmp_path) == ["syn.jsonl"]


def test_refuses_redacted_input_and_existing_output(tmp_path, capsys) -> None:
    text = recording("0902", frames("18DAF117", vin_0902(VIN)))
    done = tmp_path / "a.redacted.jsonl"
    done.write_text(text, encoding="utf-8", newline="")
    assert redact_vin.main([str(done)]) == 1
    assert capsys.readouterr().err == "refused: input is already a .redacted.jsonl copy\n"
    assert sorted(os.listdir(tmp_path)) == ["a.redacted.jsonl"]
    src = tmp_path / "b.jsonl"
    src.write_text(text, encoding="utf-8", newline="")
    (tmp_path / "b.redacted.jsonl").write_text("keep", encoding="utf-8")
    assert redact_vin.main([str(src)]) == 1
    assert capsys.readouterr().err == f"refused: output exists, not overwritten: {tmp_path / 'b.redacted.jsonl'}\n"
    assert (tmp_path / "b.redacted.jsonl").read_text(encoding="utf-8") == "keep"
    assert redact_vin.main([]) == 2


def test_deterministic_and_quiet(tmp_path, capsys) -> None:
    text = recording("0902", interleave(frames("18DAF117", vin_0902(VIN)), frames("18DAF128", vin_0902(VIN))))
    assert redact_vin.redact(text, "s.jsonl", SHA) == redact_vin.redact(text, "s.jsonl", SHA)
    src = tmp_path / "s.jsonl"
    src.write_text(text, encoding="utf-8", newline="")
    assert redact_vin.main([str(src)]) == 0
    sha = hashlib.sha256(text.encode()).hexdigest()
    assert (tmp_path / "s.redacted.jsonl").read_text(encoding="utf-8") == redact_vin.redact(text, "s.jsonl", sha)[0]
    printed = capsys.readouterr()
    serial = VIN[11:].encode()
    assert not [f for f in (serial.decode(), serial.hex(), serial.hex().upper()) if f in printed.out + printed.err]


def read_records(text: str) -> list[dict]:
    return [json.loads(x) for x in text.split("\n")[:-1]]


@pytest.mark.parametrize("stem", SPIKES)
def test_committed_copy(stem: str) -> None:
    with open(os.path.join(DIR, stem + ".redacted.jsonl"), encoding="utf-8") as f:
        records = read_records(f.read())
    marker = records[-1]
    assert marker["dir"] == "meta" and marker["redacted"] == "vin-serial"
    assert marker["source_sha256"] == SPIKES[stem] and marker["script_version"] == 1
    assert marker["masked_messages"] == 2
    msgs = [m for m in redact_vin.messages(records) if m.cmd == "0902" and len(m.payload) == m.length]
    assert [m.header for m in msgs] == ["18DAF117", "18DAF128"]
    assert all(len(m.payload) == 20 and m.payload[:3] == bytes.fromhex("490201") for m in msgs)
    assert all(m.payload[14:20] == b"000000" for m in msgs) and msgs[0].payload == msgs[1].payload


def diff_outside_windows(orig: str, out: str) -> tuple[int, list[int], list[str]]:
    """Returns (masked digit positions, changed line numbers, problems) without exposing any content."""
    a, b = read_records(orig), read_records(out)
    windows = {}
    for m in redact_vin.messages(a):
        if m.cmd in redact_vin.RULES and m.payload.startswith(redact_vin.RULES[m.cmd][0]):
            for o in redact_vin.RULES[m.cmd][1]:
                for hi, lo in m.spots[o + 11:o + 17]:
                    windows[hi], windows[lo] = "3", "0"
    problems = [f"line {i + 1} fields" for i in range(len(a)) if {**a[i], "data": ""} != {**b[i], "data": ""}]
    changed = sorted({i + 1 for i in range(len(a)) if a[i] != b[i]})
    for i in range(len(a)):
        da, db = a[i].get("data", ""), b[i].get("data", "")
        if len(da) != len(db):
            problems.append(f"line {i + 1} length")
        for n, (x, y) in enumerate(zip(da, db, strict=False)):
            if (i, n) in windows:
                if y != windows[(i, n)]:
                    problems.append(f"line {i + 1} char {n} not masked")
            elif x != y:
                problems.append(f"line {i + 1} char {n} changed outside the serial")
    if len(b) != len(a) + 1:
        problems.append("not exactly one appended line")
    return len(windows), changed, problems


def learned_serials(text: str) -> set[bytes]:
    return {m.payload[o + 11:o + 17] for m in redact_vin.messages(read_records(text))
            if m.cmd in redact_vin.RULES and m.payload.startswith(redact_vin.RULES[m.cmd][0])
            for o in redact_vin.RULES[m.cmd][1] if len(m.payload) >= o + 17}


def leaks(serials: set[bytes], text: str) -> list[str]:
    payloads = [m.payload for m in redact_vin.messages(read_records(text))]
    found = []
    for s in serials:
        for name, form in (("ascii", s.decode()), ("hex", s.hex()), ("HEX", s.hex().upper())):
            if form in text:
                found.append(name)
        if any(s in p for p in payloads):
            found.append("payload")
    return found


@pytest.mark.parametrize("stem", SPIKES)
def test_spike_original(stem: str) -> None:
    src = os.path.join(DIR, stem + ".jsonl")
    if not os.path.exists(src):
        pytest.skip("NOT RUN: original not on disk")
    with open(src, "rb") as f:
        raw = f.read()
    with open(os.path.join(DIR, stem + ".redacted.jsonl"), "rb") as f:
        committed = f.read()
    orig = raw.decode("utf-8")
    out, _ = redact_vin.redact(orig, stem + ".jsonl", hashlib.sha256(raw).hexdigest())
    assert out.encode("utf-8") == committed
    assert diff_outside_windows(orig, out) == (24, [80, 81, 82], [])
    serials = learned_serials(orig)
    assert len(serials) == 1 and leaks(serials, out) == []
    pairs = [(m.payload[3:14], n.payload[3:14]) for m, n in zip(redact_vin.messages(read_records(orig)),
             redact_vin.messages(read_records(out)), strict=True) if m.cmd == "0902" and len(m.payload) == 20]
    assert len(pairs) == 2 and all(x == y for x, y in pairs)


@pytest.mark.parametrize(("name", "count"), [("2026-09-23-discovery.jsonl", 1),
                                             ("2026-09-23-discovery-targeted.jsonl", 9)])
def test_discovery_in_memory(name: str, count: int) -> None:
    src = os.path.join(DIR, name)
    if not os.path.exists(src):
        pytest.skip("NOT RUN: original not on disk")
    with open(src, encoding="utf-8") as f:
        orig = f.read()
    out, entries = redact_vin.redact(orig, name, SHA)
    assert len(entries) == count and all(e.endswith(" 224193 18DAF117") for e in entries)
    positions, _, problems = diff_outside_windows(orig, out)
    assert positions == 48 * count and problems == []
    assert leaks(learned_serials(orig), out) == []
