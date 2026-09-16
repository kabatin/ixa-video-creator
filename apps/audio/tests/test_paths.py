from __future__ import annotations

from pathlib import Path

import pytest

from src.errors import AudioFileNotFoundError, PathNotAllowedError
from src.paths import resolve_audio_path


def test_relative_path_inside_root_is_allowed(click_wav: Path) -> None:
    resolved = resolve_audio_path(click_wav.name, root=click_wav.parent)
    assert resolved == click_wav.resolve()


def test_absolute_path_inside_root_is_allowed(click_wav: Path) -> None:
    assert resolve_audio_path(str(click_wav), root=click_wav.parent) == click_wav.resolve()


@pytest.mark.parametrize(
    "raw",
    ["../secret.wav", "../../etc/passwd", "sub/../../escape.wav", "..", "./../x.wav"],
)
def test_parent_traversal_is_rejected(raw: str, click_wav: Path) -> None:
    with pytest.raises(PathNotAllowedError):
        resolve_audio_path(raw, root=click_wav.parent)


def test_absolute_path_outside_root_is_rejected(click_wav: Path) -> None:
    with pytest.raises(PathNotAllowedError):
        resolve_audio_path("/etc/hosts", root=click_wav.parent)


def test_symlink_escaping_root_is_rejected(click_wav: Path, tmp_path: Path) -> None:
    outside = tmp_path / "outside.wav"
    outside.write_bytes(b"not audio")
    root = tmp_path / "root"
    root.mkdir()
    (root / "link.wav").symlink_to(outside)
    with pytest.raises(PathNotAllowedError):
        resolve_audio_path("link.wav", root=root)


@pytest.mark.parametrize("raw", ["", "   "])
def test_empty_path_is_rejected(raw: str, click_wav: Path) -> None:
    with pytest.raises(PathNotAllowedError):
        resolve_audio_path(raw, root=click_wav.parent)


def test_missing_file_raises_not_found(click_wav: Path) -> None:
    with pytest.raises(AudioFileNotFoundError):
        resolve_audio_path("no-such-file.wav", root=click_wav.parent)
