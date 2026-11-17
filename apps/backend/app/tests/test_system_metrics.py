import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import system_service as system


@pytest.fixture
def probes(tmp_path, monkeypatch):
    settings = SimpleNamespace(host_meminfo_path=str(tmp_path / "meminfo"),
                               host_cpuinfo_path=str(tmp_path / "cpuinfo"),
                               host_hardware_file=str(tmp_path / "hardware.json"),
                               host_root_probe_path=str(tmp_path / "root"),
                               host_thermal_path=str(tmp_path / "temp"))
    monkeypatch.setattr(system, "get_settings", lambda: settings)
    return settings


def test_memory_bytes_match_percentage_and_reclaimable_memory(probes):
    Path(probes.host_meminfo_path).write_text("MemTotal: 8388608 kB\nMemFree: 100 kB\nMemAvailable: 6291456 kB\n")
    assert system._read_host_memory() == (25.0, 8 * 1024**3, 2 * 1024**3)


@pytest.mark.parametrize("content", ["", "MemTotal: 0 kB\nMemAvailable: 0 kB", "MemTotal: 8 kB", "MemTotal: 8 kB\nMemAvailable: 9 kB", "MemTotal: invalid kB"])
def test_invalid_memory_stays_unavailable(probes, content):
    Path(probes.host_meminfo_path).write_text(content)
    assert system._read_host_memory() == (None, None, None)


@pytest.mark.parametrize(("content", "expected"), [
    ("processor : 0\nmodel name : Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz\n", "Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz"),
    ("processor : 0\nModel : Raspberry Pi 5 Model B Rev 1.0\n", "Raspberry Pi 5 Model B Rev 1.0"),
    ("processor : 0\nProcessor : ARMv7 Processor rev 4\n", "ARMv7 Processor rev 4"),
    ("processor : 0\n", None),
])
def test_cpu_model_on_x86_and_arm(probes, content, expected):
    Path(probes.host_cpuinfo_path).write_text(content)
    assert system._read_cpu_model() == expected


@pytest.mark.parametrize(("content", "expected"), [('{}', None), ('{"memory_speed_mts":3200}', 3200), ('{"memory_speed_mts":true}', None), ('{"memory_speed_mts":-1}', None), ('{"memory_speed_mts":"3200"}', None), ('[]', None), ('invalid', None)])
def test_speed_snapshot_validation(probes, content, expected):
    Path(probes.host_hardware_file).write_text(content)
    assert system._read_memory_speed() == expected


def test_missing_host_probes_do_not_break_status(probes, monkeypatch):
    def unavailable(_):
        raise OSError("probe missing")
    monkeypatch.setattr(system.psutil, "disk_usage", unavailable)
    monkeypatch.setattr(system.psutil, "cpu_percent", lambda **kwargs: 10)
    monkeypatch.setattr(system, "_local_ip", lambda: None)
    status = system.get_pi_status()
    assert status.cpu_percent == 10
    assert status.cpu_model is None
    assert status.memory_percent is status.memory_total_bytes is status.memory_used_bytes is None
    assert status.disk_percent is status.disk_total_bytes is status.disk_used_bytes is None
    assert status.memory_speed_mts is None


_script = Path(__file__).resolve().parents[4] / "scripts/collect-host-hardware.py"
_spec = importlib.util.spec_from_file_location("collect_host_hardware", _script)
collector = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collector)


@pytest.mark.parametrize(("output", "expected"), [
    ("Memory Device\n Size: 8 GB\n Speed: 3200 MT/s\n Configured Memory Speed: 2666 MT/s\n", 2666),
    ("Memory Device\n Size: No Module Installed\nMemory Device\n Size: 8 GB\n Configured Clock Speed: 2400 MHz\n", 2400),
    ("Memory Device\n Size: 8 GB\n Speed: 3200 MT/s\n", None),
    ("Memory Device\n Configured Memory Speed: Unknown\n", None),
    ("Memory Device\n Configured Memory Speed: 2400 MT/s\nMemory Device\n Configured Memory Speed: 3200 MT/s\n", None),
    ("Memory Device\n Configured Memory Speed: 3200 MT/s\nMemory Device\n Configured Memory Speed: 3200 MT/s\n", 3200),
    ("SMBIOS unavailable", None),
])
def test_collector_uses_only_known_configured_speed(output, expected):
    assert collector.configured_memory_speed(output) == expected
