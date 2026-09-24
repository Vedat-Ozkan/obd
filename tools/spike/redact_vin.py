# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Writes <stem>.redacted.jsonl: a recording with VIN characters 12-17 masked in place (ADR-017).

Sources: docs/specs/X-2026-09-23-vin-redaction.md (Sources table). Only hex digits of the VIN serial change;
every original line keeps its number and length, and one meta line recording the redaction is appended.
"""

import hashlib
import json
import os
import re
import sys
from typing import NamedTuple

VERSION = 1
MASK = "0"  # ASCII 0x30; each masked VIN byte's two hex digits become "30"
# Normalized tx command -> (reply payload prefix, payload indices where a 17-byte VIN starts).
# 0902: docs/ELM327.md + spike line 72. 224193: discovery.jsonl tx 44429 (VIN repeated four times, 68-byte run).
RULES: dict[str, tuple[bytes, tuple[int, ...]]] = {
    "0902": (bytes.fromhex("490201"), (3,)),
    "224193": (bytes.fromhex("624193"), (3, 20, 37, 54)),
}
_VIN_CHARS = re.compile(rb"[0-9A-Z]*")
_HEX = re.compile(r"[0-9A-F]+")

Spot = tuple[int, int]  # (line_idx, char_idx) of one hex digit in a record's "data"


class Message(NamedTuple):
    tx_line: int
    cmd: str
    header: str
    length: int
    payload: bytes
    spots: list[tuple[Spot, Spot]]


def _norm(cmd: str) -> str:
    return cmd.removesuffix("\r").replace(" ", "").upper()


def _replies(records: list[dict]):
    """Yields (tx line_idx, normalized cmd, rx chars with their spots) for every tx."""
    txs = [i for i, r in enumerate(records) if r["dir"] == "tx"]
    for i, j in zip(txs, [*txs[1:], len(records)], strict=True):
        chars = [(c, (k, n)) for k in range(i + 1, j) if records[k]["dir"] == "rx"
                 for n, c in enumerate(records[k]["data"])]
        yield i, _norm(records[i]["data"]), chars


def _frames(chars: list[tuple[str, Spot]]):
    piece: list[tuple[str, Spot]] = []
    for c, spot in [*chars, ("\r", (-1, -1))]:
        if c in "\r>":
            text = "".join(ch for ch, _ in piece)
            if _HEX.fullmatch(text):
                yield text, [s for _, s in piece]
            piece = []
        elif c != " ":
            piece.append((c, spot))


def messages(records: list[dict]) -> list[Message]:
    """Reassembles ISO-TP SF/FF/CF per header inside each tx's reply (rx lines up to the next tx), for every command."""
    out: list[Message] = []
    for i, cmd, chars in _replies(records):
        started: list[list] = []  # [header, length, payload bytearray, spots, next seq], in FF/SF order
        open_: dict[str, list] = {}
        for text, spots in _frames(chars):
            h = 8 if len(text) % 2 == 0 else 3
            header, pci, body = text[:h], text[h:h + 1], h + 1
            if pci == "0" and len(text) > body:
                n, body = int(text[h + 1], 16), body + 1
                msg = [header, n, bytearray(), [], None]
            elif pci == "1" and len(text) >= h + 4:
                n, body = int(text[h + 1:h + 4], 16), h + 4
                msg = open_[header] = [header, n, bytearray(), [], 1]
            elif pci == "2" and len(text) > body:
                msg, seq, body = open_.get(header), int(text[h + 1], 16), body + 1
                if msg is None or msg[4] != seq or len(msg[2]) >= msg[1]:
                    if cmd in RULES:
                        raise ValueError(f"L{i + 1} {cmd} {header}: unexpected CF (sequence {seq})")
                    continue
                msg[4] = (seq + 1) & 0xF
            else:
                continue
            if pci != "2":
                started.append(msg)
            for k in range(body, len(text) - 1, 2):
                if len(msg[2]) < msg[1]:
                    msg[2].append(int(text[k:k + 2], 16))
                    msg[3].append((spots[k], spots[k + 1]))
        out += [Message(i + 1, cmd, hd, n, bytes(p), s) for hd, n, p, s, _ in started]
    return out


