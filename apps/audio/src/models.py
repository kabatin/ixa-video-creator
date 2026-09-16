"""解析結果のスキーマ。

`packages/domain/src/music/music.ts` の `MusicAnalysis` / `MusicSection` に対応する。
TS 側（`@ixa/music`）が snake_case → camelCase へ変換して受け取るため、
ここでのフィールド名は snake_case を維持する。
"""

from __future__ import annotations

from pydantic import BaseModel, Field

ANALYZER_VERSION = "librosa-v1"

# セクションのラベル命名は LLM が TS 側で行う（ARCHITECTURE.md §14 / ADR-0009）。
# このサービスは境界とエネルギーのみを出し、ラベルは常にこの仮値を入れる。
PROVISIONAL_SECTION_LABEL = "verse"


class Section(BaseModel):
    """楽曲区間。`label` は仮値であり、命名は TS 側の責務。"""

    start: float = Field(ge=0.0)
    end: float = Field(ge=0.0)
    label: str
    energy: float = Field(ge=0.0, le=1.0)


class EnergyCurve(BaseModel):
    """RMS を 0..1 に正規化したエネルギー曲線。`values[i]` の時刻は `i * hop_sec` 秒。"""

    hop_sec: float = Field(gt=0.0)
    values: list[float]


class AnalysisResult(BaseModel):
    """`analyze()` の戻り値。"""

    bpm: float = Field(gt=0.0)
    bpm_confidence: float = Field(ge=0.0, le=1.0)
    beats: list[float]
    downbeats: list[float]
    sections: list[Section]
    energy_curve: EnergyCurve
    onsets: list[float]
    drops: list[float]
    duration_sec: float = Field(ge=0.0)
    analyzer_version: str = ANALYZER_VERSION


class AnalyzeResponse(AnalysisResult):
    """HTTP 応答。解析結果に UI 描画用のピークを加えたもの。"""

    peaks: list[float]
