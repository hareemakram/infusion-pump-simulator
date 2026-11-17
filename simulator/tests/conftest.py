import pytest

from pumpsim.bench import TestBench
from pumpsim.firmware import FirmwareError, find_firmware


def _firmware_available() -> bool:
    try:
        return find_firmware().exists()
    except FirmwareError:
        return False


FIRMWARE_AVAILABLE = _firmware_available()


def pytest_collection_modifyitems(config, items):
    if FIRMWARE_AVAILABLE:
        return
    skip = pytest.mark.skip(reason="pump_firmware not built")
    for item in items:
        if "system" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
def bench():
    b = TestBench()
    yield b
    b.close()