def _qualifies(m: Message) -> bool:
    return m.cmd in RULES and m.payload.startswith(RULES[m.cmd][0])


def _check(text: str) -> list[dict]:
    if not text.endswith("\n"):
        raise ValueError("input does not end in a newline")
    records = []
    for n, line in enumerate(text[:-1].split("\n"), 1):
        try:
            ok = json.dumps(record := json.loads(line)) == line
        except json.JSONDecodeError:
            ok = False
        if not ok:
            raise ValueError(f"line {n} is not in json.dumps form")
        records.append(record)
    return records


def redact(text: str, source: str, source_sha256: str) -> tuple[str, list[str]]:
    """Returns (redacted file text, one summary entry per masked message, e.g. "L72 0902 18DAF117").
    Raises ValueError (no partial output) on any refusal. Never includes the VIN in any message."""
    records = _check(text)
    lines = text[:-1].split("\n")
    edits: dict[int, dict[int, str]] = {}
    serials: set[bytes] = set()
    found = [m for m in messages(records) if _qualifies(m)]
    for m in found:
        for o in RULES[m.cmd][1]:  # VIN characters 12-17 are payload indices o+11..o+16
            if not _VIN_CHARS.fullmatch(m.payload[o:o + 17]):
                raise ValueError(f"L{m.tx_line} {m.cmd} {m.header}: VIN byte outside 0-9A-Z")
            if len(m.payload) >= o + 17:
                serials.add(m.payload[o + 11:o + 17])
            for a, b in m.spots[o + 11:o + 17]:
                for (k, n), digit in zip((a, b), f"{ord(MASK):02X}", strict=True):
                    edits.setdefault(k, {})[n] = digit
    for k, chars in edits.items():
        data = list(records[k]["data"])
        for n, digit in chars.items():
            data[n] = digit
        new = json.dumps({**records[k], "data": "".join(data)})
        if len(new) != len(lines[k]):
            raise ValueError(f"line {k + 1}: masking changed the line length")
        lines[k] = new
    marker = {"t": records[-1]["t"], "dir": "meta", "redacted": "vin-serial", "source": source,
              "source_sha256": source_sha256, "script": "tools/spike/redact_vin.py",
              "script_version": VERSION, "masked_messages": len(found)}
    out = "\n".join([*lines, json.dumps(marker)]) + "\n"
    _safety_net(out, serials)
    return out, [f"L{m.tx_line} {m.cmd} {m.header}" for m in found]


def _safety_net(out: str, serials: set[bytes]) -> None:
    if not serials:
        return
    records = [json.loads(line) for line in out[:-1].split("\n")]
    rx = ["".join(c for c, _ in chars if c not in "\r ") for _, _, chars in _replies(records)]
    payloads = [m.payload for m in messages(records)]
    for s in serials:
        forms = (s.decode("ascii"), s.hex().upper(), s.hex())
        if (any(f in out for f in forms) or any(forms[1] in r or forms[2] in r for r in rx)
                or any(s in p for p in payloads)):
            raise ValueError("a VIN serial survives masking; no output written")


def main(argv: list[str] | None = None) -> int:
    """uv run tools/spike/redact_vin.py <recording.jsonl>"""
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: redact_vin.py <recording.jsonl>", file=sys.stderr)
        return 2
    src = args[0]
    try:
        if src.endswith(".redacted.jsonl"):
            raise ValueError("input is already a .redacted.jsonl copy")
        with open(src, "rb") as f:
            raw = f.read()
        out, entries = redact(raw.decode("utf-8"), os.path.basename(src), hashlib.sha256(raw).hexdigest())
        dst = os.path.splitext(src)[0] + ".redacted.jsonl"
        try:
            with open(dst, "x", encoding="utf-8", newline="") as f:
                f.write(out)
        except FileExistsError:
            raise ValueError(f"output exists, not overwritten: {dst}") from None
    except ValueError as e:  # includes UnicodeDecodeError
        print(f"refused: {e}", file=sys.stderr)
        return 1
    print(dst)
    print(f"{out.count(chr(10))} lines")
    print("\n".join(entries) if entries else "no VIN found")
    print(f"sha256 {hashlib.sha256(out.encode('utf-8')).hexdigest()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
