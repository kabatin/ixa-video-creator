from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.main import create_app
from src.paths import AUDIO_ROOT_ENV


@pytest.fixture(scope="module")
def client(click_wav: Path) -> TestClient:
    return TestClient(create_app())


@pytest.fixture(autouse=True)
def _audio_root(monkeypatch: pytest.MonkeyPatch, click_wav: Path) -> None:
    monkeypatch.setenv(AUDIO_ROOT_ENV, str(click_wav.parent))


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_analyze_returns_analysis_and_peaks(client: TestClient, click_wav: Path) -> None:
    response = client.post("/analyze", json={"audio_path": click_wav.name})
    assert response.status_code == 200, response.text

    body = response.json()
    assert abs(body["bpm"] - 120.0) <= 2.0, f"実測 BPM = {body['bpm']}"
    assert body["analyzer_version"] == "librosa-v1"
    assert len(body["peaks"]) == 2000
    assert all(0.0 <= p <= 1.0 for p in body["peaks"])
    assert set(body["downbeats"]).issubset(set(body["beats"]))


def test_missing_file_returns_404(client: TestClient) -> None:
    response = client.post("/analyze", json={"audio_path": "nope.wav"})
    assert response.status_code == 404


@pytest.mark.parametrize("raw", ["../escape.wav", "../../etc/passwd", "/etc/hosts"])
def test_path_traversal_returns_400(client: TestClient, raw: str) -> None:
    response = client.post("/analyze", json={"audio_path": raw})
    assert response.status_code == 400


def test_empty_path_is_rejected(client: TestClient) -> None:
    response = client.post("/analyze", json={"audio_path": ""})
    assert response.status_code == 422


def test_undecodable_file_returns_500(client: TestClient, click_wav: Path) -> None:
    broken = click_wav.parent / "broken.wav"
    broken.write_bytes(b"this is not audio")
    response = client.post("/analyze", json={"audio_path": broken.name})
    assert response.status_code == 500
