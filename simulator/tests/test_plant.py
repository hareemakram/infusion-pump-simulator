import math

import pytest

from pumpsim.faults import CATALOG, FaultInjector
from pumpsim.plant import Plant, PlantParams

SPS_100 = 100 * 2000 / 3600


def run(plant, faults, seconds, sps=SPS_100, enabled=True):
    frame = None
    for _ in range(int(seconds * 10)):
        frame = plant.step(0.1, enabled, sps, faults)
    return frame


def test_steady_state_pressure_matches_resistance_model():
    p, f = Plant(), FaultInjector()
    frame = run(p, f, 20)
    expected = p.p.venous_pressure + (100 / 3600) * p.p.resistance_down
    assert p.p_down == pytest.approx(expected, abs=1.0)
    assert frame.downstream == pytest.approx(expected, abs=3.0)
    assert p.p_up == pytest.approx(p.p.head_pressure - (100 / 3600) * p.p.resistance_up, abs=1.0)


def test_encoder_tracks_fractional_steps_exactly():
    p, f = Plant(), FaultInjector()
    run(p, f, 36)  # 36 s at 100 mL/h = 1 mL = 2000 steps
    assert abs(p.encoder - 2000) <= 1
    assert p.p.container_ml - p.reservoir_ml == pytest.approx(1.0, abs=0.02)


def test_complete_occlusion_builds_pressure_linearly():
    p, f = Plant(), FaultInjector()
    run(p, f, 5)
    f.inject("downstream_occlusion")
    start = p.p_down
    run(p, f, 10)
    rise_per_s = (p.p_down - start) / 10
    expected = (100 / 3600) / p.p.compliance_down
    assert rise_per_s == pytest.approx(expected, rel=0.05)
    run(p, f, 300)
    assert p.p_down <= p.p.max_pressure


def test_releasing_occlusion_delivers_a_bolus():
    p, f = Plant(), FaultInjector()
    f.inject("downstream_occlusion")
    run(p, f, 20)
    before = p.delivered_to_patient_ml
    stored = (p.p_down - p.p.venous_pressure) * p.p.compliance_down
    f.clear("downstream_occlusion")
    run(p, f, 5, enabled=False)
    bolus = p.delivered_to_patient_ml - before
    # The volume stored in the compliant line goes to the patient (see RISK-H02).
    assert bolus == pytest.approx(stored, rel=0.05)
    assert bolus > 0.3


def test_upstream_occlusion_pulls_vacuum_and_stops_fluid():
    p, f = Plant(), FaultInjector()
    run(p, f, 5)
    f.inject("upstream_occlusion")
    run(p, f, 30)
    assert p.p_up < -150
    level = p.reservoir_ml
    run(p, f, 10)
    assert p.reservoir_ml == level


def test_air_bubble_is_a_single_pulse():
    p, f = Plant(), FaultInjector()
    f.inject("air_bubble", volume_ul=120)
    first = p.step(0.1, True, SPS_100, f)
    second = p.step(0.1, True, SPS_100, f)
    assert first.air_ul == 120 and second.air_ul == 0


def test_micro_bubbles_repeat():
    p, f = Plant(), FaultInjector()
    f.inject("micro_bubbles")
    total = 0.0
    for _ in range(100):
        total += p.step(0.1, True, SPS_100, f).air_ul
    assert total == pytest.approx(150.0)


def test_empty_container_pumps_air():
    p, f = Plant(), FaultInjector()
    f.inject("container_dry", remaining_ml=0.2)
    frame = run(p, f, 30, sps=400 * 2000 / 3600)
    assert frame.reservoir_ml == 0.0
    assert p.air_to_patient_ul > 0
    p.hang_new_container()
    assert p.reservoir_ml == p.p.container_ml


def test_motor_faults():
    p, f = Plant(), FaultInjector()
    f.inject("motor_stall")
    run(p, f, 5)
    assert p.encoder == 0
    f.clear("motor_stall")
    f.inject("motor_runaway")
    run(p, f, 1, enabled=False)
    assert p.encoder == pytest.approx(PlantParams().runaway_idle_sps, abs=1)


def test_sensor_faults():
    p, f = Plant(), FaultInjector()
    run(p, f, 2)
    f.inject("pressure_frozen")
    readings = {p.step(0.1, True, SPS_100, f).downstream for _ in range(20)}
    assert len(readings) == 1
    f.clear("pressure_frozen")
    f.inject("pressure_rail")
    assert p.step(0.1, True, SPS_100, f).downstream == PlantParams().rail_reading_mmhg
    f.inject("comms_dropout")
    assert p.step(0.1, True, SPS_100, f) is None


def test_noise_is_seeded_and_reproducible():
    a = [Plant(seed=3).step(0.1, False, 0, FaultInjector()).downstream for _ in range(1)]
    b = [Plant(seed=3).step(0.1, False, 0, FaultInjector()).downstream for _ in range(1)]
    assert a == b


def test_fault_injector_semantics():
    f = FaultInjector()
    with pytest.raises(KeyError):
        f.inject("gremlins")
    with pytest.raises(KeyError):
        f.clear("gremlins")
    f.inject("downstream_occlusion", severity="partial")
    assert f.active("downstream_occlusion") and f.params("downstream_occlusion")["severity"] == "partial"
    f.inject("air_bubble")
    assert not f.active("air_bubble")
    assert f.take_pulses()[0][0] == "air_bubble" and f.take_pulses() == []
    f.clear_all()
    assert f.active_ids == []
    assert all(spec.to_dict()["expected_alarm"] for spec in CATALOG)
    assert len({spec.id for spec in CATALOG}) == len(CATALOG)
    assert not math.isnan(PlantParams().max_pressure)
