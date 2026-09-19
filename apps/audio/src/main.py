"""FastAPI アプリ。

ファイルは受け取らず**パスだけ**を受け取る（同一ホストで動く前提。
大きな音声を HTTP に乗せない）。パスは必ず `AUDIO_ROOT` 配下へ閉じ込める。
"""

from __future__ import annotations

import os

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .analyzer import analyze
from .errors import AudioError, AudioFileNotFoundError, PathNotAllowedError
from .models import AnalyzeResponse, WaveformBands
from .paths import resolve_audio_path
from .waveform import DEFAULT_BUCKETS, compute_waveform_v2

DEFAULT_PORT = 8100
DEFAULT_HOST = "127.0.0.1"


class AnalyzeRequest(BaseModel):
    """解析対象。`AUDIO_ROOT` からの相対パス、または `AUDIO_ROOT` 配下の絶対パス。"""

    audio_path: str = Field(min_length=1)


class HealthResponse(BaseModel):
    status: str


def create_app() -> FastAPI:
    """アプリを組み立てる。import 時に副作用を起こさないよう関数に閉じる（CLAUDE.md §7b）。"""
    app = FastAPI(title="iXA Audio Analysis", version="0.1.0")

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.post("/analyze", response_model=AnalyzeResponse)
    def analyze_endpoint(request: AnalyzeRequest) -> AnalyzeResponse:
        try:
            path = resolve_audio_path(request.audio_path)
        except PathNotAllowedError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except AudioFileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        try:
            result = analyze(str(path))
            wave = compute_waveform_v2(str(path), DEFAULT_BUCKETS)
        except AudioError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - 想定外も文脈を付けて 500 にする
            raise HTTPException(
                status_code=500, detail=f"解析中に予期しないエラーが発生しました: {exc}"
            ) from exc

        return AnalyzeResponse(
            **result.model_dump(),
            peaks=wave.peaks,
            rms=wave.rms,
            bands=WaveformBands(low=wave.low, mid=wave.mid, high=wave.high),
        )

    return app


app = create_app()


def main() -> None:
    port = int(os.environ.get("AUDIO_PORT", str(DEFAULT_PORT)))
    host = os.environ.get("AUDIO_HOST", DEFAULT_HOST)
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
