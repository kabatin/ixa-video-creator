import {
  ProjectId,
  ShotId,
  TRANSITION_SUPPORT,
  TextTemplateKey,
  TimelineClipId,
  TransitionId,
  TransitionType,
  isDegradedTransition,
  type Shot,
  type ShotCamera,
  type TimelineClip,
  type TimelineTrack,
  type Transition,
} from '@ixa/domain'
import { TIMELINE_ISSUE_CODES, validateTimeline, type TimelineSource } from '@ixa/timeline'
import { describe, expect, it } from 'vitest'
import { PROJECT_ID, cameraJson } from '@/__tests__/fixtures'
import {
  DEFAULT_TEXT_CLIP_DURATION_SEC,
  DEFAULT_TRANSITION_DURATION_SEC,
  INSERTABLE_TRANSITION_TYPES,
  MIN_TEXT_CLIP_DURATION_SEC,
  defaultTransitionDurationSec,
  maxTransitionDurationSec,
  probeTextInsertion,
  textInsertionGaps,
  textTemplateOptions,
  transitionInsertionLeftPx,
  transitionInsertionPoints,
  transitionTypeOptions,
  validateTextClipInsert,
  validateTransitionInsert,
} from '@/lib/timeline-insert'

const projectId = ProjectId.parse(PROJECT_ID)
const camera = cameraJson as ShotCamera

