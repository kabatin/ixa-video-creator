"""音楽解析の本体。

HTTP から切り離した純粋な関数として保つ（テスト容易性のため）。
使用するライブラリは librosa（ISC）のみ。madmom / essentia / allin1 は
非商用ライセンスのモデルに依存するため使用しない（ADR-0009）。
"""

from __future__ import annotations

import numpy as np
import librosa

from .audio_io import HOP_LENGTH, load_mono
from .downbeats import estimate_downbeats, strength_at_times
from .energy import compute_energy_curve, detect_drops, detect_onsets
from .errors import AnalysisFailedError, AudioError
from .models import AnalysisResult
from .sections import detect_sections

#: ビート間隔のばらつきを 0..1 の規則性スコアへ潰す係数。変動係数 0.17 でおよそ 0.36 になる。
_REGULARITY_DECAY = 6.0
#: BPM の再推定を採用する許容誤差（librosa の粗い推定値に対する相対値）。
#: これを超える差はオクターブ誤りや拍の取りこぼしを疑い、再推定を捨てる。
_BPM_REFINE_TOLERANCE = 0.05
#: 拍の取りこぼしを検出する閾値。中央値からこの割合を超えてずれる間隔があれば再推定しない。
_BEAT_INTERVAL_TOLERANCE = 0.25


def analyze(audio_path: str) -> AnalysisResult:
    """音声を解析して `AnalysisResult` を返す。

    Raises:
        AnalysisFailedError: 読み込みまたは解析に失敗した場合。
    """
    samples, sr = load_mono(audio_path)

    try:
        return _analyze_samples(samples, sr)
    except AudioError:
        raise
    except Exception as exc:  # noqa: BLE001 - 文脈を付けて再送出する
        raise AnalysisFailedError(f"解析に失敗しました: {audio_path}") from exc


def _analyze_samples(samples: np.ndarray, sr: int) -> AnalysisResult:
    duration_sec = float(librosa.get_duration(y=samples, sr=sr))
    onset_envelope = librosa.onset.onset_strength(y=samples, sr=sr, hop_length=HOP_LENGTH)
    onset_frame_times = librosa.times_like(onset_envelope, sr=sr, hop_length=HOP_LENGTH)

    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_envelope, sr=sr, hop_length=HOP_LENGTH, units="frames"
    )
    coarse_bpm = float(np.atleast_1d(tempo)[0])
    if not np.isfinite(coarse_bpm) or coarse_bpm <= 0.0:
        raise AnalysisFailedError("テンポを検出できませんでした（無音またはビートの無い音源）")

    beat_frames = np.atleast_1d(np.asarray(beat_frames, dtype=np.int64))
    beat_times = [
        float(t) for t in librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP_LENGTH)
    ]
    bpm = _refine_bpm(coarse_bpm, beat_times)

    energy_curve = compute_energy_curve(samples, sr, HOP_LENGTH)

    return AnalysisResult(
        bpm=bpm,
        bpm_confidence=_bpm_confidence(beat_times, onset_envelope, onset_frame_times),
        beats=beat_times,
        downbeats=estimate_downbeats(beat_times, onset_envelope, onset_frame_times),
        sections=detect_sections(
            samples, sr, beat_times, beat_frames, HOP_LENGTH, duration_sec, energy_curve
        ),
        energy_curve=energy_curve,
        onsets=detect_onsets(samples, sr, HOP_LENGTH),
        drops=detect_drops(energy_curve),
        duration_sec=duration_sec,
    )


def _bpm_confidence(
    beat_times: list[float], onset_envelope: np.ndarray, onset_frame_times: np.ndarray
) -> float:
    """BPM の信頼度を 0..1 で推定する。

    librosa は信頼度を返さないため、2 つの決定的な指標の積で近似する。

    - 規則性: ビート間隔の変動係数が小さいほど高い。
    - 顕著性: ビート位置のオンセット強度が、曲全体の平均に対してどれだけ突出しているか。
    """
    if len(beat_times) < 3 or onset_envelope.size == 0:
        return 0.0

    intervals = np.diff(np.asarray(beat_times, dtype=np.float64))
    mean_interval = float(np.mean(intervals))
    if mean_interval <= 0.0:
        return 0.0

    coefficient_of_variation = float(np.std(intervals)) / mean_interval
    regularity = float(np.exp(-_REGULARITY_DECAY * coefficient_of_variation))

    envelope_mean = float(np.mean(onset_envelope))
    envelope_max = float(np.max(onset_envelope))
    headroom = envelope_max - envelope_mean
    if headroom <= 0.0:
        return 0.0

    beat_strength = float(np.mean(strength_at_times(beat_times, onset_envelope, onset_frame_times)))
    salience = (beat_strength - envelope_mean) / headroom

    return float(np.clip(regularity * salience, 0.0, 1.0))


def _refine_bpm(coarse_bpm: float, beat_times: list[float]) -> float:
    """ビートグリッドから BPM を再推定する。

    librosa が返すテンポはオンセット包絡のフレーム解像度（ホップ 512 / 22.05 kHz で約 23 ms）に
    量子化されており、120 BPM（拍間隔 0.5 秒）のように解像度の整数倍でないテンポでは
    数 BPM のずれが出る。ビート時刻を「拍番号 → 時刻」の直線として最小二乗近似し、
    その傾きから拍間隔を求めることで量子化誤差を平均化する。

    拍の取りこぼしがあると拍番号がずれて誤った傾きになるため、
    間隔が揃っていること、かつ粗い推定値から大きく離れないことを確認したうえで採用する。
    """
    if len(beat_times) < 4:
        return coarse_bpm

    times = np.asarray(beat_times, dtype=np.float64)
    intervals = np.diff(times)
    median_interval = float(np.median(intervals))
    if median_interval <= 0.0:
        return coarse_bpm

    deviation = float(np.max(np.abs(intervals - median_interval))) / median_interval
    if deviation > _BEAT_INTERVAL_TOLERANCE:
        return coarse_bpm

    index = np.arange(times.size, dtype=np.float64)
    variance = float(np.var(index))
    if variance <= 0.0:
        return coarse_bpm
    slope = float(np.mean((index - np.mean(index)) * (times - np.mean(times)))) / variance
    if slope <= 0.0:
        return coarse_bpm

    refined = 60.0 / slope
    if abs(refined - coarse_bpm) / coarse_bpm > _BPM_REFINE_TOLERANCE:
        return coarse_bpm

    return refined
