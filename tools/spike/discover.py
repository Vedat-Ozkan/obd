# /// script
# requires-python = ">=3.11"
# dependencies = ["bleak>=0.22"]
# ///
"""T2.3a Equinox EV discovery: standard sweep, read-only Mode 22 DID scan, and watch, recorded over BLE.

Sources for every command and module id: docs/specs/T2.3a-equinox-discovery.md (Sources table).
No decoding happens here; replies are only classified to build the watch list and print progress.
"""

import argparse
import asyncio
import collections
import datetime
import importlib.metadata
import platform
import re
import sys
import time

from go import ask, find_dongle, next_out_path
from spike import CARS, CHUNK, CODEC, SERVICE, Recorder

CAR = CARS[2]
MODULES = ("17", "28", "40", "45", "CB")  # T0.2 EV recording line 84 (090A replies)
INIT = ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATDPN", "ATRV"]
MODE01_BITMAPS = [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0]
SCAN = [("CB", 0x2000, 0x2FFF), ("CB", 0x4000, 0x43FF), ("CB", 0x8300, 0x83FF),
        ("17", 0x2000, 0x2FFF), ("17", 0x4000, 0x43FF),
        *[(m, 0xF180, 0xF1FF) for m in MODULES]]
WATCH_MODULES = ("CB", "17")
STATES = ("idle baseline", "heater max on", "heater off", "plugged in and charging", "unplugged")
SCAN_BUDGET_S = 15 * 60
WATCH_CYCLE_S = 15
CMD_TIMEOUT_S = 5  # longest seen: 2.3 s, 0100 with SEARCHING...
ALLOWED_AT = {"ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "ATSP7", "ATDPN", "ATRV",
              "ATCP 18", "ATFCSD 300000", "ATFCSM 1",
              *(f"ATSH DA{m}F1" for m in MODULES), *(f"ATCRA 18DAF1{m}" for m in MODULES),
              *(f"ATFCSH 18DA{m}F1" for m in MODULES)}
_VIN = ("0902", "22 F190", "22 4193")  # user decision: no VIN reads (spec Non-goals; 4193: X-2026-09-23-vin-redaction)
_INSTRUCTIONS = (
    "HVAC off, car in Ready, Park. After about 60 s set the heater to max (hot, fan high) and press Enter once hot air flows.",
    "After about 60 s turn the heater off and press Enter.",
    ("After about 60 s plug in the home charger. Press Enter once the car/charger shows it is charging (if it does not "
     "start within about a minute in Ready, switch the car off and continue). Leave the laptop in the car."),
    "After about 90 s unplug the charger and press Enter.",
    "After about 60 s press Enter to finish.",
)


def check_allowed(cmd: str) -> None:
    """The single allowlist: every byte sent to the dongle passes here first."""
    if cmd in ALLOWED_AT:
        return
    if cmd not in _VIN and re.fullmatch(r"01[0-9A-F]{2}|09[0-9A-F]{2}|22 [0-9A-F]{4}", cmd):
        return
    raise ValueError(f"refused by the allowlist: {cmd!r}")


def bitmap_replies(reply: str, service: int, pid: int) -> dict[str, int]:
    pat = rf"18DAF1([0-9A-F]{{2}})06{service + 0x40:02X}{pid:02X}([0-9A-F]{{8}})"
    return {m[1]: int(m[2], 16) for line in reply.split("\r") if (m := re.fullmatch(pat, line.strip()))}


def flagged(base: int, bits: int) -> list[int]:
    return [base + i for i in range(1, 0x21) if bits >> (32 - i) & 1]


def _any_line(reply: str, pat: str) -> bool:
    # ELM separates lines with "\r"; stray CFs or 7F 22 78 may precede the real reply
    return any(re.match(pat, line.strip()) for line in reply.split("\r"))


def _single(reply: str, module: str, did: int) -> bool:
    return _any_line(reply, rf"18DAF1{module}0[1-7]62{did:04X}")


def classify_22(reply: str, module: str, did: int) -> str:
    if _single(reply, module, did) or _any_line(reply, rf"18DAF1{module}1[0-9A-F]{{3}}62{did:04X}"):
        return "positive"
    if _any_line(reply, rf"18DAF1{module}037F22[0-9A-F]{{2}}"):
        return "negative"
    return "nodata" if "NO DATA" in reply else "other"


