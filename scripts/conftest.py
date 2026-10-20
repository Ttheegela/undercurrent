import pytest

import build_official_lists as b


@pytest.fixture(autouse=True)
def raw_dir(tmp_path, monkeypatch):
    path = tmp_path / "raw"  # keeps every test off the real build/raw
    monkeypatch.setattr(b, "RAW_DIR", path)
    return path
