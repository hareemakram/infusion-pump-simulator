import pytest

from pumpsim.protocol import Drug, Event, Response, Status, format_command, format_sensor, parse_alarms, split_line

STATUS = (
    "STATUS t=1200 state=INFUSING primed=1 motor=1 sps=55.5556 active_rate=100 rate=100 vtbi=50 weight=0 "
    "infused=0.5 prime=2 remaining=49.5 t_remaining=1782 drug=saline dose=100 dose_unit=mL/h pd=21.9 pu=31.7 "
    "res=247.5 air_cum=0 threshold=500 sens=MEDIUM highest=HIGH audible=1 silence_ms=0 "
    "alarms=AIR_IN_LINE:H:0:1100,RESERVOIR_LOW:L:1:900"
)


@pytest.mark.req("SRS-070")
def test_status_line_is_parsed_into_typed_fields():
    s = Status.parse(STATUS)
    assert s.state == "INFUSING" and s.primed and s.motor_enabled
    assert s.steps_per_s == pytest.approx(55.5556)
    assert s.time_remaining_s == 1782
    assert s.drug == "saline" and s.dose_unit == "mL/h"
    assert [a.id for a in s.alarms] == ["AIR_IN_LINE", "RESERVOIR_LOW"]
    assert s.alarms[0].priority == "HIGH" and not s.alarms[0].condition
    assert s.has_alarm("RESERVOIR_LOW") and not s.has_alarm("MOTOR_STALL")
    assert s.to_dict()["alarms"][1]["priority"] == "LOW"


def test_status_placeholders_become_none():
    s = Status.parse("STATUS t=0 state=IDLE drug=- dose_unit=- t_remaining=- alarms=-")
    assert s.drug is None and s.dose_unit is None and s.time_remaining_s is None and s.alarms == []
    with pytest.raises(ValueError):
        Status.parse("RESP cmd=X ok=1")


def test_trailing_free_text_fields():
    verb, f = split_line("EVT seq=3 t=100 kind=ALARM msg=HIGH AIR_IN_LINE: Air in line. Remove air.")
    assert verb == "EVT" and f["msg"] == "HIGH AIR_IN_LINE: Air in line. Remove air."
    e = Event.parse("EVT seq=3 t=100 kind=ALARM msg=a b c")
    assert e.to_dict() == {"seq": 3, "t": 100, "kind": "ALARM", "message": "a b c"}
    r = Response.parse("RESP cmd=PROGRAM ok=0 reason=CONFIRM_REQUIRED: Dose 2500 units/h above soft limit 2000")
    assert not r.ok and r.needs_confirmation and r.to_dict()["needs_confirmation"]
    assert Response.parse("RESP cmd=START ok=1").ok


def test_drug_line():
    d = Drug.parse("DRUG id=propofol conc=10 amount_unit=mg dose_unit=mg/kg/h wb=1 smin=0.3 smax=4 hmin=0 "
                   "hmax=6 maxrate=100 name=Propofol 1%")
    assert d.weight_based and d.name == "Propofol 1%" and d.hard_max == 6
    assert d.to_dict()["dose_unit"] == "mg/kg/h"


def test_malformed_alarm_items_are_skipped():
    assert parse_alarms("BROKEN,AIR_IN_LINE:H:1:5") [0].id == "AIR_IN_LINE"
    assert len(parse_alarms("BROKEN")) == 0


@pytest.mark.req("SRS-070")
def test_command_formatting_rejects_injection():
    assert format_command("program", drug="saline", rate=10.5, confirm=True, weight=None) == \
        "CMD PROGRAM drug=saline rate=10.5 confirm=1"
    with pytest.raises(ValueError):
        format_command("PROGRAM", drug="saline rate=999")
    with pytest.raises(ValueError):
        format_command("PROGRAM", drug="a\nCMD START")
    assert format_sensor(100, 1.25, -2, 0, 250, 7) == "SENSOR t=100 pd=1.2 pu=-2.0 air=0.0 res=250.000 enc=7"
