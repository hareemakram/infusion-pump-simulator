"""Closed-loop system tests: the real firmware binary against the plant model.

These are the software system tests of IEC 62304 clause 5.7. Each test is
linked to the requirements it verifies with @pytest.mark.req.
"""

import pytest

from pumpsim.bench import TestBench

pytestmark = pytest.mark.system


@pytest.mark.req("SRS-010", "SRS-011", "SRS-021", "SRS-022", "SRS-023")
def test_complete_infusion_delivers_vtbi_within_two_percent(bench):
    bench.program("saline", 300, 10)
    assert bench.command("START").reason == "Line not primed"
    assert bench.prime()
    outflow_after_prime = bench.plant.delivered_to_patient_ml
    assert bench.command("START").ok
    elapsed = bench.run_until(lambda s: s.state == "KVO", 200)
    assert elapsed == pytest.approx(120, abs=1)
    assert bench.status.infused == pytest.approx(10, rel=0.02)
    assert bench.status.has_alarm("INFUSION_COMPLETE")
    assert bench.status.active_rate == 1.0
    bench.run(30)  # let the line settle
    delivered = bench.plant.delivered_to_patient_ml - outflow_after_prime
    assert delivered == pytest.approx(10 + 30 / 3600, rel=0.02)


@pytest.mark.req("SRS-003", "SRS-004", "SRS-060")
def test_dose_limits_end_to_end(bench):
    hard = bench.program("heparin", 35, 100, confirm=True)
    assert not hard.ok and "hard limit" in hard.reason
    soft = bench.program("heparin", 25, 100)
    assert soft.needs_confirmation
    assert bench.status.state == "IDLE"
    assert bench.program("heparin", 25, 100, confirm=True).ok
    assert bench.has_event("OVERRIDE", "soft limit")


@pytest.mark.req("SRS-030", "SRS-012", "SRS-013")
def test_downstream_occlusion_detected_and_no_auto_restart(bench):
    bench.start_infusion("saline", 100, 100)
    bench.run(5)
    bench.inject("downstream_occlusion")
    t = bench.run_until(lambda s: s.state == "ALARM", 60)
    assert t is not None and t < 25
    bench.step()
    assert not bench.status.motor_enabled
    encoder = bench.plant.encoder
    bench.clear("downstream_occlusion")
    bench.run(10)
    assert bench.status.state == "ALARM"
    assert bench.plant.encoder == encoder  # nothing moved while waiting for the operator
    bench.command("ACK")
    assert bench.status.state == "PAUSED"
    assert bench.command("START").ok


@pytest.mark.req("SRS-031")
@pytest.mark.parametrize("level,limit_s", [("HIGH", 12), ("MEDIUM", 20), ("LOW", 32)])
def test_occlusion_time_to_alarm_scales_with_sensitivity(level, limit_s):
    with TestBench() as b:
        b.command("SENS", level=level)
        b.start_infusion("saline", 100, 100)
        b.run(5)
        b.inject("downstream_occlusion")
        t = b.run_until(lambda s: s.has_alarm("DOWNSTREAM_OCCLUSION"), 60)
        assert t is not None and t < limit_s


@pytest.mark.req("SRS-043")
def test_occlusion_cannot_be_acknowledged_while_present(bench):
    bench.start_infusion("saline", 200, 100)
    bench.inject("downstream_occlusion")
    bench.run_until(lambda s: s.state == "ALARM", 60)
    bench.run(2)
    bench.command("ACK")
    assert bench.status.state == "ALARM"
    assert bench.status.has_alarm("DOWNSTREAM_OCCLUSION")


@pytest.mark.req("SRS-032")
def test_upstream_occlusion(bench):
    bench.start_infusion("saline", 100, 100)
    bench.inject("upstream_occlusion")
    assert bench.run_until(lambda s: s.has_alarm("UPSTREAM_OCCLUSION"), 60) is not None
    bench.step()
    assert bench.status.state == "ALARM"


@pytest.mark.req("SRS-033", "SRS-040")
def test_single_air_bubble(bench):
    bench.start_infusion("saline", 100, 100)
    bench.inject("air_bubble", volume_ul=60)
    bench.step()
    assert bench.status.state == "ALARM"
    assert bench.status.highest == "HIGH"
    assert bench.status.alarms[0].id == "AIR_IN_LINE"


