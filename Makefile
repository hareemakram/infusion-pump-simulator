# Convenience targets. Each one is a thin wrapper around the native tool.
BUILD ?= build
PY ?= python3
export PYTHONPATH := simulator

.PHONY: all firmware test test-cpp test-py test-ui test-e2e ui serve dev scenarios trace coverage clean

all: firmware ui

firmware:
	cmake -S . -B $(BUILD) -G Ninja -DCMAKE_BUILD_TYPE=Debug
	cmake --build $(BUILD)

ui:
	cd ui && npm ci && npm run build

serve: firmware
	$(PY) -m pumpsim serve

test: test-cpp test-py test-ui test-e2e trace

test-cpp: firmware
	mkdir -p reports
	$(BUILD)/firmware/pump_tests --gtest_output=xml:reports/gtest.xml

test-py: firmware
	mkdir -p reports
	$(PY) -m pytest --junitxml=reports/pytest.xml

test-ui:
	cd ui && npx jest --coverage

test-e2e:
	cd ui && CI=1 npx playwright test

scenarios: firmware
	$(PY) -m pumpsim scenarios --markdown docs/generated/fault-response-report.md

trace:
	$(PY) tools/trace.py --strict

coverage:
	cmake -S . -B build-cov -G Ninja -DPUMP_COVERAGE=ON
	cmake --build build-cov
	build-cov/firmware/pump_tests
	PUMP_FIRMWARE=build-cov/firmware/pump_firmware $(PY) -m pytest -q --cov=pumpsim --cov-report=term
	gcovr -r . --filter firmware/src --filter firmware/include --print-summary

clean:
	rm -rf $(BUILD) build-cov reports ui/dist
