import {
  ProjectId,
  ShotId,
  TimelineClipId,
  type Shot,
  type ShotCamera,
  type TimelineClip,
} from '@ixa/domain'
import type { SnapCandidate } from '@ixa/timeline'
import { describe, expect, it } from 'vitest'
import { PROJECT_ID, cameraJson } from '@/__tests__/fixtures'
import { MIN_CLIP_WIDTH_PX, type TimeSpan } from '@/lib/timeline-display'
import {
  EDGE_GRAB_WIDTH_PX,
  MIN_CLIP_DURATION_SEC,
  applyClipDrag,
  beginClipDrag,
  candidatesForClipDrag,
  clipDragHandleLabel,
  clipHandleAtClientX,
  describeClipDrag,
  edgeGrabWidthPx,
  timelineSecAtClientX,
  type ClipDragContext,
  type ClipDragStart,
  type TimelineBounds,
} from '@/lib/timeline-drag'
import { snapToleranceSec, type BeatSource, type SnapSource } from '@/lib/timeline-snap'

/**
 * クリップを掴んで動かす計算。**掴んだ場所と動く物がずれないこと**と、
 * **断ったときに必ず理由が返ること**を固定する。
 * 黙って値を丸めると「引いたのに動かない」としか見えず、直しようがない。
 */

/** 時刻 0 が画面の x=100 にある。1 秒 = 40px（既定のズーム）。数えやすい比率にしてある。 */
const BOUNDS: TimelineBounds = { left: 100 }
const PX_PER_SEC = 40
const TOLERANCE_SEC = snapToleranceSec(PX_PER_SEC)

const xAt = (sec: number): number => BOUNDS.left + sec * PX_PER_SEC

/** 4.0s–6.0s のクリップ。画面では x=260–340。 */
const CLIP: TimeSpan = { startSec: 4, durationSec: 2 }

const candidate = (atSec: number, kind: SnapCandidate['kind'] = 'clip_edge'): SnapCandidate => ({
  atSec,
  kind,
})

const context = (overrides: Partial<ClipDragContext> = {}): ClipDragContext => ({
  candidates: [],
  toleranceSec: TOLERANCE_SEC,
  snapEnabled: true,
  timelineEndSec: 0,
  ...overrides,
})

const grab = (span: TimeSpan, atSec: number): ClipDragStart => {
  const drag = beginClipDrag(span, xAt(atSec), BOUNDS, PX_PER_SEC)
  if (drag === null) throw new Error(`${String(atSec)}s ではクリップを掴めませんでした`)
  return drag
}

// --- 端を掴める幅 ---

describe('edgeGrabWidthPx', () => {
  it('十分な幅があれば固定の画素幅をそのまま使う', () => {
    expect(edgeGrabWidthPx(80)).toBe(EDGE_GRAB_WIDTH_PX)
    expect(edgeGrabWidthPx(18)).toBe(EDGE_GRAB_WIDTH_PX)
  })

  it('短いクリップでは幅の 1/3 までしか取らない（本体を食いつぶさないため）', () => {
    expect(edgeGrabWidthPx(10)).toBeCloseTo(10 / 3, 10)
    expect(edgeGrabWidthPx(3)).toBeCloseTo(1, 10)
  })

  it('左右を足しても幅の 2/3 を超えない。本体は必ず 1/3 残る', () => {
    for (const widthPx of [1, 3, 7, 10, 17, 18, 40]) {
      expect(edgeGrabWidthPx(widthPx) * 2).toBeLessThanOrEqual(widthPx * (2 / 3) + 1e-9)
    }
  })

  it('幅が 0 以下なら 0。負の幅の端を作らない', () => {
    expect(edgeGrabWidthPx(0)).toBe(0)
    expect(edgeGrabWidthPx(-5)).toBe(0)
  })
})

// --- どこを掴んだか ---

