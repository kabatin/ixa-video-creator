"""FastAPI アプリ。

ファイルは受け取らず**パスだけ**を受け取る（同一ホストで動く前提。
大きな音声を HTTP に乗せない）。パスは必ず `AUDIO_ROOT` 配下へ閉じ込める。
"""

from __future__ import annotations

import os
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .analyzer import analyze
from .errors import AudioError, AudioFileNotFoundError, PathNotAllowedError
from .models import AnalyzeResponse, WaveformBands
from .paths import resolve_audio_path
from .transcribe import (
    TranscribeResponse,
    Transcriber,
    TranscriberUnavailableError,
    TranscriptionFailedError,
    create_whisper_transcriber,
    model_name,
)
from .waveform import DEFAULT_BUCKETS, compute_waveform_v2

DEFAULT_PORT = 8100
DEFAULT_HOST = "127.0.0.1"


class AnalyzeRequest(BaseModel):
    """解析対象。`AUDIO_ROOT` からの相対パス、または `AUDIO_ROOT` 配下の絶対パス。"""

    audio_path: str = Field(min_length=1)


class TranscribeRequest(BaseModel):
    """文字起こしの対象。パスの扱いは `/analyze` と同じ。`initial_prompt` は台本（語の綴りを寄せる）。"""

    audio_path: str = Field(min_length=1)
    language: Literal["ja"] = "ja"
    initial_prompt: str | None = Field(default=None, max_length=2000)
    word_timestamps: bool = True


class HealthResponse(BaseModel):
    status: str


def create_app(transcriber: Transcriber | None = None) -> FastAPI:
    """アプリを組み立てる。import 時に副作用を起こさないよう関数に閉じる（CLAUDE.md §7b）。

    `transcriber` はテストで差し替える。既定の faster-whisper はモデルを最初の `/transcribe` で読む。
    """
    app = FastAPI(title="iXA Audio Analysis", version="0.1.0")
    transcribe = transcriber if transcriber is not None else create_whisper_transcriber()

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

    @app.post("/transcribe", response_model=TranscribeResponse)
    def transcribe_endpoint(request: TranscribeRequest) -> TranscribeResponse:
        try:
            path = resolve_audio_path(request.audio_path)
        except PathNotAllowedError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except AudioFileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        try:
            segments = transcribe(
                str(path),
                language=request.language,
                initial_prompt=request.initial_prompt,
                word_timestamps=request.word_timestamps,
            )
        except TranscriberUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except TranscriptionFailedError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return TranscribeResponse(model=model_name(), language=request.language, segments=segments)

    return app


app = create_app()


def main() -> None:
    port = int(os.environ.get("AUDIO_PORT", str(DEFAULT_PORT)))
    host = os.environ.get("AUDIO_HOST", DEFAULT_HOST)
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