class Elm:
    def __init__(self, client: object, write_char: object, notify_char: object,
                 without_response: bool, rec: Recorder) -> None:
        self.client, self.write_char, self.notify_char = client, write_char, notify_char
        self.without_response, self.rec = without_response, rec
        self.buf, self.prompt = [], asyncio.Event()
        self.fatal = False  # set after phase A step 2: LV RESET / UNABLE TO CONNECT then abort

    def _on_rx(self, _: object, data: bytearray) -> None:
        text = bytes(data).decode(CODEC)
        self.rec.event("rx", text)
        self.buf.append(text)
        if ">" in text:
            self.prompt.set()

    async def start(self) -> None:
        await self.client.start_notify(self.notify_char, self._on_rx)

    async def send(self, cmd: str) -> str:
        check_allowed(cmd)
        reply = await self._once(cmd)
        if "CAN ERROR" in reply:  # docs/ELM327.md §Responses: retry once after 500 ms
            await asyncio.sleep(0.5)
            reply = await self._once(cmd)
        if self.fatal and ("LV RESET" in reply or "UNABLE TO CONNECT" in reply):
            self.rec.meta(note=f"aborted: {reply.strip()}")
            sys.exit(f"aborted: {reply.strip()}")
        return reply

    async def _once(self, cmd: str) -> str:
        self.buf.clear()
        self.prompt.clear()
        payload = (cmd + "\r").encode(CODEC)
        self.rec.event("tx", cmd + "\r")  # first: a reply can arrive while write_gatt_char awaits (T2.3b)
        try:
            for i in range(0, len(payload), CHUNK):
                await self.client.write_gatt_char(self.write_char, payload[i:i + CHUNK],
                                                  response=not self.without_response)
            await asyncio.wait_for(self.prompt.wait(), CMD_TIMEOUT_S)
        except TimeoutError:
            self.rec.meta(note=f"timeout waiting for '>' after {cmd}")
            return ""
        except BaseException as e:
            self.rec.meta(note=f"timeout waiting for '>' after {cmd} (interrupted: {type(e).__name__})")
            raise
        return "".join(self.buf)


async def select(elm: Elm, module: str) -> None:
    for cmd in (f"ATSH DA{module}F1", f"ATCRA 18DAF1{module}", f"ATFCSH 18DA{module}F1"):
        await elm.send(cmd)


async def sweep(elm: Elm, rec: Recorder) -> None:
    rec.meta(phase="A")
    for cmd in INIT:
        reply = await elm.send(cmd)
        print(f"A init {cmd}: {reply.strip()!r}")
        if cmd in ("ATE0", "ATL0", "ATS0", "ATH1", "ATSP0") and "OK" not in reply:
            rec.meta(note=f"init failed: {cmd} replied {reply.strip()!r}")
            sys.exit(f"init failed: {cmd} replied {reply.strip()!r}")
    pids: set[int] = set()
    for base in MODE01_BITMAPS:
        maps = bitmap_replies(await elm.send(f"01{base:02X}"), 0x01, base)
        print(f"A 01{base:02X}: {', '.join(f'{m}={b:08X}' for m, b in maps.items()) or 'no bitmap'}")
        if not maps and base == 0:
            rec.meta(note="no Mode 01 reply; is the car in Ready?")
            sys.exit("no Mode 01 reply; is the car in Ready?")
        for bits in maps.values():
            pids.update(flagged(base, bits))
        if not any(bits & 1 for bits in maps.values()):
            break
    elm.fatal = True
    mode01 = sorted(p for p in pids if p % 0x20)  # multiples of 0x20 are the bitmap PIDs
    rec.meta(phase="A", mode01_pids=[f"{p:02X}" for p in mode01])
    for pid in mode01:
        await elm.send(f"01{pid:02X}")
    print(f"A Mode 01: {len(mode01)} flagged PIDs read")
    await elm.send("ATSP7")
    await elm.send("ATCP 18")
    for i, m in enumerate(MODULES):
        await select(elm, m)
        if i == 0:
            await elm.send("ATFCSD 300000")
            await elm.send("ATFCSM 1")
        bits = bitmap_replies(await elm.send("0900"), 0x09, 0x00).get(m, 0)
        infotypes = sorted(({t for t in flagged(0, bits) if t <= 0x1F} | {0x0A}) - {0x02})
        print(f"A Mode 09 {m}: 0900={bits:08X}, infotypes {[f'{t:02X}' for t in infotypes]}")
        for t in infotypes:
            await elm.send(f"09{t:02X}")


async def scan(elm: Elm, rec: Recorder) -> dict[str, list[tuple[int, float, bool]]]:
    rec.meta(phase="B", plan=[[m, f"{lo:04X}", f"{hi:04X}"] for m, lo, hi in SCAN],
             budget_s=SCAN_BUDGET_S, skip=["F190"])
    counts = {m: dict.fromkeys(("positive", "negative", "nodata", "other"), 0) for m in MODULES}
    found: dict[str, list[tuple[int, float, bool]]] = {m: [] for m in MODULES}
    remaining = sum(hi - lo + 1 - (lo <= 0xF190 <= hi) for _, lo, hi in SCAN)
    recent: collections.deque[float] = collections.deque(maxlen=256)
    start = printed = time.monotonic()
    last, stopped = None, False
    for m, lo, hi in SCAN:
        rec.meta(phase="B", module=m, range=(rng := f"{lo:04X}-{hi:04X}"))
        await select(elm, m)
        for did in range(lo, hi + 1):
            if did == 0xF190:
                continue
            if stopped := time.monotonic() - start >= SCAN_BUDGET_S:
                break
            sent = time.monotonic()
            reply = await elm.send(f"22 {did:04X}")
            ms = (time.monotonic() - sent) * 1000
            kind = classify_22(reply, m, did)
            counts[m][kind] += 1
            if kind == "positive":
                found[m].append((did, ms, _single(reply, m, did)))
            last, remaining = [m, f"{did:04X}"], remaining - 1
            recent.append(ms)
            if (now := time.monotonic()) - printed >= 5:
                printed, avg, left = now, sum(recent) / len(recent), SCAN_BUDGET_S - (now - start)
                warn = "  WARNING: the budget will cut ranges" if remaining * avg / 1000 > left else ""
                print(f"B {m} {rng} {did - lo + 1}/{hi - lo + 1} {counts[m]} avg {avg:.0f} ms, "
                      f"ETA {min(remaining * avg / 1000, left) / 60:.1f} min{warn}")
        if stopped:
            break
    rec.meta(phase="B", stopped_early=stopped, last=last, counts=counts,
             positives={m: [f"{d:04X}" for d, _, _ in v] for m, v in found.items()})
    print(f"B done: stopped_early={stopped}, last={last}, positives {({m: len(v) for m, v in found.items()})}")
    return {m: found[m] for m in WATCH_MODULES}


