"""解析結果のスキーマ。

`packages/domain/src/music/music.ts` の `MusicAnalysis` / `MusicSection` に対応する。
TS 側（`@ixa/music`）が snake_case → camelCase へ変換して受け取るため、
ここでのフィールド名は snake_case を維持する。
"""

from __future__ import annotations

from pydantic import BaseModel, Field

#: v2（PHASE 8.1）: 波形に音の大きさと 3 帯域を足した。拍・セクションの求め方は v1 と同じ。
#: 版を上げるのは、既存の曲を「再解析」で v2 の波形にできるようにするため
#: （worker は同じ版の解析があれば何もしない）。
ANALYZER_VERSION = "librosa-v2"

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


class WaveformBands(BaseModel):
    """3 帯域の強さ（各 0..1）。低 = キック・ベース、中 = 歌、高 = ハイハット。"""

    low: list[float]
    mid: list[float]
    high: list[float]


class AnalyzeResponse(AnalysisResult):
    """HTTP 応答。解析結果に UI 描画用の波形を加えたもの。"""

    peaks: list[float]
    #: 音の大きさ（区間ごとの RMS を最大で割ったもの）。v2 から。
    rms: list[float]
    bands: WaveformBands
