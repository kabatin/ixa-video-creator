"""テスト音源の生成。バイナリはコミットせず、numpy で毎回合成する。"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

SAMPLE_RATE = 22050
ACCENT_EVERY = 4


def click_track(
    bpm: float = 120.0,
    duration_sec: float = 32.0,
    sr: int = SAMPLE_RATE,
    accent_every: int = ACCENT_EVERY,
) -> np.ndarray:
    """既知の BPM のクリックトラック。`accent_every` 拍ごとにアクセントを置く。

    アクセントがあることで小節頭の位相が一意に決まり、ダウンビート推定を検証できる。
    """
    total = int(round(duration_sec * sr))
    signal = np.zeros(total, dtype=np.float32)
    beat_interval = 60.0 / bpm
    click = _click_burst(sr)

    beat_index = 0
    while True:
        start = int(round(beat_index * beat_interval * sr))
        if start >= total:
            break
        amplitude = 1.0 if beat_index % accent_every == 0 else 0.45
        end = min(total, start + click.size)
        signal[start:end] += click[: end - start] * amplitude
        beat_index += 1

    return np.clip(signal, -1.0, 1.0)


def two_part_track(
    part_sec: float = 24.0, bpm: float = 120.0, sr: int = SAMPLE_RATE
) -> np.ndarray:
    """前半は静かで疎、後半はベースが加わって密。セクション境界が 1 つある音源。"""
    quiet = click_track(bpm=bpm, duration_sec=part_sec, sr=sr) * 0.25
    t = np.arange(int(round(part_sec * sr)), dtype=np.float32) / sr
    bass = (0.4 * np.sin(2.0 * np.pi * 110.0 * t)).astype(np.float32)
    loud = click_track(bpm=bpm, duration_sec=part_sec, sr=sr) + bass
    return np.clip(np.concatenate([quiet, loud]), -1.0, 1.0).astype(np.float32)


def sine_wave(
    frequency: float = 440.0, duration_sec: float = 2.0, sr: int = SAMPLE_RATE
) -> np.ndarray:
    """定常な正弦波。ビートを持たない音源として使う。"""
    t = np.arange(int(round(duration_sec * sr)), dtype=np.float32) / sr
    return (0.5 * np.sin(2.0 * np.pi * frequency * t)).astype(np.float32)


def write_wav(path: Path, signal: np.ndarray, sr: int = SAMPLE_RATE) -> Path:
    sf.write(str(path), signal, sr, subtype="PCM_16")
    return path


def _click_burst(sr: int, length_sec: float = 0.04) -> np.ndarray:
    """指数減衰するブロードバンドのバースト。オンセットとして検出されやすい。"""
    length = int(round(length_sec * sr))
    t = np.arange(length, dtype=np.float32) / sr
    envelope = np.exp(-t * 90.0).astype(np.float32)
    tone = np.sin(2.0 * np.pi * 2000.0 * t).astype(np.float32)
    noise = np.random.default_rng(12345).standard_normal(length).astype(np.float32) * 0.35
    return (tone + noise) * envelope
