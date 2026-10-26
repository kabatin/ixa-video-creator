from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.main import create_app
from src.paths import AUDIO_ROOT_ENV
from src.transcribe import (
    Segment,
    TranscriberUnavailableError,
    Word,
    create_whisper_transcriber,
)

REAL_WHISPER_ENV = "RUN_WHISPER_TESTS"


@pytest.fixture(autouse=True)
def _audio_root(monkeypatch: pytest.MonkeyPatch, sine_wav: Path) -> None:
    monkeypatch.setenv(AUDIO_ROOT_ENV, str(sine_wav.parent))


class FakeTranscriber:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self, path: str, *, language: str, initial_prompt: str | None, word_timestamps: bool
    ) -> list[Segment]:
        self.calls.append(
            {"path": path, "language": language, "prompt": initial_prompt, "words": word_timestamps}
        )
        return [
            Segment(
                start=1.04,
                end=4.76,
                text="ねえねずみくん",
                words=[Word(start=1.04, end=2.4, text="ねえ"), Word(start=2.9, end=4.76, text="ねずみくん")],
            )
        ]


def test_transcribe_returns_segments_with_words(sine_wav: Path) -> None:
    fake = FakeTranscriber()
    client = TestClient(create_app(transcriber=fake))
    response = client.post(
        "/transcribe",
        json={"audio_path": sine_wav.name, "initial_prompt": "ねえ、ネズミくん。", "word_timestamps": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "ja"
    assert body["model"] == "small"
    assert body["segments"][0]["words"][1] == {"start": 2.9, "end": 4.76, "text": "ねずみくん"}
    assert fake.calls == [
        {"path": str(sine_wav.resolve()), "language": "ja", "prompt": "ねえ、ネズミくん。", "words": True}
    ]


def test_transcribe_rejects_traversal_and_missing() -> None:
    client = TestClient(create_app(transcriber=FakeTranscriber()))
    assert client.post("/transcribe", json={"audio_path": "../etc/passwd"}).status_code == 400
    assert client.post("/transcribe", json={"audio_path": "nope.wav"}).status_code == 404


def test_transcribe_rejects_other_languages(sine_wav: Path) -> None:
    client = TestClient(create_app(transcriber=FakeTranscriber()))
    response = client.post("/transcribe", json={"audio_path": sine_wav.name, "language": "en"})
    assert response.status_code == 422


def test_transcribe_unavailable_model_is_503(sine_wav: Path) -> None:
    def broken(name: str) -> Any:
        raise TranscriberUnavailableError(f"文字起こしのモデル {name} を読めませんでした")

    client = TestClient(create_app(transcriber=create_whisper_transcriber(load=broken)))
    response = client.post("/transcribe", json={"audio_path": sine_wav.name})
    assert response.status_code == 503
    assert "読めませんでした" in response.json()["detail"]


def test_model_is_loaded_once_and_words_are_rounded(sine_wav: Path) -> None:
    loads: list[str] = []

    class Model:
        def transcribe(self, audio: Any, **kwargs: Any) -> tuple[list[Any], None]:
            assert audio.ndim == 1 and kwargs["word_timestamps"] is True
            word = SimpleNamespace(start=1.23456, end=2.0001, word=" ねえ")
            return [SimpleNamespace(start=1.23456, end=2.0001, text=" ねえ", words=[word])], None

    def load(name: str) -> Model:
        loads.append(name)
        return Model()

    transcriber = create_whisper_transcriber(load=load)
    first = transcriber(str(sine_wav), language="ja", initial_prompt=None, word_timestamps=True)
    transcriber(str(sine_wav), language="ja", initial_prompt=None, word_timestamps=True)
    assert loads == ["small"]
    assert first[0].words[0] == Word(start=1.235, end=2.0, text="ねえ")


@pytest.mark.skipif(os.environ.get(REAL_WHISPER_ENV) != "1", reason="実モデルの確かめは RUN_WHISPER_TESTS=1 のときだけ")
def test_real_whisper_runs_on_synthesized_wav(sine_wav: Path) -> None:
    client = TestClient(create_app())
    response = client.post("/transcribe", json={"audio_path": sine_wav.name})
    assert response.status_code == 200
    assert isinstance(response.json()["segments"], list)
