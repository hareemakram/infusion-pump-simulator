"""Parsing and formatting for the HAL wire protocol (see docs/03-software-architecture.md)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Keys whose value runs to the end of the line and may contain spaces.
_TRAILING_KEYS = ("msg=", "reason=", "name=")

_PRIORITY = {"H": "HIGH", "M": "MEDIUM", "L": "LOW"}


def split_line(line: str) -> tuple[str, dict[str, str]]:
    """Split ``VERB k=v k=v ... [trailing=free text]`` into verb and fields."""
    line = line.rstrip("\r\n")
    verb, _, rest = line.partition(" ")
    fields: dict[str, str] = {}
    trailing = None
    for key in _TRAILING_KEYS:
        if rest.startswith(key):
            idx = 0
        else:
            idx = rest.find(" " + key)
            if idx >= 0:
                idx += 1
        if idx >= 0 and (trailing is None or idx < trailing[0]):
            trailing = (idx, key)
    if trailing is not None:
        idx, key = trailing
        fields[key[:-1]] = rest[idx + len(key):]
        rest = rest[:idx]
    for token in rest.split():
        k, sep, v = token.partition("=")
        if sep:
            fields[k] = v
    return verb, fields


def _num(value: str) -> float | None:
    if value in ("", "-"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


@dataclass(frozen=True)
class Alarm:
    id: str
    priority: str
    condition: bool
    raised_at: int

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "priority": self.priority, "condition": self.condition, "raised_at": self.raised_at}


def parse_alarms(value: str) -> list[Alarm]:
    if not value or value == "-":
        return []
    out = []
    for item in value.split(","):
        parts = item.split(":")
        if len(parts) != 4:
            continue
        out.append(Alarm(parts[0], _PRIORITY.get(parts[1], parts[1]), parts[2] == "1", int(parts[3])))
    return out


@dataclass
class Status:
    t: int = 0
    state: str = "IDLE"
    primed: bool = False
    motor_enabled: bool = False
    steps_per_s: float = 0.0
    active_rate: float = 0.0
    rate: float = 0.0
    vtbi: float = 0.0
    weight: float = 0.0
    infused: float = 0.0
    prime: float = 0.0
    remaining: float = 0.0
    time_remaining_s: float | None = None
    drug: str | None = None
    dose: float = 0.0
    dose_unit: str | None = None
    downstream: float = 0.0
    upstream: float = 0.0
    reservoir: float = 0.0
    air_cumulative: float = 0.0
    threshold: float = 0.0
    sensitivity: str = "MEDIUM"
    highest: str = "NONE"
    audible: bool = False
    silence_ms: int = 0
    alarms: list[Alarm] = field(default_factory=list)

    @classmethod
    def parse(cls, line: str) -> "Status":
        verb, f = split_line(line)
        if verb != "STATUS":
            raise ValueError(f"not a STATUS line: {line!r}")

        def num(key: str, default: float = 0.0) -> float:
            v = _num(f.get(key, ""))
            return default if v is None else v

        def opt(key: str) -> str | None:
            v = f.get(key)
            return None if v in (None, "-") else v

        return cls(
            t=int(num("t")),
            state=f.get("state", "IDLE"),
            primed=f.get("primed") == "1",
            motor_enabled=f.get("motor") == "1",
            steps_per_s=num("sps"),
            active_rate=num("active_rate"),
            rate=num("rate"),
            vtbi=num("vtbi"),
            weight=num("weight"),
            infused=num("infused"),
            prime=num("prime"),
            remaining=num("remaining"),
            time_remaining_s=_num(f.get("t_remaining", "-")),
            drug=opt("drug"),
            dose=num("dose"),
            dose_unit=opt("dose_unit"),
            downstream=num("pd"),
            upstream=num("pu"),
            reservoir=num("res"),
            air_cumulative=num("air_cum"),
            threshold=num("threshold"),
            sensitivity=f.get("sens", "MEDIUM"),
            highest=f.get("highest", "NONE"),
            audible=f.get("audible") == "1",
            silence_ms=int(num("silence_ms")),
            alarms=parse_alarms(f.get("alarms", "-")),
        )

    def has_alarm(self, alarm_id: str) -> bool:
        return any(a.id == alarm_id for a in self.alarms)

    def to_dict(self) -> dict[str, Any]:
        d = dict(self.__dict__)
        d["alarms"] = [a.to_dict() for a in self.alarms]
        return d


@dataclass(frozen=True)
class Event:
    seq: int
    t: int
    kind: str
    message: str

    @classmethod
    def parse(cls, line: str) -> "Event":
        _, f = split_line(line)
        return cls(int(f.get("seq", 0)), int(f.get("t", 0)), f.get("kind", ""), f.get("msg", ""))

    def to_dict(self) -> dict[str, Any]:
        return {"seq": self.seq, "t": self.t, "kind": self.kind, "message": self.message}


@dataclass(frozen=True)
class Response:
    command: str
    ok: bool
    reason: str = ""

    @property
    def needs_confirmation(self) -> bool:
        return self.reason.startswith("CONFIRM_REQUIRED")

    @classmethod
    def parse(cls, line: str) -> "Response":
        _, f = split_line(line)
        return cls(f.get("cmd", ""), f.get("ok") == "1", f.get("reason", ""))

    def to_dict(self) -> dict[str, Any]:
        return {"command": self.command, "ok": self.ok, "reason": self.reason,
                "needs_confirmation": self.needs_confirmation}


@dataclass(frozen=True)
class Drug:
    id: str
    name: str
    concentration: float
    amount_unit: str
    dose_unit: str
    weight_based: bool
    soft_min: float
    soft_max: float
    hard_min: float
    hard_max: float
    max_rate: float

    @classmethod
    def parse(cls, line: str) -> "Drug":
        _, f = split_line(line)
        return cls(
            id=f["id"], name=f.get("name", f["id"]), concentration=float(f["conc"]),
            amount_unit=f["amount_unit"], dose_unit=f["dose_unit"], weight_based=f.get("wb") == "1",
            soft_min=float(f["smin"]), soft_max=float(f["smax"]), hard_min=float(f["hmin"]),
            hard_max=float(f["hmax"]), max_rate=float(f["maxrate"]),
        )

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def format_sensor(t_ms: int, pd: float, pu: float, air_ul: float, reservoir_ml: float, encoder: int) -> str:
    return f"SENSOR t={t_ms} pd={pd:.1f} pu={pu:.1f} air={air_ul:.1f} res={reservoir_ml:.3f} enc={encoder}"


def format_command(name: str, **args: Any) -> str:
    parts = [f"CMD {name.upper()}"]
    for k, v in args.items():
        if v is None:
            continue
        if isinstance(v, bool):
            v = int(v)
        sv = str(v)
        if not sv or any(c.isspace() for c in sv) or "=" in sv:
            raise ValueError(f"invalid value for {k!r}: {v!r}")
        parts.append(f"{k}={sv}")
    return " ".join(parts)
