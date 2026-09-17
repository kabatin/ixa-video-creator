import { describe, expect, it } from 'vitest'
import { fetchWaveformPeaks } from '@/lib/waveform-api'
import {
  BEAT_MATCH_EPSILON_SEC,
  MARKER_DRAW_ORDER,
  MARKER_STYLES,
  MIN_VIEW_SPAN_SEC,
  beatGridAnchor,
  clampView,
  describeWaveform,
  fullView,
  markerSegment,
  markerStride,
  peakColumns,
  pickMarkers,
  pixelsPerSecond,
  sectionBoundaries,
  timeToX,
  viewDurationSec,
  xToTime,
  type MarkerKind,
  type ViewRange,
} from '@/lib/waveform-draw'

/**
 * 実データに合わせた値。
 * 116.04 秒 / 123 BPM / 拍 232 個 / 小節 58 個 / ドロップ 9 個 / 波形 2000 点。
 */
const DURATION_SEC = 116.04403628117913
const BEAT_INTERVAL_SEC = 0.4876190476190476
const FIRST_BEAT_SEC = 0.5340589569160997

const beatsFixture: readonly number[] = Array.from(
  { length: 232 },
  (_, index) => FIRST_BEAT_SEC + index * BEAT_INTERVAL_SEC,
)

/** 実データと同じく、最初の小節線は 4 番目の拍（index 3）に一致する。 */
const downbeatsFixture: readonly number[] = beatsFixture.filter((_, index) => index % 4 === 3)

const view = (startSec: number, endSec: number): ViewRange => ({ startSec, endSec })

describe('clampView', () => {
  it('曲の中に収める', () => {
    expect(clampView(view(-10, 5), 100)).toEqual({ startSec: 0, endSec: 15 })
  })

  it('曲の終わりを越えた窓は末尾へ寄せる', () => {
    expect(clampView(view(95, 115), 100)).toEqual({ startSec: 80, endSec: 100 })
  })

  it('曲より長い窓は全体へ畳む', () => {
    expect(clampView(view(0, 500), 100)).toEqual({ startSec: 0, endSec: 100 })
  })

  it('寄りすぎた窓は最小幅で止まる', () => {
    const result = clampView(view(10, 10.01), 100)
    expect(viewDurationSec(result)).toBeCloseTo(MIN_VIEW_SPAN_SEC, 10)
  })

  it('非有限な値は全体表示へ畳む', () => {
    expect(clampView(view(Number.NaN, 5), 100)).toEqual({ startSec: 0, endSec: 100 })
    expect(clampView(view(0, Number.POSITIVE_INFINITY), 100)).toEqual({ startSec: 0, endSec: 100 })
  })

  it('尺が 0 でも最小幅の窓を返す', () => {
    expect(viewDurationSec(clampView(fullView(0), 0))).toBe(MIN_VIEW_SPAN_SEC)
  })
})

describe('秒と x 座標', () => {
  it('窓の左端が 0、右端が幅になる', () => {
    expect(timeToX(10, view(10, 20), 800)).toBe(0)
    expect(timeToX(20, view(10, 20), 800)).toBe(800)
  })

  it('窓の外は負の値やはみ出した値になる（丸めない）', () => {
    expect(timeToX(5, view(10, 20), 800)).toBe(-400)
    expect(timeToX(25, view(10, 20), 800)).toBe(1200)
  })

  it('往復しても元の秒に戻る', () => {
    const v = view(12.5, 37.5)
    expect(xToTime(timeToX(30.125, v, 640), v, 640)).toBeCloseTo(30.125, 10)
  })

  it('幅が 0 なら窓の先頭を返す', () => {
    expect(xToTime(100, view(3, 9), 0)).toBe(3)
    expect(pixelsPerSecond(view(3, 9), 0)).toBe(0)
  })

  it('1 秒あたりのピクセル数を返す', () => {
    expect(pixelsPerSecond(view(0, 116), 928)).toBeCloseTo(8, 10)
  })
})