const shotId = (suffix: string): Shot['id'] => ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5${suffix}`)
const clipId = (suffix: string): TimelineClip['id'] =>
  TimelineClipId.parse(`01ARZ3NDEKTSV4RRFFQ69G6${suffix}`)

const makeShot = (suffix: string, code: string, startSec: number, durationSec: number): Shot => ({
  id: shotId(suffix),
  projectId,
  sequenceId: null,
  order: 1000,
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
  content: { type: 'text', templateKey: 'plain', params: { text: 'さきにある字' } },
  opacity: 1,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
})

const makeTransition = (
  from: Shot,
  to: Shot,
  durationSec: number,
  type: Transition['type'] = 'dissolve',
): Transition => ({
  id: TransitionId.parse('01ARZ3NDEKTSV4RRFFQ69G7T00'),
  projectId,
  fromShotId: from.id,
  toShotId: to.id,
  type,
  durationSec,
})

const SHOT_A = makeShot('FA0', 'S01-010', 0, 4)
const SHOT_B = makeShot('FB0', 'S01-020', 4, 2)
const SHOT_C = makeShot('FC0', 'S01-030', 6, 5)

const transitionDraft = (type: string, durationSec: string) => ({ type, durationSec })

// --- 挿せる場所（トランジション） ---

describe('トランジションを挿せる場所', () => {
  it('Shot が 0 個なら境目が無い', () => {
    expect(transitionInsertionPoints([], [])).toEqual([])
  })

  it('Shot が 1 個でも境目が無い', () => {
    expect(transitionInsertionPoints([SHOT_A], [])).toEqual([])
  })

  it('Shot が 2 個なら境目が 1 つで、空いていれば挿せる', () => {
    const points = transitionInsertionPoints([SHOT_A, SHOT_B], [])
    expect(points).toHaveLength(1)
    expect(points[0]?.state).toBe('insertable')
    expect(points[0]?.existing).toBeNull()
    expect(points[0]?.atSec).toBe(4)
    expect(points[0]?.gapSec).toBe(0)
    expect(points[0]?.message).toContain('S01-010')
    expect(points[0]?.message).toContain('S01-020')
  })

  it('Shot が 3 個なら境目は 2 つ', () => {
    expect(transitionInsertionPoints([SHOT_A, SHOT_B, SHOT_C], [])).toHaveLength(2)
  })

  it('並び順に依存せず startSec 順の境目を出す', () => {
    const points = transitionInsertionPoints([SHOT_C, SHOT_A, SHOT_B], [])
    expect(points.map((point) => point.pair.from.code)).toEqual(['S01-010', 'S01-020'])
  })

  it('既にトランジションがある境目は差し替え・削除ができる', () => {
    const existing = makeTransition(SHOT_A, SHOT_B, 0.4)
    const points = transitionInsertionPoints([SHOT_A, SHOT_B], [existing])
    expect(points[0]?.state).toBe('replaceable')
    expect(points[0]?.existing?.id).toBe(existing.id)
    expect(points[0]?.message).toContain('ディゾルブ')
  })

  it('置かれているのが cut なら「効果が無い」と伝える', () => {
    const points = transitionInsertionPoints([SHOT_A, SHOT_B], [makeTransition(SHOT_A, SHOT_B, 0, 'cut')])
    expect(points[0]?.notices.join('')).toContain('効果が無い')
  })

  it('置かれているのが絵に出ない種別なら注意を出す', () => {
    const points = transitionInsertionPoints(
      [SHOT_A, SHOT_B],
      [makeTransition(SHOT_A, SHOT_B, 0.4, 'glitch')],
    )
    expect(points[0]?.notices.join('')).toContain('ただのカット')
  })

  it('隣り合う Shot に隙間があるとき、中央を指し、黒画面になると伝える', () => {
    const gapped = makeShot('FD0', 'S01-021', 5, 2)
    const points = transitionInsertionPoints([SHOT_A, gapped], [])
    expect(points[0]?.fromEndSec).toBe(4)
    expect(points[0]?.toStartSec).toBe(5)
    expect(points[0]?.atSec).toBe(4.5)
    expect(points[0]?.gapSec).toBe(1)
    expect(points[0]?.notices.join('')).toContain('黒画面')
  })

  it('px は secondsToPx と同じ換算', () => {
    const point = transitionInsertionPoints([SHOT_A, SHOT_B], [])[0]
    expect(point).toBeDefined()
    if (point) expect(transitionInsertionLeftPx(point, 40)).toBe(160)
  })

  it('入力の配列を変更しない', () => {
    const shots = [SHOT_C, SHOT_A, SHOT_B]
    const before = shots.map((shot) => shot.id)
    transitionInsertionPoints(shots, [])
    expect(shots.map((shot) => shot.id)).toEqual(before)
  })
})

// --- 選べる種別 ---

describe('選べるトランジションの種別', () => {
  it('cut は挿す対象に出さない', () => {
    expect(INSERTABLE_TRANSITION_TYPES).not.toContain('cut')
  })

  it('cut 以外はドメインの enum をそのまま出す（数え直さない）', () => {
    expect([...INSERTABLE_TRANSITION_TYPES].sort()).toEqual(
      TransitionType.options.filter((type) => type !== 'cut').sort(),
    )
  })

  it('絵に出ない種別は TRANSITION_SUPPORT と一致する', () => {
    const degraded = transitionTypeOptions()
      .filter((option) => option.degraded)
      .map((option) => option.type)
    expect([...degraded].sort()).toEqual(
      INSERTABLE_TRANSITION_TYPES.filter((type) => isDegradedTransition(type)).sort(),
    )
    for (const option of transitionTypeOptions()) {
      expect(option.support).toBe(TRANSITION_SUPPORT[option.type])
    }
  })

  it('絵に出ない種別だけ注意を持つ', () => {
    const byType = new Map(transitionTypeOptions().map((option) => [option.type, option]))
    expect(byType.get('dissolve')?.notice).toBeNull()
    expect(byType.get('wipe')?.notice).toContain('ただのカット')
  })
})

// --- 尺の上限 ---

describe('トランジションの尺の上限', () => {
  const pair = { from: SHOT_A, to: SHOT_B }

  it('両隣の Shot の短いほう', () => {
    expect(maxTransitionDurationSec(pair)).toBe(2)
    expect(maxTransitionDurationSec({ from: SHOT_B, to: SHOT_C })).toBe(2)
  })

  it('既定の尺は上限を超えない', () => {
    expect(defaultTransitionDurationSec(pair)).toBe(DEFAULT_TRANSITION_DURATION_SEC)
    const tiny = makeShot('FE0', 'S01-040', 0, 0.2)
    expect(defaultTransitionDurationSec({ from: tiny, to: SHOT_B })).toBe(0.2)
  })

  /**
   * **判定の正は `packages/timeline` の `validateTimeline`。**
   * ここが一致していることを固定し、向こうが変わったら落ちるようにする（lessons L-016）。
   */
  it('上限は validateTimeline の transition_too_long と一致する', () => {
    const source = (durationSec: number): TimelineSource => ({
      project: { fps: 30, resolution: { width: 1920, height: 1080 } },
      shots: [SHOT_A, SHOT_B],
      transitions: [makeTransition(SHOT_A, SHOT_B, durationSec)],
      clips: [],
      musicTracks: [],
      resolveShotMedia: () => 'https://example.invalid/a.mp4',
      resolveClipMedia: () => undefined,
    })
    const tooLong = (durationSec: number): boolean =>
      validateTimeline(source(durationSec)).some(
        (issue) => issue.code === TIMELINE_ISSUE_CODES.transitionTooLong,
      )

    const max = maxTransitionDurationSec(pair)
    expect(tooLong(max)).toBe(false)
    expect(tooLong(max * 1.01)).toBe(true)
  })
})

// --- トランジションの入力検証 ---

describe('トランジションの入力検証', () => {
  const point = transitionInsertionPoints([SHOT_A, SHOT_B], [])[0]

  it('境目が取れている（以降のテストの前提）', () => {
    expect(point).toBeDefined()
  })

  it('cut は理由つきで断る', () => {
    if (!point) throw new Error('境目が無い')
    const result = validateTransitionInsert(point, transitionDraft('cut', '0.5'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toHaveLength(1)
      expect(result.issues[0]?.field).toBe('type')
      expect(result.issues[0]?.message).toContain('削除')
    }
  })

  it('知らない種別を断る', () => {
    if (!point) throw new Error('境目が無い')
    const result = validateTransitionInsert(point, transitionDraft('crossfade', '0.5'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.field).toBe('type')
  })

  it('尺が空・非数・負・0 を断る', () => {
    if (!point) throw new Error('境目が無い')
    for (const raw of ['', 'abc', '-1', '0']) {
      const result = validateTransitionInsert(point, transitionDraft('dissolve', raw))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.issues[0]?.field).toBe('durationSec')
    }
  })

  it('上限ちょうどは通り、超えたら断る', () => {
    if (!point) throw new Error('境目が無い')
    expect(validateTransitionInsert(point, transitionDraft('dissolve', '2')).ok).toBe(true)
    const over = validateTransitionInsert(point, transitionDraft('dissolve', '2.5'))
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.issues[0]?.message).toContain('上限')
      expect(over.issues[0]?.message).toContain('S01-020')
    }
  })

  it('種類と尺が両方落ちたら 2 件とも返す', () => {
    if (!point) throw new Error('境目が無い')
    const result = validateTransitionInsert(point, transitionDraft('cut', ''))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.field).sort()).toEqual(['durationSec', 'type'])
    }
  })

  it('通ったら挿す値を返し、絵に出ない種別は注意を添える', () => {
    if (!point) throw new Error('境目が無い')
    const plain = validateTransitionInsert(point, transitionDraft('dissolve', '0.5'))
    expect(plain.ok).toBe(true)
    if (plain.ok) {
      expect(plain.value).toEqual({
        fromShotId: SHOT_A.id,
        toShotId: SHOT_B.id,
        type: 'dissolve',
        durationSec: 0.5,
      })
      expect(plain.notices).toEqual([])
    }

    const degraded = validateTransitionInsert(point, transitionDraft('glitch', '0.5'))
    expect(degraded.ok).toBe(true)
    if (degraded.ok) expect(degraded.notices.join('')).toContain('ただのカット')
  })
})

// --- テロップの空き区間 ---

describe('テロップを挿せる空き区間', () => {
  const PROGRAM_END = 11

  it('層が空なら先頭から終端までが空き', () => {
    expect(textInsertionGaps([], 'TEXT', 0, PROGRAM_END)).toEqual([
      { startSec: 0, durationSec: 11 },
    ])
  })

  it('Shot が無い（尺 0）なら空き区間も無い', () => {
    expect(textInsertionGaps([], 'TEXT', 0, 0)).toEqual([])
  })

  it('先頭・間・末尾の空きを出す', () => {
    const clips = [makeClip('C01', 'TEXT', 2, 2), makeClip('C02', 'TEXT', 6, 1)]
    expect(textInsertionGaps(clips, 'TEXT', 0, PROGRAM_END)).toEqual([
      { startSec: 0, durationSec: 2 },
      { startSec: 4, durationSec: 2 },
      { startSec: 7, durationSec: 4 },
    ])
  })

  it('隙間なく並んでいる層は空きが無い', () => {
    const clips = [
      makeClip('C03', 'TEXT', 0, 5),
      makeClip('C04', 'TEXT', 5, 6),
    ]
    expect(textInsertionGaps(clips, 'TEXT', 0, PROGRAM_END)).toEqual([])
  })

  it('別の層・別のトラックは干渉しない', () => {
    const clips = [makeClip('C05', 'TEXT', 0, 11, 1), makeClip('C06', 'VFX', 0, 11, 0)]
    expect(textInsertionGaps(clips, 'TEXT', 0, PROGRAM_END)).toEqual([
      { startSec: 0, durationSec: 11 },
    ])
  })

  it('終端をはみ出したクリップがあれば、そこで空きが尽きる', () => {
    const clips = [makeClip('C07', 'TEXT', 8, 20)]
    expect(textInsertionGaps(clips, 'TEXT', 0, PROGRAM_END)).toEqual([
      { startSec: 0, durationSec: 8 },
    ])
  })

  it('重なって置かれたクリップでも空きを二重に数えない', () => {
    const clips = [makeClip('C08', 'TEXT', 1, 4), makeClip('C09', 'TEXT', 2, 1)]
    expect(textInsertionGaps(clips, 'TEXT', 0, PROGRAM_END)).toEqual([
      { startSec: 0, durationSec: 1 },
      { startSec: 5, durationSec: 6 },
    ])
  })
})

// --- 指した時刻に置けるか ---

describe('指した時刻にテロップを置けるか', () => {
  const PROGRAM_END = 11
  const probe = (clips: readonly TimelineClip[], atSec: number, programEndSec = PROGRAM_END) =>
    probeTextInsertion({ clips, track: 'TEXT', layer: 0, atSec, programEndSec })

  it('空いていれば既定の尺で置ける', () => {
    const result = probe([], 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.span).toEqual({ startSec: 1, durationSec: DEFAULT_TEXT_CLIP_DURATION_SEC })
      expect(result.shortened).toBe(false)
      expect(result.gap).toEqual({ startSec: 0, durationSec: 11 })
    }
  })

  it('次のクリップにぶつかるなら手前までに縮める', () => {
    const result = probe([makeClip('C20', 'TEXT', 2, 3)], 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.span).toEqual({ startSec: 1, durationSec: 1 })
      expect(result.shortened).toBe(true)
      expect(result.message).toContain('縮めた')
    }
  })

  it('曲の終端までしか残っていないなら、そこまでに縮める', () => {
    const result = probe([], 10)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.span).toEqual({ startSec: 10, durationSec: 1 })
  })

  it('下限に満たない隙間は理由つきで断る', () => {
    const result = probe([makeClip('C21', 'TEXT', 1.3, 3)], 1)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('too_narrow')
      expect(result.message).toContain('残り')
      expect(result.blockedBy).toBeNull()
    }
  })

  it('下限ちょうどは置ける', () => {
    const result = probe([makeClip('C22', 'TEXT', 1 + MIN_TEXT_CLIP_DURATION_SEC, 3)], 1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.span.durationSec).toBe(MIN_TEXT_CLIP_DURATION_SEC)
  })

  it('クリップの上を指したら、ぶつかった相手を返して断る', () => {
    const blocking = makeClip('C23', 'TEXT', 2, 3)
    const result = probe([blocking], 3)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('occupied')
      expect(result.blockedBy).toBe(blocking.id)
      expect(result.message).toContain('既に')
    }
  })

  it('クリップの開始ちょうどは埋まっている、終了ちょうどは空いている', () => {
    const clips = [makeClip('C24', 'TEXT', 2, 3)]
    expect(probe(clips, 2).ok).toBe(false)
    expect(probe(clips, 5).ok).toBe(true)
  })

  it('曲の終端は置けない', () => {
    const result = probe([], PROGRAM_END)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('outside_program')
      expect(result.message).toContain('その外')
    }
  })

  it('負の時刻も断る', () => {
    const result = probe([], -1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('outside_program')
  })

  it('Shot がまだ無いときは、置けない理由をそう言う', () => {
    const result = probe([], 1, 0)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('no_program')
      expect(result.message).toContain('Shot')
    }
  })
})

// --- テロップの選択肢 ---

describe('選べるテロップのテンプレート', () => {
  it('ドメインの enum をそのまま出す（数え直さない）', () => {
    expect(textTemplateOptions().map((option) => option.key)).toEqual(TextTemplateKey.options)
  })

  it('絵に出るテンプレートには注意を付けない', () => {
    for (const option of textTemplateOptions()) {
      expect(option.notice === null).toBe(!option.placeholder)
    }
  })
})

// --- テロップの入力検証 ---

describe('テロップの入力検証', () => {
  const validate = (
    draft: {
      templateKey: string
      text: string
      startSec: string
      durationSec: string
    },
    clips: readonly TimelineClip[] = [],
  ) => validateTextClipInsert({ clips, track: 'TEXT', layer: 0, programEndSec: 11, draft })

  const GOOD = { templateKey: 'plain', text: 'いざ決戦', startSec: '1', durationSec: '3' }

  it('揃っていれば挿す値を返す', () => {
    const result = validate(GOOD)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        track: 'TEXT',
        layer: 0,
        startSec: 1,
        durationSec: 3,
        templateKey: 'plain',
        params: { text: 'いざ決戦' },
      })
      expect(result.notices).toEqual([])
    }
  })

  it('文字が空なら TextClipParams の言い分をそのまま返す', () => {
    const result = validate({ ...GOOD, text: '   ' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.field === 'text')).toBe(true)
    }
  })

  it('文字が長すぎるときも TextClipParams が断る', () => {
    const result = validate({ ...GOOD, text: 'あ'.repeat(1000) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.some((issue) => issue.field === 'text')).toBe(true)
  })

  it('知らないテンプレートを断る', () => {
    const result = validate({ ...GOOD, templateKey: 'karaoke' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.field).toBe('templateKey')
  })

  it('下限より短い尺を断る', () => {
    const result = validate({ ...GOOD, durationSec: '0.1' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.field).toBe('durationSec')
  })

  it('落ちた項目をすべて返す（1 つずつ直させない）', () => {
    const result = validate({ templateKey: '', text: '', startSec: '', durationSec: 'abc' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect([...new Set(result.issues.map((issue) => issue.field))].sort()).toEqual([
        'durationSec',
        'startSec',
        'templateKey',
        'text',
      ])
    }
  })

  it('同じ層のクリップと重なるなら、相手を示して断る', () => {
    const result = validate(GOOD, [makeClip('C30', 'TEXT', 3, 2)])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.field).toBe('startSec')
      expect(result.issues[0]?.message).toContain('重なり')
    }
  })

  it('端が接するだけなら重ならない', () => {
    expect(validate(GOOD, [makeClip('C31', 'TEXT', 4, 2)]).ok).toBe(true)
    expect(validate(GOOD, [makeClip('C32', 'TEXT', 0, 1)]).ok).toBe(true)
  })

  it('別の層のクリップとは重ならない', () => {
    expect(validate(GOOD, [makeClip('C33', 'TEXT', 0, 11, 1)]).ok).toBe(true)
  })

  it('映像の終端をはみ出すのは却下でなく注意', () => {
    const result = validate({ ...GOOD, startSec: '10', durationSec: '3' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.notices.join('')).toContain('はみ出す')
  })
})
