"""音声の読み込み。解析パラメータの既定値もここに集約する。"""

from __future__ import annotations

import numpy as np
import librosa

from .errors import AnalysisFailedError

#: 解析用のサンプリングレート。BPM / ビート検出にはこれで十分であり、処理も速い。
SAMPLE_RATE = 22050
#: STFT のホップ長。energy_curve の時間分解能（約 23.2 ms）を決める。
HOP_LENGTH = 512


def load_mono(path: str, sr: int = SAMPLE_RATE) -> tuple[np.ndarray, int]:
    """モノラル float32 として読み込む。

    Raises:
        AnalysisFailedError: デコードに失敗した場合（元例外を cause に保持する）。
    """
    try:
        samples, actual_sr = librosa.load(path, sr=sr, mono=True)
    except Exception as exc:  # noqa: BLE001 - 種類を問わず文脈を付けて再送出する
        raise AnalysisFailedError(f"音声の読み込みに失敗しました: {path}") from exc

    if samples.size == 0:
        raise AnalysisFailedError(f"音声が空です: {path}")

    return np.asarray(samples, dtype=np.float32), int(actual_sr)