describe('MARKER_STYLES', () => {
  it('4 種類すべてが描画順に含まれる', () => {
    expect([...MARKER_DRAW_ORDER].sort()).toEqual(
      (Object.keys(MARKER_STYLES) as MarkerKind[]).sort(),
    )
  })

  it('ドロップが最後に描かれる（他の線に隠れない）', () => {
    expect(MARKER_DRAW_ORDER.at(-1)).toBe('drop')
  })

  it('色を除いた見た目が 4 種類すべてで異なる（色だけで意味を伝えない）', () => {
    const shapes = MARKER_DRAW_ORDER.map((kind) => {
      const style = MARKER_STYLES[kind]
      return JSON.stringify([
        style.anchor,
        style.heightRatio,
        style.lineWidthPx,
        style.dashPx,
        style.capMarker,
      ])
    })
    expect(new Set(shapes).size).toBe(MARKER_DRAW_ORDER.length)
  })

  it('ドロップは間引かない', () => {
    expect(MARKER_STYLES.drop.minSpacingPx).toBe(0)
    expect(markerStride([1, 2, 3, 4], 0.001, MARKER_STYLES.drop.minSpacingPx)).toBe(1)
  })
})

describe('markerSegment', () => {
  it('center は中央から上下へ伸びる', () => {
    expect(markerSegment(MARKER_STYLES.drop, 100)).toEqual([0, 100])
    expect(markerSegment(MARKER_STYLES.beat, 100)).toEqual([33, 67])
  })

  it('top は上端から下へ伸びる', () => {
    const [top, bottom] = markerSegment(MARKER_STYLES.section, 100)
    expect(top).toBe(0)
    expect(bottom).toBeCloseTo(12, 10)
  })

  it('小節は拍より高く、セクションと重ならない', () => {
    const [beatTop] = markerSegment(MARKER_STYLES.beat, 100)
    const [downbeatTop] = markerSegment(MARKER_STYLES.downbeat, 100)
    const [, sectionBottom] = markerSegment(MARKER_STYLES.section, 100)
    expect(downbeatTop).toBeLessThan(beatTop)
    expect(sectionBottom).toBeLessThan(downbeatTop)
  })
})

describe('markerStride', () => {
  it('全体表示では拍を 2 個に 1 本まで間引く', () => {
    const pxPerSec = pixelsPerSecond(fullView(DURATION_SEC), 900)
    expect(markerStride(beatsFixture, pxPerSec, MARKER_STYLES.beat.minSpacingPx)).toBe(2)
  })

  it('全体表示でも小節は間引かない', () => {
    const pxPerSec = pixelsPerSecond(fullView(DURATION_SEC), 900)
    expect(markerStride(downbeatsFixture, pxPerSec, MARKER_STYLES.downbeat.minSpacingPx)).toBe(1)
  })

  it('寄れば間引かなくなる', () => {
    const pxPerSec = pixelsPerSecond(view(0, 8), 900)
    expect(markerStride(beatsFixture, pxPerSec, MARKER_STYLES.beat.minSpacingPx)).toBe(1)
  })

  it('極端に引くと 2 の冪で広がる', () => {
    expect(markerStride(beatsFixture, 1, MARKER_STYLES.beat.minSpacingPx)).toBe(16)
  })

  it('2 点未満なら常に 1', () => {
    expect(markerStride([], 100, 7)).toBe(1)
    expect(markerStride([1], 100, 7)).toBe(1)
  })

  it('同じ時刻が並んでいても 1 を返す（0 除算しない）', () => {
    expect(markerStride([4, 4, 4], 100, 7)).toBe(1)
  })
})

describe('beatGridAnchor', () => {
  it('最初の小節線に一致する拍の位置を返す', () => {
    expect(beatGridAnchor(beatsFixture, downbeatsFixture)).toBe(3)
  })

  it('小節が無ければ 0', () => {
    expect(beatGridAnchor(beatsFixture, [])).toBe(0)
  })

  it('一致する拍が無ければ 0', () => {
    expect(beatGridAnchor(beatsFixture, [999])).toBe(0)
  })

  it('許容差の中のずれは一致とみなす', () => {
    const shifted = (beatsFixture[3] as number) + BEAT_MATCH_EPSILON_SEC / 2
    expect(beatGridAnchor(beatsFixture, [shifted])).toBe(3)
  })
})

