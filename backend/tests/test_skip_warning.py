"""Without data/ the SPICE/DEM tests skip, and the summary must say so loudly."""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def test_missing_data_prints_warning_and_reason(tmp_path):
    env = {**os.environ, "NASA_DATA": str(tmp_path / "no-data")}
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "no:xdist"]
        + [str(HERE / "test_precompute.py"), "-k", "utc_input"],
        env=env,
        capture_output=True,
        text=True,
        cwd=HERE,
        check=False,
    )
    assert "WARNING: reference data missing" in r.stdout, r.stdout
    assert "SKIPPED, not passed" in r.stdout
    assert "missing or sha256 mismatch: spice/naif0012.tls" in r.stdout
