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