describe('clipHandleAtClientX', () => {
  it('左端・右端・本体を区別する', () => {
    expect(clipHandleAtClientX(CLIP, 262, BOUNDS, PX_PER_SEC)).toBe('start')
    expect(clipHandleAtClientX(CLIP, 300, BOUNDS, PX_PER_SEC)).toBe('body')
    expect(clipHandleAtClientX(CLIP, 338, BOUNDS, PX_PER_SEC)).toBe('end')
  })

  it('端のちょうど境界は端として扱う（狙った線が掴めないほうが害が大きい）', () => {
    expect(clipHandleAtClientX(CLIP, 260 + EDGE_GRAB_WIDTH_PX, BOUNDS, PX_PER_SEC)).toBe('start')
    expect(clipHandleAtClientX(CLIP, 260 + EDGE_GRAB_WIDTH_PX + 0.5, BOUNDS, PX_PER_SEC)).toBe(
      'body',
    )
    expect(clipHandleAtClientX(CLIP, 340 - EDGE_GRAB_WIDTH_PX, BOUNDS, PX_PER_SEC)).toBe('end')
  })

  it('クリップの外は null。掴めないものを掴めたことにしない', () => {
    expect(clipHandleAtClientX(CLIP, 259, BOUNDS, PX_PER_SEC)).toBeNull()
    expect(clipHandleAtClientX(CLIP, 341, BOUNDS, PX_PER_SEC)).toBeNull()
  })

  it('画面の原点ではなくタイムラインの原点からの距離で決まる', () => {
    const shifted: TimelineBounds = { left: 0 }

    expect(clipHandleAtClientX(CLIP, 262, shifted, PX_PER_SEC)).toBeNull()
    expect(clipHandleAtClientX(CLIP, 162, shifted, PX_PER_SEC)).toBe('start')
  })

  it('幅 10px のクリップでも本体を掴める（端が本体を食いつぶさない）', () => {
    const tiny: TimeSpan = { startSec: 0, durationSec: 0.25 }

    expect(clipHandleAtClientX(tiny, 100, BOUNDS, PX_PER_SEC)).toBe('start')
    expect(clipHandleAtClientX(tiny, 105, BOUNDS, PX_PER_SEC)).toBe('body')
    expect(clipHandleAtClientX(tiny, 110, BOUNDS, PX_PER_SEC)).toBe('end')
  })

  it('尺 0 でも最低幅で描かれるので掴める。端と本体も分かれる', () => {
    const zero: TimeSpan = { startSec: 1, durationSec: 0 }
    const leftPx = BOUNDS.left + 1 * PX_PER_SEC

    expect(clipHandleAtClientX(zero, leftPx, BOUNDS, PX_PER_SEC)).toBe('start')
    expect(clipHandleAtClientX(zero, leftPx + MIN_CLIP_WIDTH_PX / 2, BOUNDS, PX_PER_SEC)).toBe(
      'body',
    )
    expect(clipHandleAtClientX(zero, leftPx + MIN_CLIP_WIDTH_PX, BOUNDS, PX_PER_SEC)).toBe('end')
  })

  it('ズーム率が正でなければ null。0 除算の結果を掴ませない', () => {
    expect(clipHandleAtClientX(CLIP, 300, BOUNDS, 0)).toBeNull()
    expect(clipHandleAtClientX(CLIP, 300, BOUNDS, Number.NaN)).toBeNull()
  })

  it('掴める幅は秒ではなく画素で決まる（ズームを変えても同じ画素幅で掴める）', () => {
    // 端から 2px は常に端、8px は常に本体。秒に直すとズームごとに別の値になる。
    for (const pxPerSec of [10, 40, 160]) {
      const leftPx = BOUNDS.left + CLIP.startSec * pxPerSec

      expect(clipHandleAtClientX(CLIP, leftPx + 2, BOUNDS, pxPerSec)).toBe('start')
      expect(clipHandleAtClientX(CLIP, leftPx + 8, BOUNDS, pxPerSec)).toBe('body')
    }
  })
})

describe('clipDragHandleLabel', () => {
  it('掴んだ場所ごとに別の日本語を返す', () => {
    const labels = (['start', 'end', 'body'] as const).map(clipDragHandleLabel)
    expect(new Set(labels).size).toBe(3)
  })
})

// --- 位置を秒にする ---

