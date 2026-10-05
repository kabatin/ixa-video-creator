import {
  newId,
  MediaAssetId,
  ProjectId,
  ShotId,
  TimelineClipId,
  TransitionId,
  type Shot,
  type ShotCamera,
  type TimelineClip,
  type TimelineTrack,
  type Transition,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { MEDIA_ID, PROJECT_ID, cameraJson } from '@/__tests__/fixtures'
import {
  DEFAULT_PX_PER_SEC,
  MIN_CLIP_WIDTH_PX,
  TIMELINE_ROWS,
  VIDEO1_ROW,
  adjacentShotPairs,
  clipChipLabel,
  describeClipContent,
  formatClock,
  formatLongDuration,
  formatTimeSpan,
  lanesForTrack,
  parseDurationSec,
  parseLayer,
  parseSeconds,
  pxToSeconds,
  rulerTickStepSec,
  rulerTicks,
  secondsToPx,
  sortClipsForDisplay,
  sortTimelineIssues,
  stackByLayer,
  summarizeTimelineIssues,
  timeSpanToRect,
  timelineRowLabel,
  transitionForPair,
  transitionTypeLabel,
  hiddenTracks,
  isInsertableTrack,
  visibleTracks,
} from '@/lib/timeline-display'
import {
  type TimelineIssueView,
} from '@/lib/timeline-issues'

const projectId = ProjectId.parse(PROJECT_ID)
const mediaAssetId = MediaAssetId.parse(MEDIA_ID)
const camera = cameraJson as ShotCamera

const shotId = (suffix: string): Shot['id'] => ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5${suffix}`)

const clipId = (suffix: string): TimelineClip['id'] =>
  TimelineClipId.parse(`01ARZ3NDEKTSV4RRFFQ69G6${suffix}`)

const makeShot = (
  suffix: string,
  code: string,
  startSec: number,
  durationSec: number,
  order = 1000,
): Shot => ({
  id: shotId(suffix),
  projectId,
  sequenceId: null,
  order,
  code,
  startSec,
  durationSec,
  sourceInSec: 0,
  timing: 'trim',
  description: '',
  dialogue: null,
  camera,
      mood: null,
      continuityMode: 'independent',
  locationId: null,
  sourceType: { type: 'ai_video' },
  selectedTakeId: null,
  status: 'draft',
  lockedAt: null,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
  updatedAt: new Date('2026-09-16T00:00:00.000Z'),
})

const makeClip = (
  suffix: string,
  track: TimelineTrack,
  startSec: number,
  durationSec: number,
  layer = 0,
): TimelineClip => ({
  id: clipId(suffix),
  projectId,
  track,
  startSec,
  durationSec,
  layer,
  content: { type: 'text', templateKey: 'lower-third', params: {} },
  opacity: 1,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
})

const makeTransition = (from: Shot, to: Shot, durationSec: number, suffix = 'T00'): Transition => ({
  id: TransitionId.parse(`01ARZ3NDEKTSV4RRFFQ69G7${suffix}`),
  projectId,
  fromShotId: from.id,
  toShotId: to.id,
  type: 'dissolve',
  durationSec,
})

const SHOT_A = makeShot('FA0', 'S01-010', 0, 4)
const SHOT_B = makeShot('FB0', 'S01-020', 4, 4, 2000)

describe('座標とズーム', () => {
  it('秒と px を往復できる', () => {
    expect(secondsToPx(2.5, DEFAULT_PX_PER_SEC)).toBe(100)
    expect(pxToSeconds(100, DEFAULT_PX_PER_SEC)).toBe(2.5)
  })

  it('区間を矩形にする', () => {
    expect(timeSpanToRect({ startSec: 1, durationSec: 2 }, 40)).toEqual({
      leftPx: 40,
      widthPx: 80,
    })
  })

  it('尺 0 のクリップも最低幅で描く（画面から消さない）', () => {
    expect(timeSpanToRect({ startSec: 1, durationSec: 0 }, 40).widthPx).toBe(MIN_CLIP_WIDTH_PX)
  })

  it('ズームが浅いほど目盛りの刻みが粗くなる', () => {
    expect(rulerTickStepSec(160)).toBeLessThan(rulerTickStepSec(10))
  })

  it('目盛りは 0 から始まり、尺を超えない', () => {
    const ticks = rulerTicks(10, 80)
    expect(ticks[0]?.sec).toBe(0)
    expect(ticks.every((tick) => tick.sec <= 10)).toBe(true)
  })

  it('尺が無いときに目盛りを出さない', () => {
    expect(rulerTicks(0, 40)).toEqual([])
  })
})

describe('尺と時刻の整形', () => {
  it('0 秒を m:ss.SS で出す', () => {
    expect(formatClock(0)).toBe('0:00.00')
  })

  it('分をまたぐ秒を出す', () => {
    expect(formatClock(116.5)).toBe('1:56.50')
  })

  it('繰り上がりで 60 秒表記を作らない', () => {
    expect(formatClock(59.999)).toBe('1:00.00')
  })

  /**
   * 以前このモジュールは独自の `formatClock` を持ち、負に符号を付けていた。
   * 一方 `format-time.ts` の同名関数は負と NaN を 0 に倒しており、
   * `ui-primitives.test.ts` がそちらを「壊れた値でも表示を壊さない」として固定していた。
   * **同じ名前の関数に、正反対の期待を置いた 2 つのテストが並んでいた。**
   *
   * 書式の正を `format-time.ts` の 1 つにまとめ、倒す側を採った。
   * 位置が負になることは無い（`rulerTicks` は `index * step` で 0 以上、
   * ほかの呼び出し元も位置か尺）。負が出ているならどこかの計算が壊れているときで、
   * 画面に `-0:01.50` と出しても読み手は何もできない。
   * 符号付きの差分が要る場所は `timeline-drag.ts` の `signedSec` が持つ。
   */
  it('負の秒は 0 に倒す（書式の正は format-time.ts）', () => {
    expect(formatClock(-1.5)).toBe('0:00.00')
  })

  it('尺は時刻と生の秒を併記する', () => {
    expect(formatLongDuration(116)).toBe('1:56.00（116.00s）')
  })

  it('区間は開始と終了を並べる', () => {
    expect(formatTimeSpan({ startSec: 1, durationSec: 2 })).toBe('0:01.00 – 0:03.00')
  })

  it('クリップの中身を種別ごとに説明する', () => {
    // テロップは文字そのものを出す（型の名前では何が出るか分からない）。読めなければそう言う。
    expect(describeClipContent({ type: 'text', templateKey: 'lower_third', params: { text: '歌詞の一行' } })).toBe(
      'テロップ「歌詞の一行」',
    )
    expect(describeClipContent({ type: 'text', templateKey: 'lower-third', params: {} })).toBe(
      'テロップ（文字が読めません）',
    )
    expect(
      describeClipContent({ type: 'media', mediaAssetId, inSec: 0, outSec: 1.5, volume: 1 }),
    ).toContain('0.00s–1.50s')
  })
})

describe('トラックとレーン', () => {
  it('VIDEO1 を先頭に並べる', () => {
    expect(TIMELINE_ROWS[0]).toBe(VIDEO1_ROW)
    expect(TIMELINE_ROWS).toContain('TEXT')
  })

  it('行と Transition のラベルを返す', () => {
    expect(timelineRowLabel('TEXT')).toContain('TEXT')
    expect(transitionTypeLabel('dip_to_black')).toBe('黒フェード')
  })

  it('layer ごとの段に分け、段の中は開始順にする', () => {
    const late = makeClip('C10', 'TEXT', 5, 1, 0)
    const early = makeClip('C11', 'TEXT', 1, 1, 0)
    const upper = makeClip('C12', 'TEXT', 2, 1, 2)

    const lanes = stackByLayer([late, early, upper])

    expect(lanes.map((lane) => lane.layer)).toEqual([0, 2])
    expect(lanes[0]?.clips.map((clip) => clip.id)).toEqual([early.id, late.id])
  })

  it('入力の配列を変更しない', () => {
    const clips = [makeClip('C13', 'TEXT', 5, 1), makeClip('C14', 'TEXT', 1, 1)]
    const before = clips.map((clip) => clip.id)

    stackByLayer(clips)
    sortClipsForDisplay(clips)

    expect(clips.map((clip) => clip.id)).toEqual(before)
  })

  it('指定トラック以外のクリップを混ぜない', () => {
    const lanes = lanesForTrack(
      [makeClip('C15', 'TEXT', 0, 1), makeClip('C16', 'SFX', 0, 1)],
      'TEXT',
    )
    expect(lanes).toHaveLength(1)
    expect(lanes[0]?.clips).toHaveLength(1)
  })

  it('一覧を track → layer → 開始秒の順に並べる', () => {
    const sfx = makeClip('C17', 'SFX', 0, 1, 0)
    const textUpper = makeClip('C18', 'TEXT', 0, 1, 1)
    const textLower = makeClip('C19', 'TEXT', 3, 1, 0)

    expect(sortClipsForDisplay([sfx, textUpper, textLower]).map((clip) => clip.id)).toEqual([
      textLower.id,
      textUpper.id,
      sfx.id,
    ])
  })
})

describe('検証結果の要約', () => {
  it('検査できていないことを「指摘なし」と混同しない', () => {
    const unchecked = summarizeTimelineIssues(null)
    const clean = summarizeTimelineIssues([])

    expect(unchecked.state).toBe('unchecked')
    expect(clean.state).toBe('clean')
    expect(unchecked.message).not.toBe(clean.message)
  })

  it('error と warning を数える', () => {
    const summary = summarizeTimelineIssues([
      { severity: 'error', code: 'a', message: 'a' },
      { severity: 'warning', code: 'b', message: 'b' },
      { severity: 'warning', code: 'c', message: 'c' },
    ])

    expect(summary).toMatchObject({ state: 'issues', errorCount: 1, warningCount: 2 })
  })

  it('error を先に並べ、入力は変更しない', () => {
    const issues: readonly TimelineIssueView[] = [
      { severity: 'warning', code: 'w', message: 'w' },
      { severity: 'error', code: 'e', message: 'e' },
    ]

    expect(sortTimelineIssues(issues).map((issue) => issue.code)).toEqual(['e', 'w'])
    expect(issues.map((issue) => issue.code)).toEqual(['w', 'e'])
  })
})


describe('Shot の組と Transition の対応', () => {
  it('開始秒の順に隣接する組を作る', () => {
    const pairs = adjacentShotPairs([SHOT_B, SHOT_A])

    expect(pairs).toHaveLength(1)
    expect(pairs[0]?.from.code).toBe('S01-010')
    expect(pairs[0]?.to.code).toBe('S01-020')
  })

  it('Shot が 1 本なら組が無い', () => {
    expect(adjacentShotPairs([SHOT_A])).toEqual([])
  })

  it('組に置かれた Transition を引く。無ければ null', () => {
    const transition = makeTransition(SHOT_A, SHOT_B, 0.5)
    const pair = { from: SHOT_A, to: SHOT_B }

    expect(transitionForPair([transition], pair)?.id).toBe(transition.id)
    expect(transitionForPair([], pair)).toBeNull()
  })
})

describe('入力の解釈', () => {
  it('空文字を 0 に落とさない', () => {
    expect(parseSeconds('')).toMatchObject({ ok: false })
  })

  it('数値でない入力を弾く', () => {
    expect(parseSeconds('abc')).toMatchObject({ ok: false })
  })

  it('負の秒を弾く', () => {
    expect(parseSeconds('-1')).toMatchObject({ ok: false })
  })

  it('小数の秒を読む', () => {
    expect(parseSeconds(' 1.25 ')).toEqual({ ok: true, value: 1.25 })
  })

  it('尺 0 を弾く（タイムラインに乗らないため）', () => {
    expect(parseDurationSec('0')).toMatchObject({ ok: false })
    expect(parseDurationSec('0.5')).toEqual({ ok: true, value: 0.5 })
  })

  it('layer は整数の 0 以上だけを受ける', () => {
    expect(parseLayer('1.5')).toMatchObject({ ok: false })
    expect(parseLayer('-1')).toMatchObject({ ok: false })
    expect(parseLayer('2')).toEqual({ ok: true, value: 2 })
  })
})

/**
 * **押しても何も置けない帯は出さない。** VFX / VIDEO2 / SFX は挿入の口が無く、
 * 空の帯として縦を食っていた。ただし**黙って隠すと、過去に入れたクリップが消える**。
 */
describe('出す帯を決める', () => {
  const clipOn = (track: TimelineTrack): TimelineClip => ({
    id: newId(TimelineClipId),
    projectId: newId(ProjectId),
    track,
    startSec: 0,
    durationSec: 1,
    layer: 0,
    content: { type: 'text', templateKey: 'plain', params: { text: 'a' } },
    opacity: 1,
    createdAt: new Date(),
  })

  it('置ける帯は中身が無くても出す', () => {
    expect(visibleTracks([])).toContain('TEXT')
  })

  it('置けない帯は中身が無ければ出さない', () => {
    expect(visibleTracks([])).not.toContain('VFX')
    expect(visibleTracks([])).not.toContain('SFX')
  })

  it('音を落として置ける帯（ワークベンチの効果音）は、空でも出して隠したことにしない', () => {
    expect(visibleTracks([], ['SFX'])).toContain('SFX')
    expect(hiddenTracks([], ['SFX'])).toEqual(['VFX', 'VIDEO2'])
  })

  /** ここを落とすと、過去に入れたクリップが画面から消える。 */
  it('置けない帯でも中身があれば必ず出す', () => {
    expect(visibleTracks([clipOn('VFX')])).toContain('VFX')
  })

  it('隠した帯の名前を返す。1 つも隠していなければ空', () => {
    expect(hiddenTracks([])).toEqual(['VFX', 'VIDEO2', 'SFX'])
    expect(hiddenTracks([clipOn('VFX')])).toEqual(['VIDEO2', 'SFX'])
  })

  /** 帯を出すかどうかと、押せるかどうかが別の場所にあると必ずズレる（L-016）。 */
  it('出す帯の判定と、押せるかの判定が食い違わない', () => {
    for (const track of visibleTracks([])) {
      expect(isInsertableTrack(track)).toBe(true)
    }
  })
})

describe('ズームの呼び名（PHASE 8.4）', () => {
  it('すべての段に呼び名がある（px を画面に出さない）', async () => {
    const { ZOOM_LEVELS, zoomLabel } = await import('@/lib/timeline-display')
    ZOOM_LEVELS.forEach((level) => {
      expect(zoomLabel(level)).not.toContain('px')
    })
    expect(zoomLabel(10)).toBe('全体')
  })
})

/**
 * タイムラインの帯の札（制作者 2026-10-02「テロップすべてに テロップ「＊＊＊＊」 ってなってるの文字数の無駄だよね」）。
 * TEXT 帯の札は文字そのものだけにする（帯の名前が「TEXT（テロップ）」なので種類は分かる）。
 * 知らせ・一覧・ツールチップの一文は、種類が混ざるので今までどおり「テロップ「…」」。
 */
describe('clipChipLabel', () => {
  it('テロップは文字だけ。読めなければそう言う', () => {
    expect(clipChipLabel({ type: 'text', templateKey: 'plain', params: { text: 'ぼくは はると' } })).toBe('ぼくは はると')
    expect(clipChipLabel({ type: 'text', templateKey: 'plain', params: {} })).toBe('（文字が読めません）')
  })

  it('テロップ以外は一行要約のまま', () => {
    expect(clipChipLabel({ type: 'motion_graphics', templateKey: 'title_card', params: {} })).toBe(
      'モーショングラフィックス title_card',
    )
  })
})
