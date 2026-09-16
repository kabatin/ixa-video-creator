from __future__ import annotations

from pathlib import Path

import pytest

from .fixtures import click_track, sine_wave, two_part_track, write_wav

CLICK_BPM = 120.0
CLICK_DURATION_SEC = 32.0
TWO_PART_BOUNDARY_SEC = 24.0


@pytest.fixture(scope="session")
def audio_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("audio")


@pytest.fixture(scope="session")
def click_wav(audio_dir: Path) -> Path:
    return write_wav(
        audio_dir / "click-120.wav", click_track(bpm=CLICK_BPM, duration_sec=CLICK_DURATION_SEC)
    )


@pytest.fixture(scope="session")
def sine_wav(audio_dir: Path) -> Path:
    return write_wav(audio_dir / "sine-440.wav", sine_wave())


@pytest.fixture(scope="session")
def two_part_wav(audio_dir: Path) -> Path:
    return write_wav(
        audio_dir / "two-part.wav", two_part_track(part_sec=TWO_PART_BOUNDARY_SEC, bpm=CLICK_BPM)
    )