async def watch(elm: Elm, rec: Recorder, positives: dict[str, list[tuple[int, float, bool]]],
                marks: "asyncio.Queue[str]") -> None:
    ordered = [(m, did, ms, single) for m in WATCH_MODULES for did, ms, single in positives.get(m, [])]
    ordered.sort(key=lambda x: not x[3])  # stable: single-frame first, discovery order kept
    kept, dropped, total = {m: [] for m in WATCH_MODULES}, [], 0.0
    for m, did, ms, _ in ordered:
        if dropped or total + ms > WATCH_CYCLE_S * 1000:
            dropped.append([m, f"{did:04X}"])
        else:
            total += ms
            kept[m].append(did)
    rec.meta(phase="C", watch={m: [f"{d:04X}" for d in v] for m, v in kept.items()}, dropped=dropped)
    for state, text in zip(STATES, _INSTRUCTIONS, strict=True):
        rec.meta(phase="C", state=state)
        print(f"\nC state: {state}\n  {text}\n  Hold each state at least 60 s and 3 cycles.")
        entered, cycles = time.monotonic(), 0
        while not cycles or marks.empty():  # marks are taken between cycles only
            await elm.send("ATRV")
            for m in WATCH_MODULES:
                await select(elm, m)
                for did in kept[m]:
                    await elm.send(f"22 {did:04X}")
            cycles += 1
            print(f"  {state}: {time.monotonic() - entered:.0f} s, {cycles} cycles")
        marks.get_nowait()
    rec.meta(phase="end")


def main() -> None:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args()
    from bleak import BleakClient

    note = f"ready, park, dash SOC {ask('Battery % on the dash')}%, ambient {ask('Outside temperature in C')} C"
    n_scan = sum(hi - lo + 1 - (lo <= 0xF190 <= hi) for _, lo, hi in SCAN)
    print(f"Plan: A standard sweep (~70 requests, <1 min); B Mode 22 scan ({n_scan} requests, "
          f"~{n_scan * 0.075 / 60:.1f} min at 75 ms, hard stop {SCAN_BUDGET_S // 60} min); "
          f"C watch ({len(STATES)} states, you press Enter). Do not press Enter until asked.")

    async def session() -> None:
        address = await find_dongle()
        out = next_out_path(CAR, datetime.datetime.now(datetime.UTC).astimezone().date().isoformat(), "discovery")
        print(f"Recording to {out}\n")
        rec = Recorder(out)
        async with BleakClient(address) as client:
            svc = client.services.get_service(SERVICE)
            chars = list(svc.characteristics) if svc else []
            write_char = next((c for c in chars if "write-without-response" in c.properties), None)
            write_char = write_char or next((c for c in chars if "write" in c.properties), None)
            notify_char = next((c for c in chars if "notify" in c.properties), None)
            if write_char is None or notify_char is None:
                dump = [f"{s.uuid}: {[(c.uuid, c.properties) for c in s.characteristics]}"
                        for s in client.services]
                print(*dump, sep="\n")
                rec.meta(note="service FFF0 or its write/notify characteristic not found", gatt=dump)
                sys.exit(1)
            rec.meta(car=CAR, dongle="veepeak-obdcheck-ble", note=note,
                     script="tools/spike/discover.py", bleak=importlib.metadata.version("bleak"),
                     platform=platform.platform(), write_char=write_char.uuid,
                     notify_char=notify_char.uuid, mtu=client.mtu_size)
            elm = Elm(client, write_char, notify_char, "write-without-response" in write_char.properties, rec)
            await elm.start()
            await sweep(elm, rec)
            positives = await scan(elm, rec)
            marks: asyncio.Queue[str] = asyncio.Queue()

            async def feed() -> None:
                for _ in STATES:
                    await marks.put(await asyncio.to_thread(sys.stdin.readline))

            reader = asyncio.create_task(feed())
            try:
                await watch(elm, rec, positives, marks)
            finally:
                if not reader.done():
                    print("Press Enter to exit.")
            await client.stop_notify(notify_char)
        print(f"Done. Unplug the dongle. Recording: {out}")

    asyncio.run(session())


if __name__ == "__main__":
    main()
