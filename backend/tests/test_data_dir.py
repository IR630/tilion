"""The data lookup of the tests: env, parents of the tests, then the main checkout of a worktree."""

from pathlib import Path

from test_precompute import resolve_data_dir


def _fill(root: Path) -> Path:
    (root / "data" / "spice").mkdir(parents=True)
    (root / "data" / "spice" / "naif0012.tls").write_text("x")
    return root / "data"


def test_worktree_outside_repo_falls_back_to_common_dir_data(tmp_path):
    main = tmp_path / "main"
    data = _fill(main)
    here = tmp_path / "elsewhere" / "wt" / "backend" / "tests" / "test_x.py"
    here.parent.mkdir(parents=True)
    assert resolve_data_dir(here, {}, lambda cwd: main / ".git") == data


def test_local_data_wins_over_common_dir(tmp_path):
    local = _fill(tmp_path / "wt")
    other = tmp_path / "main"
    _fill(other)
    here = tmp_path / "wt" / "backend" / "tests" / "test_x.py"
    here.parent.mkdir(parents=True)
    assert resolve_data_dir(here, {}, lambda cwd: other / ".git") == local


def test_env_wins_and_nothing_found_is_none(tmp_path):
    here = tmp_path / "wt" / "tests" / "test_x.py"
    here.parent.mkdir(parents=True)
    assert resolve_data_dir(here, {"NASA_DATA": "/some/dir"}, lambda cwd: None) == Path("/some/dir")
    assert resolve_data_dir(here, {}, lambda cwd: tmp_path / "nope" / ".git") is None
    assert resolve_data_dir(here, {}, lambda cwd: None) is None


def test_real_git_common_dir_points_to_a_checkout():
    from test_precompute import HERE, _git_common_dir

    common = _git_common_dir(HERE.parent)
    assert common is not None and common.name == ".git"
