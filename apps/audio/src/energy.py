"""エネルギー曲線・オンセット・ドロップの検出。すべて決定的な処理（ADR-0009）。"""

from __future__ import annotations

import numpy as np
import librosa

from .audio_io import HOP_LENGTH
from .models import EnergyCurve

#: ドロップ判定に使う立ち上がりの観測窓（秒）。
DROP_WINDOW_SEC = 0.75
#: ドロップ同士の最小間隔（秒）。同じ盛り上がりを複数回拾わないため。
DROP_MIN_GAP_SEC = 4.0
#: 立ち上がり量の下限。曲全体が平坦なときに微細な揺らぎを拾わないための床。
DROP_MIN_RISE = 0.18


def compute_energy_curve(samples: np.ndarray, sr: int, hop_length: int = HOP_LENGTH) -> EnergyCurve:
    """RMS を 0..1 に正規化したエネルギー曲線を返す。"""
    rms = librosa.feature.rms(y=samples, hop_length=hop_length)[0]
    peak = float(np.max(rms)) if rms.size > 0 else 0.0
    normalized = rms / peak if peak > 0.0 else np.zeros_like(rms)
    values = np.clip(normalized, 0.0, 1.0)
    return EnergyCurve(hop_sec=hop_length / sr, values=[float(v) for v in values])


def detect_onsets(samples: np.ndarray, sr: int, hop_length: int = HOP_LENGTH) -> list[float]:
    """オンセット時刻（秒）。"""
    onsets = librosa.onset.onset_detect(
        y=samples, sr=sr, hop_length=hop_length, units="time", backtrack=False
    )
    return [float(t) for t in np.atleast_1d(onsets)]


def detect_drops(curve: EnergyCurve) -> list[float]:
    """エネルギー曲線の急峻な立ち上がりを閾値検出する。

    `DROP_WINDOW_SEC` 前との差分を立ち上がり量とし、
    「平均 + 2σ」と `DROP_MIN_RISE` のうち大きい方を閾値にする。
    近接するピークは `DROP_MIN_GAP_SEC` で間引く。
    """
    values = np.asarray(curve.values, dtype=np.float64)
    if values.size < 4:
        return []

    window = max(1, int(round(DROP_WINDOW_SEC / curve.hop_sec)))
    if values.size <= window:
        return []

    rise = values[window:] - values[:-window]
    threshold = max(float(np.mean(rise) + 2.0 * np.std(rise)), DROP_MIN_RISE)

    min_gap_sec = DROP_MIN_GAP_SEC
    accepted: list[float] = []

    # 立ち上がりの強い順に採用し、既採用と近すぎるものは捨てる（貪欲な非最大抑制）。
    for index in np.argsort(rise)[::-1]:
        if rise[index] < threshold:
            break
        time_sec = (int(index) + window) * curve.hop_sec
        if all(abs(time_sec - taken) >= min_gap_sec for taken in accepted):
            accepted.append(time_sec)

    return sorted(float(t) for t in accepted)


def mean_energy_between(curve: EnergyCurve, start_sec: float, end_sec: float) -> float:
    """区間 [start, end) の平均エネルギー。区間が空ならその時点の値を返す。"""
    values = np.asarray(curve.values, dtype=np.float64)
    if values.size == 0:
        return 0.0

    start_frame = max(0, int(np.floor(start_sec / curve.hop_sec)))
    end_frame = min(values.size, int(np.ceil(end_sec / curve.hop_sec)))
    if end_frame <= start_frame:
        index = min(values.size - 1, start_frame)
        return float(np.clip(values[index], 0.0, 1.0))

    return float(np.clip(np.mean(values[start_frame:end_frame]), 0.0, 1.0))
