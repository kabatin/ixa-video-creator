"""文字起こし（faster-whisper、MIT。ADR-0062 の行の区間の割り当てに使う）。

モデルは最初に呼ばれたときに 1 度だけ読む（import しただけでは読まない。CLAUDE.md §7b）。
既定は `small`（int8・CPU）。Hugging Face のキャッシュ（`~/.cache/huggingface/hub`）にあればそれを使い、
無ければ取りに行く。
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from typing import Any, Protocol

import librosa
from pydantic import BaseModel, Field

from .errors import AudioError

WHISPER_MODEL_ENV = "AUDIO_WHISPER_MODEL"
DEFAULT_WHISPER_MODEL = "small"
WHISPER_SAMPLE_RATE = 16000


class TranscriptionFailedError(AudioError):
    """文字起こしそのものが失敗した。元の例外は `__cause__` に保持する。"""


class TranscriberUnavailableError(AudioError):
    """文字起こしのモデルを読めなかった（入っていない・取りに行けない）。"""


class Word(BaseModel):
    start: float = Field(ge=0.0)
    end: float = Field(ge=0.0)
    text: str


class Segment(BaseModel):
    start: float = Field(ge=0.0)
    end: float = Field(ge=0.0)
    text: str
    words: list[Word]


class TranscribeResponse(BaseModel):
    model: str
    language: str
    segments: list[Segment]


class Transcriber(Protocol):
    def __call__(
        self, path: str, *, language: str, initial_prompt: str | None, word_timestamps: bool
    ) -> list[Segment]: ...


def model_name() -> str:
    return os.environ.get(WHISPER_MODEL_ENV, DEFAULT_WHISPER_MODEL)


def _load_model(name: str) -> Any:
    # macOS では OpenMP が二重に読まれて abort することがある（実機で観測）。読む前に許す。
    os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
    try:
        from faster_whisper import WhisperModel

        return WhisperModel(name, device="cpu", compute_type="int8")
    except Exception as exc:  # noqa: BLE001 - 読めない理由は何でも「使えない」として返す
        raise TranscriberUnavailableError(
            f"文字起こしのモデル {name} を読めませんでした: {exc}"
        ) from exc


def _rounded(sec: float) -> float:
    return round(max(0.0, float(sec)), 3)


def _segments_of(raw: Any) -> list[Segment]:
    return [
        Segment(
            start=_rounded(segment.start),
            end=_rounded(segment.end),
            text=segment.text.strip(),
            words=[
                Word(start=_rounded(word.start), end=_rounded(word.end), text=word.word.strip())
                for word in (segment.words or [])
            ],
        )
        for segment in raw
    ]


def create_whisper_transcriber(load: Callable[[str], Any] = _load_model) -> Transcriber:
    """faster-whisper の文字起こし。モデルは最初の呼び出しで 1 度だけ読む（同時に呼ばれても 1 度）。"""
    lock = threading.Lock()
    loaded: dict[str, Any] = {}

    def model() -> Any:
        with lock:
            name = model_name()
            if name not in loaded:
                loaded[name] = load(name)
            return loaded[name]

    def transcribe(
        path: str, *, language: str, initial_prompt: str | None, word_timestamps: bool
    ) -> list[Segment]:
        whisper = model()
        try:
            # faster-whisper の既定の読み込み（PyAV）は、この環境で入る版と噛み合わない（`metadata_errors`）。
            # 解析と同じ librosa で 16 kHz モノラルに読んで配列で渡す。
            samples, _sr = librosa.load(path, sr=WHISPER_SAMPLE_RATE, mono=True)
            segments, _info = whisper.transcribe(
                samples,
                language=language,
                initial_prompt=initial_prompt,
                word_timestamps=word_timestamps,
                condition_on_previous_text=False,
            )
            return _segments_of(segments)
        except Exception as exc:  # noqa: BLE001 - 想定外も文脈を付けて送出する
            raise TranscriptionFailedError(f"文字起こしに失敗しました: {exc}") from exc

    return transcribe
