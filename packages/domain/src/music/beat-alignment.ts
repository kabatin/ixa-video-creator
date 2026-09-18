import { z } from 'zod'
import type { Seconds } from '../common/time.js'
import { snapToBeat, type MusicTrack } from './music.js'

/**
 * Shot の境目が拍にどれだけ乗っているかの判定（PHASE 6.3 / P63-1）。
 *
 * **しきい値を持つのはこのファイルだけ。** API にも画面にも書き写さない。
 * 2 箇所に同じ数字があると必ずズレて、画面だけが古い基準で合格に見える（lessons L-016）。
 *
 * 純粋関数のみ。IO を持たず、入力を一切変更しない。
 */

/**
 * ここに収まっていれば「拍に乗っている」。
 *
 * 本制作 Project の実測（68 Shot）で 52 件がこの内側に入り、
 * 0.02〜0.08s の帯は **1 件も無い**。二分した分布の内側の境目（tasks/todo.md PHASE 6.3）。
 */
export const ON_BEAT_SEC = 0.02

/**
 * ここを超えたら「拍から外れている」。
 *
 * 実測で 16 件がこの外側（最大 0.222s）。内側の境目との間が空いているので、
 * どちらの数字を少し動かしても実測の判定は変わらない。
 */
export const NEAR_BEAT_SEC = 0.08

/**
 * 境目の状態。
 *
 * - `on_downbeat` — 小節頭に乗っている。`on_beat` より強い
 * - `on_beat` — 拍に乗っている
 * - `near` — 拍から少し外れている
 * - `off_beat` — 拍から外れている。**直すには Shot を動かすしかない**
 * - `no_beats` — 拍が分かっていない。**「外れている」ではない。**
 *   解析を流せば直る状態なので、`off_beat` と同じ扱いにしてはいけない（lessons L-015）
 */
export const BeatAlignment = z.enum(['on_downbeat', 'on_beat', 'near', 'off_beat', 'no_beats'])
export type BeatAlignment = z.infer<typeof BeatAlignment>

export type BoundaryAlignment = {
  readonly atSec: Seconds
  /** 一番近い拍。**拍が 1 件も無ければ null。** */
  readonly nearestBeatSec: Seconds | null
  /**
   * 一番近い拍からのズレ（秒）。正なら拍より後ろ、負なら前。
   * 拍が 1 件も無ければ null（0 ではない。0 は「ぴったり乗っている」の意味になる）。
   */
  readonly driftSec: number | null
  readonly alignment: BeatAlignment
}

/** 列の中で `atSec` に一番近い値との距離。列が空なら null。 */
const nearestDistanceSec = (atSec: number, times: readonly Seconds[]): number | null => {
  if (times.length === 0) return null
  return Math.min(...times.map((time) => Math.abs(atSec - time)))
}

/**
 * 境目 1 件を拍に当てる。
 *
 * **拍が 1 件も無いときは真っ先に打ち切る。** `snapToBeat` は拍が無ければ入力を
 * そのまま返すので、そのまま距離を測るとズレ 0 になり、
 * 「拍が分からない」が「ぴったり乗っている」に化ける。
 *
 * 小節頭に乗っているかは `downbeats` だけで独立に見る。
 * 手で補正した解析では `downbeats` が `beats` の部分集合とは限らないため。
 */
export const alignBoundary = (
  atSec: Seconds,
  beats: readonly Seconds[],
  downbeats: readonly Seconds[],
): BoundaryAlignment => {
  if (beats.length === 0) {
    return { atSec, nearestBeatSec: null, driftSec: null, alignment: 'no_beats' }
  }

  const nearestBeatSec = snapToBeat(atSec, beats)
  const driftSec = atSec - nearestBeatSec
  const beatDistanceSec = Math.abs(driftSec)
  const downbeatDistanceSec = nearestDistanceSec(atSec, downbeats)

  const alignment: BeatAlignment =
    downbeatDistanceSec !== null && downbeatDistanceSec <= ON_BEAT_SEC
      ? 'on_downbeat'
      : beatDistanceSec <= ON_BEAT_SEC
        ? 'on_beat'
        : beatDistanceSec <= NEAR_BEAT_SEC
          ? 'near'
          : 'off_beat'

  return { atSec, nearestBeatSec, driftSec, alignment }
}

/**
 * 拍の出どころにする楽曲を選ぶ。**マスター音源、無ければ先頭。1 件も無ければ null。**
 *
 * ミュージックビデオでは尺を決めるのがマスター音源なので、そこを既定にする。
 * 同じ規則が吸着・A/B 比較・ストーリーボードに散っていた。**規則が複数あると必ずズレ、
 * 画面ごとに違う曲の拍で色が付く**（lessons L-016）。呼ぶ側はこれだけを使う。
 *
 * どの解析を使うかはここでは決めない。「同じ楽曲の最新 1 件」は
 * リポジトリ（`findByTrack`）と API が持っており、画面はその結果を受け取るだけ。
 */
export const pickMasterTrack = <T extends Pick<MusicTrack, 'isMaster'>>(
  tracks: readonly T[],
): T | null => tracks.find((track) => track.isMaster) ?? tracks[0] ?? null
