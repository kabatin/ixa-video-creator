"""UI 描画用のピークデータ生成。"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
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
    return compute_peaks_from_samples(samples.astype(np.float64), buckets)


def compute_peaks_from_samples(samples: np.ndarray, buckets: int) -> list[float]:
    """読み込み済みの音から、各区間の絶対値の最大を 0..1 で返す。"""
    magnitude = np.abs(samples)
    edges = np.linspace(0, magnitude.size, buckets + 1).astype(np.int64)

    peaks = np.zeros(buckets, dtype=np.float64)
    for i in range(buckets):
        start, end = int(edges[i]), int(edges[i + 1])
        if end > start:
            peaks[i] = float(np.max(magnitude[start:end]))

    return [float(v) for v in np.clip(peaks, 0.0, 1.0)]


# --- v2（PHASE 8.1）: 音の大きさと 3 帯域 ---------------------------------------

#: 帯域の境目（Hz）。低 = キック・ベース、中 = 歌・メロディ、高 = ハイハット・シンバル。
LOW_MAX_HZ = 250.0
MID_MAX_HZ = 4000.0
_N_FFT = 2048
_HOP = 512


@dataclass(frozen=True)
class WaveformV2:
    """UI 描画用の波形。各配列は `buckets` 個、0..1。

    **振幅の最大（peaks）だけでは、音圧を揃えた曲が平らな四角になる**（本制作の曲で
    2000 点の 90% が 0.71〜0.77 に収まった）。曲の構造は帯域の中身に出るので、
    音の大きさ（rms）と 3 帯域の強さを一緒に返す。
    """

    peaks: list[float]
    rms: list[float]
    low: list[float]
    mid: list[float]
    high: list[float]


def _normalize(values: np.ndarray) -> list[float]:
    """最大で割って 0..1 に。無音（最大 0）は全部 0。"""
    top = float(np.max(values)) if values.size else 0.0
    if top <= 0.0:
        return [0.0] * int(values.size)
    return [float(v) for v in np.clip(values / top, 0.0, 1.0)]


def _bucket_mean(frames: np.ndarray, buckets: int) -> np.ndarray:
    """フレーム列を `buckets` 個に等分して平均する。フレームより多い区間は近いフレームを使う。"""
    if frames.size == 0:
        return np.zeros(buckets, dtype=np.float64)
    edges = np.linspace(0, frames.size, buckets + 1)
    out = np.zeros(buckets, dtype=np.float64)
    for i in range(buckets):
        start = int(np.floor(edges[i]))
        end = max(int(np.ceil(edges[i + 1])), start + 1)
        out[i] = float(np.mean(frames[min(start, frames.size - 1) : min(end, frames.size)]))
    return out


def compute_waveform_v2(audio_path: str, buckets: int = DEFAULT_BUCKETS) -> WaveformV2:
    """振幅の最大・音の大きさ（RMS）・3 帯域の強さを `buckets` 個ずつ返す。

    Raises:
        ValueError: `buckets` が 1 未満の場合。
        AnalysisFailedError: 音声の読み込みに失敗した場合。
    """
    if buckets < 1:
        raise ValueError(f"buckets は 1 以上である必要があります: {buckets}")

    samples, sr = load_mono(audio_path)
    signal = samples.astype(np.float64)
    peaks = compute_peaks_from_samples(signal, buckets)

    edges = np.linspace(0, signal.size, buckets + 1).astype(np.int64)
    rms = np.zeros(buckets, dtype=np.float64)
    for i in range(buckets):
        start, end = int(edges[i]), int(edges[i + 1])
        if end > start:
            rms[i] = float(np.sqrt(np.mean(signal[start:end] ** 2)))

    spectrum = np.abs(librosa.stft(signal.astype(np.float32), n_fft=_N_FFT, hop_length=_HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=_N_FFT)

    def band(lo: float, hi: float) -> np.ndarray:
        rows = spectrum[(freqs >= lo) & (freqs < hi)]
        return rows.mean(axis=0) if rows.size else np.zeros(spectrum.shape[1])

    low = _bucket_mean(band(20.0, LOW_MAX_HZ), buckets)
    mid = _bucket_mean(band(LOW_MAX_HZ, MID_MAX_HZ), buckets)
    high = _bucket_mean(band(MID_MAX_HZ, sr / 2.0 + 1.0), buckets)
    # **3 帯域は同じ物差しで割る。** 帯域ごとに割ると、どれも最大が 1 になり
    # 「この区間は低域が強い」という比が消える（色分けの根拠が無くなる）。
    shared = float(max(np.max(low), np.max(mid), np.max(high)))
    scale = shared if shared > 0.0 else 1.0

    return WaveformV2(
        peaks=peaks,
        rms=_normalize(rms),
        low=[float(v) for v in np.clip(low / scale, 0.0, 1.0)],
        mid=[float(v) for v in np.clip(mid / scale, 0.0, 1.0)],
        high=[float(v) for v in np.clip(high / scale, 0.0, 1.0)],
    )
