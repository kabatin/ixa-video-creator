from __future__ import annotations

from pathlib import Path

import pytest

from src.analyzer import analyze
from src.models import AnalysisResult

from .conftest import TWO_PART_BOUNDARY_SEC

#: 境界の許容誤差（秒）。拍単位でしか境界を置けないため、拍 1 つ分より広くとる。
BOUNDARY_TOLERANCE_SEC = 2.0


@pytest.fixture(scope="module")
def result(two_part_wav: Path) -> AnalysisResult:
    return analyze(str(two_part_wav))


def test_finds_the_structural_boundary(result: AnalysisResult) -> None:
    """Laplacian segmentation が実際の切り替わり位置を見つけることを確かめる。"""
    internal = [s.start for s in result.sections[1:]]
    assert internal, f"境界が検出されていない: {result.sections}"
    nearest = min(internal, key=lambda t: abs(t - TWO_PART_BOUNDARY_SEC))
    assert abs(nearest - TWO_PART_BOUNDARY_SEC) <= BOUNDARY_TOLERANCE_SEC, f"境界={internal}"


def test_section_energy_reflects_loudness(result: AnalysisResult) -> None:
    """静かな前半より賑やかな後半の方がエネルギーが高い。"""
    quiet = result.sections[0]
    loud = result.sections[-1]
    assert quiet.energy < loud.energy


def test_sections_cover_the_whole_track(result: AnalysisResult) -> None:
    assert result.sections[0].start == pytest.approx(0.0)
    assert result.sections[-1].end == pytest.approx(result.duration_sec)
    for previous, current in zip(result.sections, result.sections[1:]):
        assert previous.end == pytest.approx(current.start)


def test_drop_is_detected_at_the_energy_rise(result: AnalysisResult) -> None:
    assert result.drops, "ドロップが検出されていない"
    nearest = min(result.drops, key=lambda t: abs(t - TWO_PART_BOUNDARY_SEC))
    assert abs(nearest - TWO_PART_BOUNDARY_SEC) <= BOUNDARY_TOLERANCE_SEC, f"drops={result.drops}"
