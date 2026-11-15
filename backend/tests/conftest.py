"""Serialize NASA data reads and report data-dependent skips in make check."""

import pytest

DATA_SKIP_MARKERS = ("NASA DATA MISSING:", "Horizons reference tables missing")
# These modules skip inside tests/helpers, so no data skip marker exists at collection.
DATA_SKIP_MODULES = {"test_beta_psr.py", "test_earth_windows.py", "test_features.py"}


def pytest_configure(config):
    # Also register it when xdist is disabled (test_skip_warning runs pytest that way).
    config.addinivalue_line("markers", "xdist_group(name): run the group on one xdist worker")


@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(items):
    # Run before xdist appends group names to node IDs for --dist loadgroup.
    for item in items:
        needs_data = any(
            tag in mark.kwargs.get("reason", "")
            for name in ("skip", "skipif")
            for mark in item.iter_markers(name)
            for tag in DATA_SKIP_MARKERS
        )
        if needs_data or item.path.name in DATA_SKIP_MODULES:
            item.add_marker(pytest.mark.xdist_group("nasa_data"))


def pytest_terminal_summary(terminalreporter):
    skipped = []
    for rep in terminalreporter.stats.get("skipped", []):
        reason = rep.longrepr[2] if isinstance(rep.longrepr, tuple) else str(rep.longrepr)
        if any(m in reason for m in DATA_SKIP_MARKERS):
            skipped.append((rep.nodeid, reason.removeprefix("Skipped: ")))
    if not skipped:
        return
    terminalreporter.section("WARNING: reference data missing", sep="!", yellow=True, bold=True)
    terminalreporter.write_line(
        f"{len(skipped)} tests were SKIPPED, not passed. SPICE/LOLA/Horizons checks did not run.",
        yellow=True,
        bold=True,
    )
    for nodeid, reason in skipped:
        terminalreporter.write_line(f"  {nodeid}: {reason}", yellow=True)
