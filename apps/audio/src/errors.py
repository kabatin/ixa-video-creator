"""apps/audio の例外。呼び出し側が HTTP ステータスへ対応づけられるよう種類を分ける。"""

from __future__ import annotations


class AudioError(Exception):
    """このサービスが送出する例外の基底。"""


class PathNotAllowedError(AudioError):
    """`AUDIO_ROOT` の外を指すパスが渡された（パストラバーサル）。"""


class AudioFileNotFoundError(AudioError):
    """指定されたパスに音声ファイルが存在しない。"""


class AnalysisFailedError(AudioError):
    """解析処理そのものが失敗した。元の例外は `__cause__` に保持する。"""
