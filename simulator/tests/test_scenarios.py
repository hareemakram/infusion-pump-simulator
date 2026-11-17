import pytest

from pumpsim.__main__ import main
from pumpsim.scenarios import SCENARIOS, run_scenario, to_markdown

pytestmark = pytest.mark.system


@pytest.mark.req("SRS-030", "SRS-033", "SRS-036", "SRS-052")
@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.fault + "-" + str(int(s.rate_ml_h)))
def test_every_fault_scenario_is_detected_and_stops_the_motor(scenario):
    result = run_scenario(scenario)
    assert result.detected, f"{scenario.expected_alarm} not raised within {scenario.timeout_s} s"
    assert result.motor_stopped
    assert result.final_state in ("ALARM", "FAULT")


def test_markdown_report(tmp_path):
    result = run_scenario(SCENARIOS[5])
    table = to_markdown([result])
    assert "| Single 80 uL air bubble |" in table and "PASS" in table


def test_cli_lists_faults(capsys):
    assert main(["faults"]) == 0
    assert "downstream_occlusion" in capsys.readouterr().out
