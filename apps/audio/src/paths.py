"""音声ファイルパスの検証。

HTTP からはパスのみを受け取る（大きな音声を HTTP に乗せない）ため、
`AUDIO_ROOT` 配下に閉じ込める検証がセキュリティ境界そのものになる。
"""

from __future__ import annotations

import os
from pathlib import Path

from .errors import AudioFileNotFoundError, PathNotAllowedError

AUDIO_ROOT_ENV = "AUDIO_ROOT"


def audio_root() -> Path:
    """許可されたルートディレクトリ。既定はカレントディレクトリ。"""
    return Path(os.environ.get(AUDIO_ROOT_ENV, os.getcwd())).resolve()


def resolve_audio_path(raw_path: str, root: Path | None = None) -> Path:
    """`raw_path` を検証して絶対パスへ解決する。

    相対パスは `AUDIO_ROOT` からの相対として扱う。
    `..` を含むパス、およびシンボリックリンク解決後に `AUDIO_ROOT` の外へ出るパスは拒否する。

    Raises:
        PathNotAllowedError: 空文字、`..` を含む、または `AUDIO_ROOT` の外を指す場合。
        AudioFileNotFoundError: 解決先にファイルが存在しない場合。
    """
    if not raw_path or not raw_path.strip():
        raise PathNotAllowedError("audio_path が空です")

    candidate = Path(raw_path)
    if any(part == ".." for part in candidate.parts):
        raise PathNotAllowedError(f"`..` を含むパスは許可されていません: {raw_path}")

    base = root.resolve() if root is not None else audio_root()
    resolved = (candidate if candidate.is_absolute() else base / candidate).resolve()

    if resolved != base and base not in resolved.parents:
        raise PathNotAllowedError(f"AUDIO_ROOT の外を指すパスは許可されていません: {raw_path}")

    if not resolved.is_file():
        raise AudioFileNotFoundError(f"音声ファイルが見つかりません: {raw_path}")

    return resolved