describe('timelineSecAtClientX', () => {
  it('タイムラインの原点からの距離を秒にする', () => {
    expect(timelineSecAtClientX(xAt(3.5), BOUNDS, PX_PER_SEC)).toBeCloseTo(3.5, 10)
  })

  it('0 秒より前は潰さない（止めるのは applyClipDrag の仕事）', () => {
    expect(timelineSecAtClientX(xAt(-2), BOUNDS, PX_PER_SEC)).toBeCloseTo(-2, 10)
  })

  it('ズーム率が正でなければ 0。NaN や Infinity を配らない', () => {
    expect(timelineSecAtClientX(500, BOUNDS, 0)).toBe(0)
    expect(Number.isNaN(timelineSecAtClientX(500, BOUNDS, Number.NaN))).toBe(false)
  })
})

// --- 掴む ---

describe('beginClipDrag', () => {
  it('掴んだ場所と掴んだ時刻を覚える', () => {
    const drag = grab(CLIP, 5)

    expect(drag.handle).toBe('body')
    expect(drag.grabSec).toBeCloseTo(5, 10)
    expect(drag.origin).toEqual(CLIP)
  })

  it('クリップの外では null', () => {
    expect(beginClipDrag(CLIP, xAt(9), BOUNDS, PX_PER_SEC)).toBeNull()
  })

  it('掴んだ区間を作り直す。渡した物をそのまま持たない', () => {
    const span: TimeSpan = { startSec: 4, durationSec: 2 }
    const drag = grab(span, 5)

    expect(drag.origin).not.toBe(span)
  })
})

// --- 動かす ---

describe('applyClipDrag / 本体', () => {
  it('平行移動する。尺は変わらない', () => {
    const outcome = applyClipDrag(grab(CLIP, 5), xAt(7), BOUNDS, PX_PER_SEC, context())

    expect(outcome.span.startSec).toBeCloseTo(6, 10)
    expect(outcome.span.durationSec).toBe(2)
    expect(outcome.moved).toBe(true)
  })

  it('掴んだ点からのずれで動く。掴んだ瞬間に飛ばない', () => {
    const outcome = applyClipDrag(grab(CLIP, 5.9), xAt(5.9), BOUNDS, PX_PER_SEC, context())

    expect(outcome.span).toEqual(CLIP)
    expect(outcome.moved).toBe(false)
  })

  it('0 秒より前へは行かない。止めた理由を返す', () => {
    const outcome = applyClipDrag(grab(CLIP, 5), xAt(0), BOUNDS, PX_PER_SEC, context())

    expect(outcome.span).toEqual({ startSec: 0, durationSec: 2 })
    expect(outcome.limits.map((limit) => limit.kind)).toEqual(['origin'])
  })

  it('すでに 0 秒にあるクリップをさらに左へ引いても、黙って動かないだけにしない', () => {
    const atZero: TimeSpan = { startSec: 0, durationSec: 2 }
    const outcome = applyClipDrag(grab(atZero, 1), xAt(-3), BOUNDS, PX_PER_SEC, context())

    expect(outcome.moved).toBe(false)
    expect(outcome.limits.map((limit) => limit.kind)).toEqual(['origin'])
    expect(describeClipDrag(outcome).headline).toContain('0 秒より前へは置けない')
  })

  it('引いた先を残す。止めた値と引いた値の両方を説明できる', () => {
    const outcome = applyClipDrag(grab(CLIP, 5), xAt(0), BOUNDS, PX_PER_SEC, context())

    expect(outcome.requested.startSec).toBeCloseTo(-1, 10)
    expect(outcome.span.startSec).toBe(0)
  })
})

