from __future__ import annotations

from pathlib import Path

import pytest

from src.analyzer import analyze
from src.models import PROVISIONAL_SECTION_LABEL, AnalysisResult

from .conftest import CLICK_BPM, CLICK_DURATION_SEC

BEATS_PER_BAR = 4
BPM_TOLERANCE = 2.0
BEAT_COUNT_TOLERANCE_RATIO = 0.10


@pytest.fixture(scope="module")
def result(click_wav: Path) -> AnalysisResult:
    return analyze(str(click_wav))


def test_bpm_matches_known_click_track(result: AnalysisResult) -> None:
    assert abs(result.bpm - CLICK_BPM) <= BPM_TOLERANCE, f"実測 BPM = {result.bpm}"


def test_bpm_confidence_is_normalized(result: AnalysisResult) -> None:
    assert 0.0 <= result.bpm_confidence <= 1.0


def test_beat_count_is_close_to_expected(result: AnalysisResult) -> None:
    expected = CLICK_DURATION_SEC * CLICK_BPM / 60.0
    tolerance = expected * BEAT_COUNT_TOLERANCE_RATIO
    assert abs(len(result.beats) - expected) <= tolerance, (
        f"beats={len(result.beats)} expected≈{expected}"
    )


def test_beats_are_sorted_and_within_duration(result: AnalysisResult) -> None:
    assert result.beats == sorted(result.beats)
    assert all(0.0 <= t <= result.duration_sec for t in result.beats)


def test_downbeats_are_a_subset_of_beats(result: AnalysisResult) -> None:
    beats = set(result.beats)
    assert result.downbeats, "ダウンビートが検出されていない"
    assert all(t in beats for t in result.downbeats)


def test_downbeats_are_spaced_about_four_beats(result: AnalysisResult) -> None:
    expected_gap = BEATS_PER_BAR * 60.0 / CLICK_BPM
    gaps = [b - a for a, b in zip(result.downbeats, result.downbeats[1:])]
    assert gaps, "ダウンビートが 2 つ未満"
    assert all(abs(gap - expected_gap) <= 0.1 for gap in gaps), f"gaps={gaps}"


def test_downbeats_land_on_accented_beats(result: AnalysisResult) -> None:
    """アクセントは 0 秒から 2 秒周期で置かれている。位相が合っていることを確かめる。"""
    period = BEATS_PER_BAR * 60.0 / CLICK_BPM
    offsets = [t % period for t in result.downbeats]
    assert all(offset <= 0.1 or period - offset <= 0.1 for offset in offsets), f"offsets={offsets}"


def test_energy_curve_values_are_normalized(result: AnalysisResult) -> None:
    assert result.energy_curve.hop_sec > 0.0
    assert result.energy_curve.values
    assert all(0.0 <= v <= 1.0 for v in result.energy_curve.values)


def test_sections_are_ordered_and_contiguous(result: AnalysisResult) -> None:
    assert result.sections
    assert result.sections[0].start == pytest.approx(0.0)
    assert result.sections[-1].end == pytest.approx(result.duration_sec)
    for previous, current in zip(result.sections, result.sections[1:]):
        assert previous.end == pytest.approx(current.start), "隙間または重なりがある"
    for section in result.sections:
        assert section.end > section.start
        assert 0.0 <= section.energy <= 1.0


def test_sections_are_not_labelled_here(result: AnalysisResult) -> None:
    """ラベル命名は TS 側の LLM が行う（ARCHITECTURE.md §14）。ここでは常に仮ラベル。"""
    assert {s.label for s in result.sections} == {PROVISIONAL_SECTION_LABEL}


def test_onsets_and_drops_are_sorted_within_duration(result: AnalysisResult) -> None:
    assert result.onsets == sorted(result.onsets)
    assert result.drops == sorted(result.drops)
    assert all(0.0 <= t <= result.duration_sec for t in result.onsets + result.drops)


def test_analyzer_version_is_fixed(result: AnalysisResult) -> None:
    assert result.analyzer_version == "librosa-v1"