@pytest.mark.req("SRS-034")
def test_cumulative_micro_bubbles(bench):
    bench.start_infusion("saline", 100, 100)
    bench.inject("micro_bubbles")
    t = bench.run_until(lambda s: s.has_alarm("AIR_IN_LINE"), 300)
    assert t == pytest.approx(68, abs=3)  # 34 bubbles x 30 uL >= 1000 uL


@pytest.mark.req("SRS-035")
def test_container_runs_dry(bench):
    bench.start_infusion("saline", 400, 500, confirm=False)
    bench.inject("container_dry")
    assert bench.run_until(lambda s: s.has_alarm("RESERVOIR_LOW"), 60) is not None
    assert bench.status.state == "INFUSING"
    assert bench.run_until(lambda s: s.has_alarm("RESERVOIR_EMPTY"), 200) is not None
    bench.step()
    assert bench.status.state == "ALARM"
    bench.clear("container_dry")  # hang a new bag
    bench.run(1)
    bench.command("ACK")
    assert bench.status.state == "PAUSED"


@pytest.mark.req("SRS-036")
def test_motor_stall(bench):
    bench.start_infusion("saline", 100, 100)
    bench.inject("motor_stall")
    t = bench.run_until(lambda s: s.has_alarm("MOTOR_STALL"), 10)
    assert t is not None and t < 2


@pytest.mark.req("SRS-037")
@pytest.mark.parametrize("rate", [1.0, 5.0, 100.0, 500.0])
def test_motor_runaway_detected_at_any_rate(rate):
    with TestBench() as b:
        b.start_infusion("saline", rate, 100, confirm=True)
        b.run(3)
        b.inject("motor_runaway")
        t = b.run_until(lambda s: s.has_alarm("OVER_DELIVERY"), 60)
        assert t is not None and t < 5


@pytest.mark.req("SRS-037")
def test_uncommanded_motion_while_paused(bench):
    bench.start_infusion("saline", 100, 100)
    bench.command("PAUSE")
    bench.run(2)
    bench.inject("motor_runaway")
    assert bench.run_until(lambda s: s.state == "ALARM", 5) is not None


@pytest.mark.req("SRS-050", "SRS-053")
def test_pressure_sensor_rail_forces_fault_until_restart(bench):
    bench.start_infusion("saline", 100, 100)
    bench.inject("pressure_rail")
    bench.step()
    bench.step()
    assert bench.status.state == "FAULT" and not bench.status.motor_enabled
    bench.clear("pressure_rail")
    bench.run(2)
    bench.command("ACK")
    assert bench.status.state == "FAULT"
    assert not bench.command("START").ok
    assert bench.command("RESET").ok
    bench.step()
    assert bench.status.state == "IDLE" and bench.status.alarms == []


@pytest.mark.req("SRS-051")
def test_frozen_pressure_sensor(bench):
    bench.start_infusion("saline", 100, 100)
    bench.inject("pressure_frozen")
    t = bench.run_until(lambda s: s.state == "FAULT", 20)
    assert t == pytest.approx(5, abs=0.5)


@pytest.mark.req("SRS-052")
def test_sensor_link_dropout(bench):
    bench.start_infusion("saline", 100, 100)
    bench.inject("comms_dropout")
    t = bench.run_until(lambda s: s.state == "FAULT", 5)
    assert t is not None and t <= 0.7
    assert bench.status.has_alarm("COMMUNICATION_LOSS")


@pytest.mark.req("SRS-042")
def test_silence_and_reannunciation(bench):
    bench.start_infusion("saline", 100, 100)
    bench.command("PAUSE")
    bench.run(121)
    assert bench.status.has_alarm("PAUSED_TOO_LONG") and bench.status.audible
    assert bench.command("SILENCE").ok
    assert not bench.status.audible and bench.status.silence_ms == 120_000
    bench.command("START")
    bench.inject("air_bubble")
    bench.step()
    assert bench.status.audible  # new alarm cancels silence


@pytest.mark.req("SRS-006")
def test_titration_over_the_wire(bench):
    bench.start_infusion("morphine", 2, 50)
    assert bench.command("TITRATE", rate=4).ok
    bench.step()
    assert bench.status.active_rate == 4
    assert not bench.command("TITRATE", rate=16, confirm=True).ok


@pytest.mark.req("SRS-070")
def test_firmware_rejects_garbage(bench):
    assert bench.fw.raw("FOO bar")[0].startswith("ERR")
    assert bench.fw.raw("SENSOR t=1")[0].startswith("ERR")
    status, _ = bench.fw.status()
    assert status.state == "IDLE"
