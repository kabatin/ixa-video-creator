import type { Seconds } from '../common/time.js'
import type { BeatSubdivision } from '../music/music.js'
import { expandBeatGrid, snapToBeat } from '../music/music.js'

/**
 * 音楽セクションを Shot の時間枠へ割る（ADR-0017）。
 *
 * **純粋関数。** IO も乱数も時計も使わない。同じ入力なら必ず同じ結果になる。
 * 決める（そして返す）のは時間だけで、code / description / camera は呼び出し側が埋める。
 */

/** Shot 1 つ分の時間枠。 */
export type ShotSlot = {
  readonly startSec: Seconds
  readonly durationSec: Seconds
}

export type AllocateShotsInput = {
  readonly sectionStartSec: Seconds
  readonly sectionEndSec: Seconds
  /** 解析が出したビート。空ならグリッドが無いものとして等分する。 */
  readonly beats: readonly Seconds[]
  readonly subdivision: BeatSubdivision
  /** 作りたいカット数。グリッドが支えられなければ減る。 */
  readonly requestedCount: number
}

export type AllocateShotsResult = {
  readonly slots: readonly ShotSlot[]
  readonly requestedCount: number
  /**
   * グリッドが支えられずカット数を減らしたときだけ非 null。
   *
   * **握り潰さないこと。** 黙って減らすと、要求した数だけ出てくると思っている
   * 利用者が気づかないまま先へ進む。API は warning として必ず返す。
   */
  readonly reducedReason: string | null
}

/** セクション内（両端を含む）のグリッド点を昇順・重複なしで返す。 */
const gridWithin = (
  beats: readonly Seconds[],
  subdivision: BeatSubdivision,
  startSec: Seconds,
  endSec: Seconds,
): readonly Seconds[] => {
  const expanded = subdivision === 1 ? [...beats] : expandBeatGrid(beats, subdivision)
  const inside = expanded.filter((point) => point > startSec && point < endSec)
  return [...new Set([startSec, ...inside.sort((a, b) => a - b), endSec])]
}

/** 境界の配列（長さ n+1）を隣接するスロットへ畳む。 */
const toSlots = (boundaries: readonly Seconds[]): readonly ShotSlot[] =>
  boundaries.slice(0, -1).map((start, index) => ({
    startSec: start,
    // 次の境界との差を尺にするため、隣り合うスロットに隙間も重なりも出ない。
    durationSec: (boundaries[index + 1] as number) - start,
  }))

/** グリッドが無いときの等分。ビート解析前でも Shot 割りを試せるようにする。 */
const evenly = (startSec: Seconds, endSec: Seconds, count: number): readonly ShotSlot[] => {
  const step = (endSec - startSec) / count
  return toSlots([
    ...Array.from({ length: count }, (_, index) => startSec + step * index),
    endSec,
  ])
}

export const allocateShots = (input: AllocateShotsInput): AllocateShotsResult => {
  const { beats, subdivision, requestedCount } = input

  if (!Number.isInteger(requestedCount) || requestedCount < 1) {
    throw new RangeError(`requestedCount は 1 以上の整数である必要があります: ${String(requestedCount)}`)
  }
  if (!(input.sectionEndSec > input.sectionStartSec)) {
    throw new RangeError('セクションの終わりは始まりより後である必要があります')
  }

  // 端をグリッドへ寄せてから割る。先に寄せないと最初と最後の Shot だけ拍から外れる。
  const startSec = snapToBeat(input.sectionStartSec, beats, subdivision)
  const endSec = snapToBeat(input.sectionEndSec, beats, subdivision)

  if (!(endSec > startSec)) {
    throw new RangeError('スナップ後のセクションの尺が 0 以下になりました')
  }

  if (beats.length === 0) {
    return { slots: evenly(startSec, endSec, requestedCount), requestedCount, reducedReason: null }
  }

  const grid = gridWithin(beats, subdivision, startSec, endSec)
  // 境界は n+1 個要る。グリッド点がそれだけ無ければ、作れるのは grid.length - 1 カット。
  const maxCount = grid.length - 1

  /**
   * 尺 0 の Shot を作らないために「最小 1 グリッド」で詰める手もあるが、
   * それだと最後の Shot だけ極端に短くなる。要求数を減らして等分するほうが、
   * 出来上がる映像のリズムが音楽に合う（ADR-0017）。
   */
  const count = Math.min(requestedCount, maxCount)
  const reducedReason =
    count < requestedCount
      ? `このセクションのグリッドでは ${String(maxCount)} カットが上限です（${String(requestedCount)} カット要求）`
      : null

  // グリッド点を count 等分し、割り切れない端数は後ろのスロットへ寄せる。
  const boundaries = Array.from({ length: count + 1 }, (_, index) => {
    const at = Math.round((index * maxCount) / count)
    return grid[at] as Seconds
  })

  return { slots: toSlots(boundaries), requestedCount, reducedReason }
}
