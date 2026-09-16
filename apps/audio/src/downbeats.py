"""ダウンビート（小節頭）の推定。

librosa には専用機能が無いため自前実装する（ADR-0009）。
拍子は 4/4 を既定とし、ビートグリッド上でオンセット強度が最も強い位相を小節頭とみなす。
戻り値は必ずビートの部分集合になる。
"""

from __future__ import annotations

import numpy as np

DEFAULT_BEATS_PER_BAR = 4


def estimate_downbeats(
    beats: list[float],
    onset_envelope: np.ndarray,
    onset_times: np.ndarray,
    beats_per_bar: int = DEFAULT_BEATS_PER_BAR,
) -> list[float]:
    """小節頭を推定する。

    Args:
        beats: ビート時刻（秒、昇順）。
        onset_envelope: オンセット強度（フレーム列）。
        onset_times: `onset_envelope` の各フレームに対応する時刻（秒）。
        beats_per_bar: 1 小節あたりの拍数。既定 4（4/4 拍子）。

    Returns:
        ビートの部分集合。`beats_per_bar` 拍ごとに 1 つ。
    """
    if beats_per_bar < 1:
        raise ValueError(f"beats_per_bar は 1 以上である必要があります: {beats_per_bar}")
    if len(beats) < beats_per_bar:
        return list(beats[:1])

    strengths = strength_at_times(beats, onset_envelope, onset_times)

    # 位相ごとの平均強度を比べ、最も強い位相を小節頭とする。
    best_phase = 0
    best_score = -np.inf
    for phase in range(beats_per_bar):
        score = float(np.mean(strengths[phase::beats_per_bar]))
        if score > best_score:
            best_score = score
            best_phase = phase

    return [float(t) for t in beats[best_phase::beats_per_bar]]


def strength_at_times(
    times: list[float], onset_envelope: np.ndarray, onset_times: np.ndarray
) -> np.ndarray:
    """各時刻の近傍 1 フレーム以内で最大のオンセット強度を取り出す。

    ビート時刻とフレーム境界は一致しないため、前後 1 フレームまで見て取りこぼしを防ぐ。
    """
    if onset_envelope.size == 0 or onset_times.size == 0 or len(times) == 0:
        return np.zeros(len(times), dtype=np.float64)

    center = np.clip(
        np.searchsorted(onset_times, np.asarray(times, dtype=np.float64)),
        0,
        onset_envelope.size - 1,
    )
    lower = np.clip(center - 1, 0, onset_envelope.size - 1)
    upper = np.clip(center + 1, 0, onset_envelope.size - 1)
    stacked = np.stack([onset_envelope[lower], onset_envelope[center], onset_envelope[upper]])
    return np.asarray(np.max(stacked, axis=0), dtype=np.float64)