describe('pickMarkers', () => {
  it('窓の外の目印を落とす', () => {
    const pick = pickMarkers('drop', [1, 5, 50, 90], view(4, 60), 800)
    expect(pick.times).toEqual([5, 50])
    expect(pick.hiddenCount).toBe(0)
  })

  it('間引いた数を hiddenCount に残す（黙って消さない）', () => {
    const pick = pickMarkers('beat', beatsFixture, fullView(DURATION_SEC), 900)
    expect(pick.stride).toBe(2)
    expect(pick.times.length + pick.hiddenCount).toBe(beatsFixture.length)
    expect(pick.hiddenCount).toBeGreaterThan(0)
  })

  it('間引いても起点の拍は必ず残る（小節線と噛み合う）', () => {
    const anchor = beatGridAnchor(beatsFixture, downbeatsFixture)
    const pick = pickMarkers('beat', beatsFixture, fullView(DURATION_SEC), 900, anchor)
    expect(pick.times).toContain(beatsFixture[anchor])
    for (const downbeat of downbeatsFixture) {
      expect(pick.times.some((t) => Math.abs(t - downbeat) < BEAT_MATCH_EPSILON_SEC)).toBe(true)
    }
  })

  it('寄れば間引きが消える', () => {
    const pick = pickMarkers('beat', beatsFixture, view(0, 8), 900)
    expect(pick.stride).toBe(1)
    expect(pick.hiddenCount).toBe(0)
  })

  it('選んだ時刻は昇順のまま', () => {
    const pick = pickMarkers('beat', beatsFixture, fullView(DURATION_SEC), 900)
    const sorted = [...pick.times].sort((a, b) => a - b)
    expect(pick.times).toEqual(sorted)
  })

  it('目印が空なら空を返す', () => {
    const pick = pickMarkers('drop', [], fullView(DURATION_SEC), 900)
    expect(pick).toEqual({ kind: 'drop', times: [], stride: 1, hiddenCount: 0 })
  })

  it('幅が 0 でも壊れない', () => {
    expect(pickMarkers('beat', beatsFixture, fullView(DURATION_SEC), 0).times.length).toBe(
      beatsFixture.length,
    )
  })
})

describe('sectionBoundaries', () => {
  it('隣り合うセクションの境目を 1 本にまとめ、先頭の 0 秒は落とす', () => {
    expect(
      sectionBoundaries([
        { start: 0, end: 6.5 },
        { start: 6.5, end: 10.9 },
        { start: 10.9, end: 18.3 },
      ]),
    ).toEqual([6.5, 10.9, 18.3])
  })

  it('昇順に並べ直す', () => {
    expect(
      sectionBoundaries([
        { start: 20, end: 30 },
        { start: 5, end: 20 },
      ]),
    ).toEqual([5, 20, 30])
  })

  it('セクションが無ければ空', () => {
    expect(sectionBoundaries([])).toEqual([])
  })
})

describe('peakColumns', () => {
  const peaks = Array.from({ length: 2000 }, (_, index) => (index === 1000 ? 1 : 0.2))

  it('列の数だけ値を返す', () => {
    expect(peakColumns(peaks, fullView(DURATION_SEC), DURATION_SEC, 900).length).toBe(900)
  })

  it('1 列に複数の点が入るとき最大値を採る（平均で均さない）', () => {
    const columns = peakColumns(peaks, fullView(DURATION_SEC), DURATION_SEC, 100)
    expect(Math.max(...columns)).toBe(1)
    expect(columns.filter((value) => value === 1).length).toBe(1)
  })

  it('窓を寄せるとその範囲の点だけを見る', () => {
    const quiet = peakColumns(peaks, view(0, 10), DURATION_SEC, 50)
    expect(Math.max(...quiet)).toBeCloseTo(0.2, 10)
  })

  it('すべての値が 0〜1 に収まる', () => {
    const columns = peakColumns([-5, 3, 0.5], fullView(10), 10, 20)
    expect(columns.every((value) => value >= 0 && value <= 1)).toBe(true)
  })

  it('点が 0 個・列が 0・尺が 0 のときは空を返す', () => {
    expect(peakColumns([], fullView(DURATION_SEC), DURATION_SEC, 900)).toEqual([])
    expect(peakColumns(peaks, fullView(DURATION_SEC), DURATION_SEC, 0)).toEqual([])
    expect(peakColumns(peaks, fullView(DURATION_SEC), 0, 900)).toEqual([])
  })

  it('入力の配列を変更しない', () => {
    const input = [0.1, 0.2, 0.3]
    const snapshot = [...input]
    peakColumns(input, fullView(3), 3, 10)
    expect(input).toEqual(snapshot)
  })
})

