from __future__ import annotations

from pathlib import Path

import pytest

from src.waveform import compute_peaks


def test_returns_requested_bucket_count(click_wav: Path) -> None:
    assert len(compute_peaks(str(click_wav), buckets=500)) == 500


def test_peaks_are_within_unit_range(click_wav: Path) -> None:
    peaks = compute_peaks(str(click_wav), buckets=200)
    assert all(0.0 <= p <= 1.0 for p in peaks)
    assert max(peaks) > 0.0


def test_more_buckets_than_samples_is_safe(sine_wav: Path) -> None:
    peaks = compute_peaks(str(sine_wav), buckets=1_000_000)
    assert len(peaks) == 1_000_000
    assert all(0.0 <= p <= 1.0 for p in peaks)


def test_invalid_bucket_count_raises(click_wav: Path) -> None:
    with pytest.raises(ValueError):
        compute_peaks(str(click_wav), buckets=0)


# --- v2（PHASE 8.1） ---

from src.waveform import compute_waveform_v2  # noqa: E402

from .fixtures import sine_wave, write_wav  # noqa: E402


def test_v2_returns_all_series_with_bucket_count(click_wav: Path) -> None:
    wave = compute_waveform_v2(str(click_wav), buckets=300)
    for series in (wave.peaks, wave.rms, wave.low, wave.mid, wave.high):
        assert len(series) == 300
        assert all(0.0 <= v <= 1.0 for v in series)


def test_v2_low_tone_lands_in_low_band(audio_dir: Path) -> None:
    """60Hz の正弦波は低域に、低域以外はほぼ 0。帯域の取り違えを止める。"""
    path = write_wav(audio_dir / "sine-60.wav", sine_wave(frequency=60.0))
    wave = compute_waveform_v2(str(path), buckets=50)
    assert max(wave.low) == 1.0
    assert sum(wave.low) > 10 * sum(wave.high)
    assert sum(wave.low) > 10 * sum(wave.mid)


def test_v2_high_tone_lands_in_high_band(audio_dir: Path) -> None:
    path = write_wav(audio_dir / "sine-8k.wav", sine_wave(frequency=8000.0))
    wave = compute_waveform_v2(str(path), buckets=50)
    assert sum(wave.high) > 10 * sum(wave.low)


def test_v2_quiet_and_loud_parts_differ_in_rms(two_part_wav: Path) -> None:
    """前半は静か（0.25 倍）。RMS なら前半と後半の差が出る。"""
    wave = compute_waveform_v2(str(two_part_wav), buckets=100)
    first = sum(wave.rms[:40]) / 40
    second = sum(wave.rms[60:]) / 40
    assert second > first * 1.5


def test_v2_invalid_bucket_count_raises(click_wav: Path) -> None:
    with pytest.raises(ValueError):
        compute_waveform_v2(str(click_wav), buckets=0)