describe('applyClipDrag / 左端', () => {
  it('開始が動き、終了は動かない（尺が変わる）', () => {
    const outcome = applyClipDrag(grab(CLIP, 4.05), xAt(3.05), BOUNDS, PX_PER_SEC, context())

    expect(outcome.handle).toBe('start')
    expect(outcome.span.startSec).toBeCloseTo(3, 10)
    expect(outcome.span.startSec + outcome.span.durationSec).toBeCloseTo(6, 10)
  })

  it('最小の尺のちょうど境界までは縮められる', () => {
    const target = 6 - MIN_CLIP_DURATION_SEC
    const outcome = applyClipDrag(
      grab(CLIP, 4.05),
      xAt(target + 0.05),
      BOUNDS,
      PX_PER_SEC,
      context(),
    )

    expect(outcome.span.durationSec).toBeCloseTo(MIN_CLIP_DURATION_SEC, 10)
    expect(outcome.limits).toEqual([])
  })

  it('端数で止めたことにしない。ちょうど最小の尺に置いたら指摘は出ない', () => {
    // 画素から秒に直すと端数が出る。当たっていない壁に当たったように見せない。
    const outcome = applyClipDrag(grab(CLIP, 4.05), xAt(5.95), BOUNDS, PX_PER_SEC, context())

    // 左端は終了を動かさないので、尺は必ず「終了 - 開始」。float の端数はここに出る。
    expect(outcome.span.durationSec).toBeCloseTo(MIN_CLIP_DURATION_SEC, 10)
    expect(outcome.span.startSec + outcome.span.durationSec).toBe(6)
    expect(outcome.limits).toEqual([])
  })

  it('最小の尺を越えて縮めようとしたら止め、理由を返す', () => {
    const outcome = applyClipDrag(grab(CLIP, 4.05), xAt(6.05), BOUNDS, PX_PER_SEC, context())

    expect(outcome.span.durationSec).toBeCloseTo(MIN_CLIP_DURATION_SEC, 10)
    expect(outcome.span.startSec + outcome.span.durationSec).toBeCloseTo(6, 10)
    expect(outcome.limits.map((limit) => limit.kind)).toEqual(['min_duration'])
  })

  it('最小の尺より 0 秒のほうが強い。両方の理由を返す', () => {
    // 終了が 0.05s のクリップは、最小の尺を保つと開始が負になる。時刻は負にできない。
    const shortClip: TimeSpan = { startSec: 0.02, durationSec: 0.03 }
    const outcome = applyClipDrag(grab(shortClip, 0.03), xAt(0.04), BOUNDS, PX_PER_SEC, context())

    expect(outcome.span.startSec).toBe(0)
    expect(outcome.span.startSec + outcome.span.durationSec).toBeCloseTo(0.05, 10)
    expect(outcome.limits.map((limit) => limit.kind)).toEqual(['min_duration', 'origin'])
  })

  it('最小の尺を変えられる（既定値を焼き付けない）', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 4.05),
      xAt(6.05),
      BOUNDS,
      PX_PER_SEC,
      context({ minDurationSec: 0.5 }),
    )

    expect(outcome.span.durationSec).toBeCloseTo(0.5, 10)
  })
})

describe('applyClipDrag / 右端', () => {
  it('尺だけ変わる。開始は動かない', () => {
    const outcome = applyClipDrag(grab(CLIP, 5.95), xAt(8.95), BOUNDS, PX_PER_SEC, context())

    expect(outcome.handle).toBe('end')
    expect(outcome.span.startSec).toBe(4)
    expect(outcome.span.durationSec).toBeCloseTo(5, 10)
  })

  it('最小の尺のちょうど境界までは縮められる', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5.95),
      xAt(4 + MIN_CLIP_DURATION_SEC - 0.05),
      BOUNDS,
      PX_PER_SEC,
      context(),
    )

    expect(outcome.span.durationSec).toBeCloseTo(MIN_CLIP_DURATION_SEC, 10)
    expect(outcome.limits).toEqual([])
  })

  it('開始より左へ引いても尺は負にならない。止めた理由を返す', () => {
    const outcome = applyClipDrag(grab(CLIP, 5.95), xAt(1), BOUNDS, PX_PER_SEC, context())

    expect(outcome.span.startSec).toBe(4)
    expect(outcome.span.durationSec).toBe(MIN_CLIP_DURATION_SEC)
    expect(outcome.limits.map((limit) => limit.kind)).toEqual(['min_duration'])
  })
})

// --- タイムラインの終端 ---