describe('describeWaveform', () => {
  const picks = [
    pickMarkers('beat', beatsFixture, fullView(DURATION_SEC), 900, 3),
    pickMarkers('drop', [2.67, 10.75], fullView(DURATION_SEC), 900),
  ]

  it('表示範囲と目印の数を文字で伝える', () => {
    const text = describeWaveform({
      view: fullView(DURATION_SEC),
      durationSec: DURATION_SEC,
      peakCount: 2000,
      picks,
    })
    expect(text).toContain('0:00.00')
    expect(text).toContain('ドロップ 2 個')
  })

  it('間引いた事実を必ず書く', () => {
    const text = describeWaveform({
      view: fullView(DURATION_SEC),
      durationSec: DURATION_SEC,
      peakCount: 2000,
      picks,
    })
    expect(text).toContain('間引き')
    expect(text).toContain('非表示')
  })

  it('点が 0 個のときは波形ではなく目印だけだと言う', () => {
    const text = describeWaveform({
      view: fullView(DURATION_SEC),
      durationSec: DURATION_SEC,
      peakCount: 0,
      picks: [],
    })
    expect(text).toContain('0 個')
    expect(text).toContain('目印だけ')
  })
})

/**
 * 取得層。**`failed` と `empty` が混ざらないことを確かめる。**
 * ここが混ざると、取れなかった曲が「無音の曲」として静かに描かれる（lessons L-015）。
 */
describe('fetchWaveformPeaks', () => {
  const respond =
    (body: string, status = 200): typeof fetch =>
    () =>
      Promise.resolve(new Response(body, { status }))

  it('正しい形なら ok で点を返す', async () => {
    const result = await fetchWaveformPeaks('https://example.invalid/peaks.json', {
      fetchImpl: respond(JSON.stringify({ peaks: [0, 0.5, 1] })),
    })
    expect(result).toEqual({ status: 'ok', peaks: [0, 0.5, 1] })
  })

  it('点が 0 個は empty であり failed ではない', async () => {
    const result = await fetchWaveformPeaks('https://example.invalid/peaks.json', {
      fetchImpl: respond(JSON.stringify({ peaks: [] })),
    })
    expect(result).toEqual({ status: 'empty' })
  })

  it('HTTP エラーは failed になり、状態が message に残る', async () => {
    const result = await fetchWaveformPeaks('https://example.invalid/peaks.json', {
      fetchImpl: respond('expired', 403),
    })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.message).toContain('403')
  })

  it('JSON でない本文は failed', async () => {
    const result = await fetchWaveformPeaks('https://example.invalid/peaks.json', {
      fetchImpl: respond('<html>error</html>'),
    })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.message).toContain('JSON')
  })

  it('形が違う JSON は failed（黙って空にしない）', async () => {
    const result = await fetchWaveformPeaks('https://example.invalid/peaks.json', {
      fetchImpl: respond(JSON.stringify({ samples: [1, 2] })),
    })
    expect(result.status).toBe('failed')
  })

  it('0〜1 の外にある値は failed', async () => {
    const result = await fetchWaveformPeaks('https://example.invalid/peaks.json', {
      fetchImpl: respond(JSON.stringify({ peaks: [0.5, 32768] })),
    })
    expect(result.status).toBe('failed')
  })

  it('接続できないときは failed で理由を残す', async () => {
    const result = await fetchWaveformPeaks('https://example.invalid/peaks.json', {
      fetchImpl: () => Promise.reject(new Error('network down')),
    })
    expect(result.status).toBe('failed')
    expect(result.status === 'failed' && result.message).toContain('network down')
  })
})
