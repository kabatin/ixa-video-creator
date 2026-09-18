import {
  ProjectId,
  ShotId,
  TimelineClipId,
  type MusicSection,
  type Shot,
  type ShotCamera,
  type TimelineClip,
} from '@ixa/domain'
import type { SnapCandidate, SnapResult } from '@ixa/timeline'
import { describe, expect, it } from 'vitest'
import { PROJECT_ID, cameraJson } from '@/__tests__/fixtures'
import {
  buildSnapCandidates,
  countSnapCandidates,
  describeBeatSource,
  describeSnapResult,
  snapNoticeClassName,
  snapSpan,
  snapTargetLabel,
  snapToleranceSec,
  type BeatSource,
  type SnapSource,
} from '@/lib/timeline-snap'

const projectId = ProjectId.parse(PROJECT_ID)
const camera = cameraJson as ShotCamera

const shotId = (suffix: string): Shot['id'] => ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5${suffix}`)

const clipId = (suffix: string): TimelineClip['id'] =>
  TimelineClipId.parse(`01ARZ3NDEKTSV4RRFFQ69G6${suffix}`)

const makeShot = (suffix: string, startSec: number, durationSec: number): Shot => ({
  id: shotId(suffix),
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
  continuityMode: 'independent',
  locationId: null,
  sourceType: { type: 'ai_video' },
  selectedTakeId: null,
  status: 'draft',
  lockedAt: null,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
  updatedAt: new Date('2026-09-16T00:00:00.000Z'),
})

const makeClip = (suffix: string, startSec: number, durationSec: number): TimelineClip => ({
  id: clipId(suffix),
  projectId,
  track: 'TEXT',
  startSec,
  durationSec,
  layer: 0,
  content: { type: 'text', templateKey: 'lower-third', params: {} },
  opacity: 1,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
})

/** 端をわざと他の候補とずらす。重なると優先度の高い種別に吸収されて消えるため。 */
const SECTION: MusicSection = { start: 1.75, end: 7.5, label: 'intro', energy: 0.4 }

const availableBeats: BeatSource = {
  state: 'available',
  trackTitle: 'iXA CUP テーマ',
  beats: [0, 0.5, 1, 1.5, 2],
  sections: [SECTION],
  drops: [6],
}

const makeSource = (overrides: Partial<SnapSource> = {}): SnapSource => ({
  shots: [makeShot('FA0', 0, 4), makeShot('FA1', 4, 4)],
  clips: [makeClip('FB0', 3, 1)],
  beatSource: availableBeats,
  timelineEndSec: 12,
  ...overrides,
})

const candidate = (atSec: number, kind: SnapCandidate['kind']): SnapCandidate => ({ atSec, kind })

const snappedResult = (atSec: number, kind: SnapCandidate['kind']): SnapResult => ({
  atSec,
  snappedTo: candidate(atSec, kind),
})

describe('snapTargetLabel', () => {
  it('種別ごとに別の日本語を返す（どれに吸着したかを読み分けられる）', () => {
    const labels = (
      ['shot_edge', 'origin', 'end', 'clip_edge', 'section', 'drop', 'beat'] as const
    ).map(snapTargetLabel)
    expect(new Set(labels).size).toBe(labels.length)
    expect(snapTargetLabel('beat')).toBe('ビート')
    expect(snapTargetLabel('shot_edge')).toBe('隣の Shot の端')
  })
})

describe('snapToleranceSec', () => {
  it('ズームが深いほど許容距離は短い（画面上の距離で一定にするため）', () => {
    expect(snapToleranceSec(10)).toBeCloseTo(0.8, 10)
    expect(snapToleranceSec(40)).toBeCloseTo(0.2, 10)
    expect(snapToleranceSec(160)).toBeCloseTo(0.05, 10)
  })

  it('ズーム率が正の有限数でなければ投げる（黙って 0 秒にしない）', () => {
    expect(() => snapToleranceSec(0)).toThrow(RangeError)
    expect(() => snapToleranceSec(Number.NaN)).toThrow(RangeError)
  })
})

describe('buildSnapCandidates', () => {
  it('ビート・セクション・ドロップ・Shot の端・クリップの端をすべて候補にする', () => {
    const kinds = new Set(buildSnapCandidates(makeSource(), {}).map((entry) => entry.kind))
    expect(kinds).toContain('beat')
    expect(kinds).toContain('section')
    expect(kinds).toContain('drop')
    expect(kinds).toContain('shot_edge')
    expect(kinds).toContain('clip_edge')
    expect(kinds).toContain('end')
  })

  it('除外したクリップの端は候補から消える（自分の端へ吸着して動かせなくなるのを防ぐ）', () => {
    const source = makeSource({ clips: [makeClip('FB0', 3.3, 0.4)] })
    const withSelf = buildSnapCandidates(source, {})
    const withoutSelf = buildSnapCandidates(source, { clipId: clipId('FB0') })

    expect(withSelf.some((entry) => entry.atSec === 3.3)).toBe(true)
    expect(withoutSelf.some((entry) => entry.atSec === 3.3)).toBe(false)
    expect(withoutSelf.some((entry) => entry.atSec === 3.7)).toBe(false)
  })

  it('同時刻の候補は優先度の高い種別だけが残る（理由の表示がビートに化けない）', () => {
    // Shot は 0..4 / 4..8。ビート 2.0 と同時刻にクリップの端を置く。
    const source = makeSource({ clips: [makeClip('FB0', 2, 1)] })
    const atTwo = buildSnapCandidates(source, {}).filter((entry) => entry.atSec === 2)
    expect(atTwo).toEqual([{ atSec: 2, kind: 'clip_edge' }])
  })

  it('除外した Shot の端も候補から消える', () => {
    const source = makeSource({ shots: [makeShot('FA0', 0, 4), makeShot('FA1', 5.25, 2)] })
    const withoutSelf = buildSnapCandidates(source, { shotId: shotId('FA1') })
    expect(withoutSelf.some((entry) => entry.atSec === 5.25)).toBe(false)
  })

  it('ビートが取れていない出どころならビート候補は 1 件も出ない', () => {
    const source = makeSource({ beatSource: { state: 'no_analysis', trackTitle: 'テーマ' } })
    const kinds = buildSnapCandidates(source, {}).map((entry) => entry.kind)
    expect(kinds).not.toContain('beat')
    expect(kinds).not.toContain('section')
    expect(kinds).toContain('shot_edge')
  })

  it('入力の配列を変更しない', () => {
    const shots = [makeShot('FA0', 0, 4)]
    const clips = [makeClip('FB0', 3, 1)]
    const source = makeSource({ shots, clips })
    buildSnapCandidates(source, { clipId: clipId('FB0') })
    expect(shots).toHaveLength(1)
    expect(clips).toHaveLength(1)
    expect(clips[0]?.startSec).toBe(3)
  })
})

describe('countSnapCandidates', () => {
  it('0 件の種別は並べない', () => {
    const counts = countSnapCandidates([candidate(0, 'origin'), candidate(1, 'beat')])
    expect(counts.map((entry) => entry.kind)).toEqual(['beat', 'origin'])
  })

  it('同じ種別をまとめて数える', () => {
    const counts = countSnapCandidates([
      candidate(0, 'beat'),
      candidate(1, 'beat'),
      candidate(2, 'shot_edge'),
    ])
    expect(counts).toEqual([
      { kind: 'shot_edge', label: '隣の Shot の端', count: 1 },
      { kind: 'beat', label: 'ビート', count: 2 },
    ])
  })

  it('候補が無ければ空（「候補ゼロ」を呼び出し側が判定できる）', () => {
    expect(countSnapCandidates([])).toEqual([])
  })
})

describe('describeBeatSource', () => {
  it('解析があるときは件数まで出す', () => {
    const notice = describeBeatSource(availableBeats)
    expect(notice.tone).toBe('ok')
    expect(notice.headline).toContain('5 件')
  })

  it('楽曲が無い / 解析が無い / ビートが 0 件 / 読めていない を別の文で出す', () => {
    const notices = [
      describeBeatSource({ state: 'no_track' }),
      describeBeatSource({ state: 'no_analysis', trackTitle: 'テーマ' }),
      describeBeatSource({ state: 'no_beats', trackTitle: 'テーマ' }),
      describeBeatSource({ state: 'unreadable', reason: '503' }),
    ]
    expect(new Set(notices.map((notice) => notice.headline)).size).toBe(4)
  })

  it('読めていないときだけ error（＝「候補が無い」ではなく「分からない」）', () => {
    expect(describeBeatSource({ state: 'unreadable', reason: '503' }).tone).toBe('error')
    expect(describeBeatSource({ state: 'no_track' }).tone).toBe('warn')
    expect(describeBeatSource({ state: 'no_analysis', trackTitle: 'x' }).tone).toBe('warn')
  })

  it('読めていないときは理由を落とさない', () => {
    const notice = describeBeatSource({ state: 'unreadable', reason: 'ECONNREFUSED' })
    expect(notice.detail).toContain('ECONNREFUSED')
  })

  it('候補が減る状態では「何が候補として残るか」を必ず書く', () => {
    for (const source of [
      { state: 'no_track' } as const,
      { state: 'no_analysis', trackTitle: 'テーマ' } as const,
      { state: 'no_beats', trackTitle: 'テーマ' } as const,
    ]) {
      expect(describeBeatSource(source).detail).toContain('Shot の端')
    }
  })
})

describe('describeSnapResult', () => {
  it('snappedTo が null なら「吸着しなかった」', () => {
    const notice = describeSnapResult('開始', 1.23, { atSec: 1.23, snappedTo: null })
    expect(notice.state).toBe('none')
    expect(notice.message).toContain('吸着しませんでした')
  })

  it('吸着したら種別の名前を出す', () => {
    const notice = describeSnapResult('開始', 1.4, snappedResult(1.5, 'beat'))
    expect(notice.state).toBe('snapped')
    expect(notice.message).toContain('ビートに吸着しました')
  })

  it('値が変わらなくても「吸着した」と出す（数字だけで判断させない）', () => {
    const notice = describeSnapResult('開始', 2, snappedResult(2, 'shot_edge'))
    expect(notice.state).toBe('snapped')
    expect(notice.message).toContain('隣の Shot の端に吸着しました')
    expect(notice.message).toContain('のまま')
  })

  it('動いた向きを符号つきで出す', () => {
    expect(describeSnapResult('開始', 1.4, snappedResult(1.5, 'beat')).message).toContain('+0.100s')
    expect(describeSnapResult('開始', 1.6, snappedResult(1.5, 'beat')).message).toContain('-0.100s')
  })
})

describe('snapSpan', () => {
  const candidates: readonly SnapCandidate[] = [
    candidate(0, 'origin'),
    candidate(1, 'beat'),
    candidate(2, 'beat'),
    candidate(3, 'beat'),
  ]

  it('OFF なら値を動かさず、動かしていないことを出す', () => {
    const outcome = snapSpan({ startSec: 1.4, durationSec: 0.7 }, candidates, 0.2, false)
    expect(outcome.startSec).toBe(1.4)
    expect(outcome.durationSec).toBe(0.7)
    expect(outcome.notices.map((notice) => notice.state)).toEqual(['off', 'off'])
  })

  it('ON なら開始と終了の両方を寄せ、尺を組み直す', () => {
    const outcome = snapSpan({ startSec: 0.9, durationSec: 1.15 }, candidates, 0.2, true)
    expect(outcome.startSec).toBeCloseTo(1, 10)
    expect(outcome.durationSec).toBeCloseTo(1, 10)
    expect(outcome.notices.map((notice) => notice.state)).toEqual(['snapped', 'snapped'])
  })

  it('終了が候補から遠ければ尺は入力のまま（開始だけ寄せる）', () => {
    const outcome = snapSpan({ startSec: 0.95, durationSec: 0.6 }, candidates, 0.1, true)
    expect(outcome.startSec).toBeCloseTo(1, 10)
    expect(outcome.durationSec).toBeCloseTo(0.6, 10)
    expect(outcome.notices[1]?.state).toBe('none')
  })

  it('寄せると尺が 0 以下になるときは終了の吸着を見送り、見送った事実を残す', () => {
    // 開始 1.05 → 1、終了 1.1 → 1 になると尺が 0 になる。
    const outcome = snapSpan({ startSec: 1.05, durationSec: 0.05 }, candidates, 0.2, true)
    expect(outcome.startSec).toBeCloseTo(1, 10)
    expect(outcome.durationSec).toBeCloseTo(0.05, 10)
    expect(outcome.notices[1]?.state).toBe('rejected')
    expect(outcome.notices[1]?.message).toContain('見送りました')
  })

  it('候補が 1 件も無ければ寄らず、寄らなかったことを出す', () => {
    const outcome = snapSpan({ startSec: 1.4, durationSec: 0.7 }, [], 0.2, true)
    expect(outcome.startSec).toBe(1.4)
    expect(outcome.durationSec).toBe(0.7)
    expect(outcome.notices.map((notice) => notice.state)).toEqual(['none', 'none'])
  })

  it('入力のオブジェクトを変更しない', () => {
    const span = { startSec: 0.9, durationSec: 1.15 }
    snapSpan(span, candidates, 0.2, true)
    expect(span).toEqual({ startSec: 0.9, durationSec: 1.15 })
  })

  it('開始と終了の 2 件を必ず返す（片方だけ黙って消さない）', () => {
    for (const enabled of [true, false]) {
      const outcome = snapSpan({ startSec: 0.9, durationSec: 1.15 }, candidates, 0.2, enabled)
      expect(outcome.notices.map((notice) => notice.label)).toEqual(['開始', '終了'])
    }
  })
})

describe('buildSnapCandidates と snapSpan の組み合わせ', () => {
  it('自分を除外しないと動かせない（除外すると隣のビートへ動く）', () => {
    const source = makeSource({
      shots: [],
      clips: [makeClip('FB0', 1.05, 0.5)],
      beatSource: availableBeats,
      timelineEndSec: 12,
    })

    const withSelf = snapSpan(
      { startSec: 1.05, durationSec: 0.5 },
      buildSnapCandidates(source, {}),
      0.2,
      true,
    )
    expect(withSelf.startSec).toBeCloseTo(1.05, 10)

    const withoutSelf = snapSpan(
      { startSec: 1.05, durationSec: 0.5 },
      buildSnapCandidates(source, { clipId: clipId('FB0') }),
      0.2,
      true,
    )
    expect(withoutSelf.startSec).toBeCloseTo(1, 10)
  })
})

describe('snapNoticeClassName', () => {
  it('状態ごとに別の見た目を返す', () => {
    const classes = (['off', 'none', 'snapped', 'rejected'] as const).map(snapNoticeClassName)
    expect(new Set(classes).size).toBe(4)
  })
})