describe('applyClipDrag / 終端', () => {
  it('終端より後ろへも置ける。止めずに理由だけ返す', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5),
      xAt(10),
      BOUNDS,
      PX_PER_SEC,
      context({ timelineEndSec: 10 }),
    )

    expect(outcome.span.startSec).toBeCloseTo(9, 10)
    expect(outcome.span.durationSec).toBe(2)
    expect(outcome.limits.map((limit) => limit.kind)).toEqual(['past_end'])
  })

  it('終端ちょうどに収まるなら指摘しない', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5),
      xAt(9),
      BOUNDS,
      PX_PER_SEC,
      context({ timelineEndSec: 10 }),
    )

    expect(outcome.span.startSec + outcome.span.durationSec).toBeCloseTo(10, 10)
    expect(outcome.limits).toEqual([])
  })

  it('終端が分からない（0）なら終端の指摘はしない', () => {
    const outcome = applyClipDrag(grab(CLIP, 5), xAt(50), BOUNDS, PX_PER_SEC, context())

    expect(outcome.limits).toEqual([])
  })
})

// --- 吸着 ---

describe('applyClipDrag / 吸着', () => {
  it('許容距離内の候補へ寄せる。何に吸着したかも返す', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 4.05),
      xAt(3.05 + 0.1),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(3, 'shot_edge')] }),
    )

    expect(outcome.span.startSec).toBe(3)
    const notice = outcome.snapNotices[0]
    expect(notice?.state).toBe('snapped')
    expect(notice?.state === 'snapped' ? notice.kind : null).toBe('shot_edge')
  })

  it('許容距離のちょうど境界は吸着する', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 4.05),
      xAt(4.05 - TOLERANCE_SEC),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(4)] }),
    )

    expect(outcome.span.startSec).toBe(4)
    expect(outcome.snapNotices[0]?.state).toBe('snapped')
  })

  it('許容距離を越えたら吸着しない。寄らなかったことも説明する', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 4.05),
      xAt(4.05 - TOLERANCE_SEC - 0.01),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(4)] }),
    )

    expect(outcome.span.startSec).toBeCloseTo(4 - TOLERANCE_SEC - 0.01, 10)
    expect(outcome.snapNotices[0]?.state).toBe('none')
  })

  it('吸着を切れる。切ったことは値ではなく状態で分かる', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 4.05),
      xAt(3.06),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(3)], snapEnabled: false }),
    )

    expect(outcome.span.startSec).toBeCloseTo(3.01, 10)
    expect(outcome.snapNotices[0]?.state).toBe('off')
  })

  it('左端を引いたとき、説明は開始の 1 件だけ。終了は動かさないので吸着させない', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 4.05),
      xAt(3.05),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(6.1, 'shot_edge')] }),
    )

    expect(outcome.snapNotices).toHaveLength(1)
    expect(outcome.snapNotices[0]?.label).toBe('開始')
    expect(outcome.span.startSec + outcome.span.durationSec).toBeCloseTo(6, 10)
  })

  it('右端を引いたとき、説明は終了の 1 件だけ。開始は動かさない', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5.95),
      xAt(7.05),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(4.1, 'shot_edge'), candidate(7)] }),
    )

    expect(outcome.snapNotices).toHaveLength(1)
    expect(outcome.snapNotices[0]?.label).toBe('終了')
    expect(outcome.span.startSec).toBe(4)
    expect(outcome.span.durationSec).toBeCloseTo(3, 10)
  })

  it('本体を動かすときは近いほうの端へ寄せ、尺は変えない', () => {
    // 引いた先は 3.0–5.0。開始は 2.9（0.1 離れ）、終了は 5.05（0.05 離れ）。終了が勝つ。
    const outcome = applyClipDrag(
      grab(CLIP, 5),
      xAt(4),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(2.9), candidate(5.05)] }),
    )

    expect(outcome.span.startSec).toBeCloseTo(3.05, 10)
    expect(outcome.span.durationSec).toBe(2)
  })

  it('本体を動かして片方を見送ったら、見送った理由を残す', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5),
      xAt(4),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(2.9), candidate(5.05)] }),
    )

    expect(outcome.snapNotices.map((notice) => notice.state)).toEqual(['rejected', 'snapped'])
    expect(outcome.snapNotices[0]?.message).toContain('平行移動では尺を変えない')
  })

  it('同じ距離なら開始を使う（先に読む側を安定させる）', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5),
      xAt(4),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(2.95), candidate(5.05)] }),
    )

    expect(outcome.span.startSec).toBeCloseTo(2.95, 10)
    expect(outcome.snapNotices.map((notice) => notice.state)).toEqual(['snapped', 'rejected'])
  })

  it('片方しか寄らないなら、寄らなかった側もそのまま説明する', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5),
      xAt(4),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(2.9)] }),
    )

    expect(outcome.span.startSec).toBeCloseTo(2.9, 10)
    expect(outcome.snapNotices.map((notice) => notice.state)).toEqual(['snapped', 'none'])
  })

  it('吸着したあとでも 0 秒の壁は効く。吸着で押し戻されない', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5),
      xAt(1),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: [candidate(-0.05, 'origin')] }),
    )

    expect(outcome.span.startSec).toBe(0)
    expect(outcome.limits.map((limit) => limit.kind)).toEqual(['origin'])
  })
})

