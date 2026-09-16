"""UI 描画用のピークデータ生成。"""

from __future__ import annotations

import numpy as np

from .audio_io import load_mono

DEFAULT_BUCKETS = 2000


def compute_peaks(audio_path: str, buckets: int = DEFAULT_BUCKETS) -> list[float]:
    """音声を `buckets` 個に等分し、各区間の絶対値の最大を 0..1 で返す。

    Raises:
        ValueError: `buckets` が 1 未満の場合。
        AnalysisFailedError: 音声の読み込みに失敗した場合。
    """
    if buckets < 1:
        raise ValueError(f"buckets は 1 以上である必要があります: {buckets}")

    samples, _ = load_mono(audio_path)
    magnitude = np.abs(samples.astype(np.float64))
    edges = np.linspace(0, magnitude.size, buckets + 1).astype(np.int64)

    peaks = np.zeros(buckets, dtype=np.float64)
    for i in range(buckets):
        start, end = int(edges[i]), int(edges[i + 1])
        if end > start:
            peaks[i] = float(np.max(magnitude[start:end]))

    return [float(v) for v in np.clip(peaks, 0.0, 1.0)]
