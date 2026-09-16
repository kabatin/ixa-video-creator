"""セクション境界の検出（Laplacian segmentation / ADR-0009）。

再帰行列（どの拍とどの拍が似ているか）と、時間方向の隣接グラフを足し合わせ、
正規化グラフラプラシアンの低次固有ベクトルを k-means でクラスタリングする。
クラスタが切り替わる拍をセクション境界とみなす。

**ラベル命名はここでは行わない。** すべて仮ラベルを入れ、命名は TS 側が LLM で行う。
"""

from __future__ import annotations

import numpy as np
import scipy.linalg
import scipy.ndimage
import scipy.sparse.csgraph
import librosa
from sklearn.cluster import KMeans

from .energy import mean_energy_between
from .models import PROVISIONAL_SECTION_LABEL, EnergyCurve, Section

#: これ未満の拍数しか無い音源はクラスタリングせず 1 セクションとして扱う。
MIN_BEATS_FOR_SEGMENTATION = 16
#: セクションの最小長（秒）。これより短い境界は前のセクションへ吸収する。
MIN_SECTION_SEC = 4.0
#: 想定するセクションの平均長（秒）。クラスタ数の決定に使う。
TARGET_SECTION_SEC = 25.0
MIN_CLUSTERS = 2
MAX_CLUSTERS = 8


def detect_sections(
    samples: np.ndarray,
    sr: int,
    beat_times: list[float],
    beat_frames: np.ndarray,
    hop_length: int,
    duration_sec: float,
    energy_curve: EnergyCurve,
) -> list[Section]:
    """時間順に並び、隙間も重なりも無いセクション列を返す。"""
    boundaries = _boundary_times(samples, sr, beat_times, beat_frames, hop_length, duration_sec)
    return _build_sections(boundaries, duration_sec, energy_curve)


def _boundary_times(
    samples: np.ndarray,
    sr: int,
    beat_times: list[float],
    beat_frames: np.ndarray,
    hop_length: int,
    duration_sec: float,
) -> list[float]:
    """内部境界の時刻（0 と duration は含まない）。"""
    if len(beat_times) < MIN_BEATS_FOR_SEGMENTATION or duration_sec < MIN_SECTION_SEC * 2:
        return []

    chroma_sync = _beat_sync(
        librosa.feature.chroma_cqt(y=samples, sr=sr, hop_length=hop_length), beat_frames
    )
    mfcc_sync = _beat_sync(
        librosa.feature.mfcc(y=samples, sr=sr, hop_length=hop_length, n_mfcc=13), beat_frames
    )

    beat_count = min(chroma_sync.shape[1], mfcc_sync.shape[1], len(beat_times))
    if beat_count < MIN_BEATS_FOR_SEGMENTATION:
        return []

    affinity = _combined_affinity(chroma_sync[:, :beat_count], mfcc_sync[:, :beat_count])
    n_clusters = _cluster_count(duration_sec, beat_count)
    labels = _spectral_labels(affinity, n_clusters)

    changed = np.flatnonzero(np.diff(labels)) + 1
    return [float(beat_times[int(i)]) for i in changed if 0 < int(i) < beat_count]


def _beat_sync(feature: np.ndarray, beat_frames: np.ndarray) -> np.ndarray:
    """フレーム単位の特徴量を拍単位へ集約する。"""
    return librosa.util.sync(feature, beat_frames, aggregate=np.median)


def _combined_affinity(chroma_sync: np.ndarray, mfcc_sync: np.ndarray) -> np.ndarray:
    """再帰（繰り返し構造）グラフと逐次（時間的連続性）グラフを重み付きで足す。"""
    recurrence = librosa.segment.recurrence_matrix(
        chroma_sync, width=3, mode="affinity", sym=True
    )
    # 対角方向のノイズを落とす。孤立した一致が境界を刻みすぎるのを防ぐ。
    recurrence = scipy.ndimage.median_filter(np.asarray(recurrence, dtype=np.float64), size=(1, 7))
    sequential = _sequential_affinity(mfcc_sync)

    recurrence_degree = float(np.mean(recurrence.sum(axis=1)))
    sequential_degree = float(np.mean(sequential.sum(axis=1)))
    total = recurrence_degree + sequential_degree
    # 2 つのグラフの次数を均衡させる。片方が支配的になるとクラスタが潰れる。
    mu = sequential_degree / total if total > 0.0 else 0.5

    return mu * recurrence + (1.0 - mu) * sequential


def _sequential_affinity(mfcc_sync: np.ndarray) -> np.ndarray:
    """隣接する拍どうしを音色の近さで結ぶ帯行列。"""
    beat_count = mfcc_sync.shape[1]
    graph = np.zeros((beat_count, beat_count), dtype=np.float64)
    if beat_count < 2:
        return graph

    distance = np.sqrt(np.sum(np.diff(mfcc_sync, axis=1) ** 2, axis=0))
    scale = float(np.median(distance))
    weights = np.exp(-distance / scale) if scale > 0.0 else np.ones_like(distance)

    index = np.arange(beat_count - 1)
    graph[index, index + 1] = weights
    graph[index + 1, index] = weights
    return graph


def _cluster_count(duration_sec: float, beat_count: int) -> int:
    """尺からクラスタ数を決める。決定的であることを優先する。"""
    estimated = int(round(duration_sec / TARGET_SECTION_SEC))
    bounded = max(MIN_CLUSTERS, min(MAX_CLUSTERS, estimated))
    return max(MIN_CLUSTERS, min(bounded, beat_count - 1))


def _spectral_labels(affinity: np.ndarray, n_clusters: int) -> np.ndarray:
    """正規化ラプラシアンの低次固有ベクトルを k-means でクラスタリングする。"""
    laplacian = scipy.sparse.csgraph.laplacian(affinity, normed=True)
    _, eigenvectors = scipy.linalg.eigh(np.asarray(laplacian, dtype=np.float64))

    embedding = eigenvectors[:, :n_clusters]
    norms = np.linalg.norm(embedding, axis=1, keepdims=True)
    embedding = embedding / np.where(norms > 0.0, norms, 1.0)

    # random_state 固定。同じ音源からは常に同じ境界が出る必要がある。
    kmeans = KMeans(n_clusters=n_clusters, n_init=10, random_state=0)
    return np.asarray(kmeans.fit_predict(embedding), dtype=np.int64)


def _build_sections(
    boundaries: list[float], duration_sec: float, energy_curve: EnergyCurve
) -> list[Section]:
    """境界から、隙間も重なりも無い連続したセクション列を作る。"""
    edges = [0.0]
    for time_sec in sorted(boundaries):
        if time_sec - edges[-1] >= MIN_SECTION_SEC and duration_sec - time_sec >= MIN_SECTION_SEC:
            edges.append(float(time_sec))
    edges.append(float(duration_sec))

    return [
        Section(
            start=edges[i],
            end=edges[i + 1],
            label=PROVISIONAL_SECTION_LABEL,
            energy=mean_energy_between(energy_curve, edges[i], edges[i + 1]),
        )
        for i in range(len(edges) - 1)
    ]