// --- 自分の端を候補から外す ---

const projectId = ProjectId.parse(PROJECT_ID)
const camera = cameraJson as ShotCamera

const makeShot = (suffix: string, startSec: number, durationSec: number): Shot => ({
  id: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5${suffix}`),
  projectId,
  sequenceId: null,
  order: 1000,
  code: `S01-${suffix}`,
  startSec,
  durationSec,
  sourceInSec: 0,
  description: '',
  dialogue: null,
  camera,
  mood: null,
  locationId: null,
  sourceType: { type: 'ai_video' },
  selectedTakeId: null,
  status: 'draft',
  lockedAt: null,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
  updatedAt: new Date('2026-09-16T00:00:00.000Z'),
})

const makeClip = (suffix: string, startSec: number, durationSec: number): TimelineClip => ({
  id: TimelineClipId.parse(`01ARZ3NDEKTSV4RRFFQ69G6${suffix}`),
  projectId,
  track: 'TEXT',
  startSec,
  durationSec,
  layer: 0,
  content: { type: 'text', templateKey: 'lower-third', params: {} },
  opacity: 1,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
})

const noBeats: BeatSource = { state: 'no_track' }

describe('candidatesForClipDrag', () => {
  const dragged = makeClip('AA0', 4, 2)
  const other = makeClip('AA1', 9, 1)
  const source: SnapSource = {
    shots: [makeShot('BB0', 0, 3)],
    clips: [dragged, other],
    beatSource: noBeats,
    timelineEndSec: 12,
  }

  it('動かしている当人の端は候補に入らない（自分の端に吸着して動けなくなるため）', () => {
    const times = candidatesForClipDrag(source, dragged.id).map((entry) => entry.atSec)

    expect(times).not.toContain(4)
    expect(times).not.toContain(6)
  })

  it('他のクリップと Shot の端は候補に残る', () => {
    const times = candidatesForClipDrag(source, dragged.id).map((entry) => entry.atSec)

    expect(times).toContain(9)
    expect(times).toContain(10)
    expect(times).toContain(3)
  })

  it('自分を外した候補では、動かしていないときでも自分の開始に吸着しない', () => {
    const outcome = applyClipDrag(
      grab(CLIP, 5),
      xAt(5.3),
      BOUNDS,
      PX_PER_SEC,
      context({ candidates: candidatesForClipDrag(source, dragged.id) }),
    )

    expect(outcome.span.startSec).toBeCloseTo(4.3, 10)
    expect(outcome.moved).toBe(true)
  })
})

// --- 入力を変更しない ---

describe('イミュータビリティ', () => {
  it('掴んだ情報も区間も変更しない', () => {
    const span: TimeSpan = Object.freeze({ startSec: 4, durationSec: 2 })
    const drag = Object.freeze(grab(span, 5))
    const before = { ...drag.origin }

    const outcome = applyClipDrag(drag, xAt(7), BOUNDS, PX_PER_SEC, context())

    expect(drag.origin).toEqual(before)
    expect(span).toEqual({ startSec: 4, durationSec: 2 })
    expect(outcome.span).not.toBe(drag.origin)
  })

  it('同じ入力からは同じ結果が出る（時計にも乱数にも依存しない）', () => {
    const drag = grab(CLIP, 5)
    const args = [xAt(7), BOUNDS, PX_PER_SEC, context()] as const

    expect(applyClipDrag(drag, ...args)).toEqual(applyClipDrag(drag, ...args))
  })
})

// --- 説明 ---

describe('describeClipDrag', () => {
  it('本体を動かしたら、どれだけ動いたかと尺が変わっていないことを言う', () => {
    const summary = describeClipDrag(
      applyClipDrag(grab(CLIP, 5), xAt(7), BOUNDS, PX_PER_SEC, context()),
    )

    expect(summary.headline).toContain('+2.000s')
    expect(summary.headline).toContain('尺 2.00s は変えていません')
    expect(summary.spanText).toBe('0:06.00 – 0:08.00')
  })

  it('左端を引いたら、終了が動いていないことを言う', () => {
    const summary = describeClipDrag(
      applyClipDrag(grab(CLIP, 4.05), xAt(3.05), BOUNDS, PX_PER_SEC, context()),
    )

    expect(summary.headline).toContain('終了 0:06.00 は動かしていません')
    expect(summary.headline).toContain('2.00s → 3.00s')
  })

  it('右端を引いたら、開始が動いていないことを言う', () => {
    const summary = describeClipDrag(
      applyClipDrag(grab(CLIP, 5.95), xAt(7.95), BOUNDS, PX_PER_SEC, context()),
    )

    expect(summary.headline).toContain('開始 0:04.00 は動かしていません')
    expect(summary.headline).toContain('+2.000s')
  })

  it('動いたけれど途中で止めた場合も、止めた理由を必ず返す', () => {
    const summary = describeClipDrag(
      applyClipDrag(grab(CLIP, 4.05), xAt(6.05), BOUNDS, PX_PER_SEC, context()),
    )

    expect(summary.headline).toContain('尺 2.00s → 0.10s')
    expect(summary.limitMessages).toHaveLength(1)
    expect(summary.limitMessages[0]).toContain('尺は 0.10s より短くできない')
  })

  it('1 歩も動けなかった場合は、理由を見出しに出す（他に読むものが無いため）', () => {
    const atZero: TimeSpan = { startSec: 0, durationSec: 2 }
    const summary = describeClipDrag(
      applyClipDrag(grab(atZero, 1), xAt(-3), BOUNDS, PX_PER_SEC, context()),
    )

    expect(summary.headline).toContain('動かせませんでした')
    expect(summary.headline).toContain('0 秒より前へは置けない')
  })

  it('まだ動いていないことと、止められたことを区別する', () => {
    const summary = describeClipDrag(
      applyClipDrag(grab(CLIP, 5), xAt(5), BOUNDS, PX_PER_SEC, context()),
    )

    expect(summary.headline).toContain('まだ動いていません')
    expect(summary.limitMessages).toEqual([])
  })

  it('終端を越えただけなら「動かせなかった」とは言わない（止めていないため）', () => {
    const summary = describeClipDrag(
      applyClipDrag(grab(CLIP, 5), xAt(10), BOUNDS, PX_PER_SEC, context({ timelineEndSec: 10 })),
    )

    expect(summary.headline).not.toContain('動かせませんでした')
    expect(summary.limitMessages[0]).toContain('タイムラインの終端')
  })

  it('吸着の説明をそのまま読める形で渡す', () => {
    const summary = describeClipDrag(
      applyClipDrag(
        grab(CLIP, 4.05),
        xAt(3.06),
        BOUNDS,
        PX_PER_SEC,
        context({ candidates: [candidate(3, 'shot_edge')] }),
      ),
    )

    expect(summary.snapMessages[0]).toContain('開始:')
    expect(summary.snapMessages[0]).toContain('隣の Shot の端に吸着しました')
  })
})
