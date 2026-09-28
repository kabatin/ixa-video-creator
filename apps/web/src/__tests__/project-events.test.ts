import {
  GenerationJobId,
  ImageGenerationJobId,
  ProjectId,
  ShotId,
  TakeId,
  type GenerationJobStatus,
  type ProjectEvent,
  type ShotStatus,
} from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { JOB_ID, PROJECT_ID, SHOT_ID, TAKE_ID } from '@/__tests__/fixtures'
import {
  applyProjectEvent,
  describeLiveState,
  formatElapsedSince,
  parseProjectEvent,
  projectEventsUrl,
  reconnectDelayMs,
  RECONNECT_MAX_MS,
  type LiveShot,
  type LiveState,
} from '@/lib/project-events'

const projectId = ProjectId.parse(PROJECT_ID)
const shotA = ShotId.parse(SHOT_ID)
const shotB = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FZ0')
const jobId = GenerationJobId.parse(JOB_ID)
const takeId = TakeId.parse(TAKE_ID)

const AT = '2026-09-18T10:00:00.000Z'

const statusEvent = (shotId: ShotId, status: ShotStatus): ProjectEvent => ({
  type: 'shot.status',
  projectId,
  at: AT,
  shotId,
  status,
})

describe('projectEventsUrl', () => {
  it('SSE の経路を組み立てる', () => {
    expect(projectEventsUrl('http://127.0.0.1:3001', projectId)).toBe(
      `http://127.0.0.1:3001/projects/${PROJECT_ID}/events`,
    )
  })

  it('末尾のスラッシュを重ねない', () => {
    expect(projectEventsUrl('http://127.0.0.1:3001/', projectId)).toBe(
      `http://127.0.0.1:3001/projects/${PROJECT_ID}/events`,
    )
  })
})

describe('parseProjectEvent', () => {
  it('正しい出来事を読む', () => {
    const parsed = parseProjectEvent(JSON.stringify(statusEvent(shotA, 'generating')))
    expect(parsed?.type).toBe('shot.status')
  })

  it('JSON でなければ null', () => {
    expect(parseProjectEvent('not json')).toBeNull()
  })

  it('形が違えば null', () => {
    expect(parseProjectEvent(JSON.stringify({ type: 'shot.status' }))).toBeNull()
  })

  it('知らない種別は null', () => {
    expect(
      parseProjectEvent(JSON.stringify({ ...statusEvent(shotA, 'review'), type: 'shot.renamed' })),
    ).toBeNull()
  })
})

describe('reconnectDelayMs', () => {
  /** ゆらぎを打ち消す乱数。0.5 は「ずらさない」。 */
  const noJitter = () => 0.5

  it('1 回目は 1 秒', () => {
    expect(reconnectDelayMs(1, noJitter)).toBe(1_000)
  })

  it('回を重ねるごとに倍になる', () => {
    expect(reconnectDelayMs(2, noJitter)).toBe(2_000)
    expect(reconnectDelayMs(5, noJitter)).toBe(16_000)
  })

  it('上限を超えない', () => {
    expect(reconnectDelayMs(6, noJitter)).toBe(RECONNECT_MAX_MS)
    expect(reconnectDelayMs(50, () => 1)).toBe(RECONNECT_MAX_MS)
  })

  it('ゆらぎは ±20%', () => {
    expect(reconnectDelayMs(1, () => 0)).toBe(800)
    expect(reconnectDelayMs(1, () => 1)).toBe(1_200)
  })

  it('0 以下の回数でも 1 回目として扱う', () => {
    expect(reconnectDelayMs(0, noJitter)).toBe(1_000)
    expect(reconnectDelayMs(-3, noJitter)).toBe(1_000)
  })
})

describe('describeLiveState', () => {
  const ALL: readonly LiveState[] = ['connecting', 'live', 'reconnecting', 'stopped']

  it('4 つの状態が別々の文になる', () => {
    const headlines = ALL.map(
      (state) => describeLiveState(state, { lastEventAt: null, attempt: 0 }).headline,
    )
    expect(new Set(headlines).size).toBe(ALL.length)
  })

  it('繋がっていて何も起きていないのは「最新」', () => {
    const live = describeLiveState('live', { lastEventAt: null, attempt: 0 })
    expect(live.tone).toBe('live')
    expect(live.detail).toContain('最新')
  })

  it('繋がっていないのは「古い可能性」', () => {
    for (const state of ['reconnecting', 'stopped'] as const) {
      const described = describeLiveState(state, { lastEventAt: AT, attempt: 3 })
      expect(described.tone).toBe('stale')
      expect(described.detail).toContain('古い')
    }
  })

  it('繋ぎ直しの回数を出す', () => {
    expect(describeLiveState('reconnecting', { lastEventAt: null, attempt: 3 }).detail).toContain(
      '3 回目',
    )
  })
})

describe('formatElapsedSince', () => {
  it('時:分:秒で出す', () => {
    expect(formatElapsedSince(AT, Date.parse(AT) + 12_000)).toBe('0:00:12')
    expect(formatElapsedSince(AT, Date.parse(AT) + 3_725_000)).toBe('1:02:05')
  })

  it('未来の時刻は 0 に丸める', () => {
    expect(formatElapsedSince(AT, Date.parse(AT) - 5_000)).toBe('0:00:00')
  })

  it('読めない時刻は null', () => {
    expect(formatElapsedSince('いつか', Date.parse(AT))).toBeNull()
  })
})

describe('applyProjectEvent', () => {
  /**
   * **毎回作り直す。** describe の外で 1 つを使い回すと、前のテストが起こした
   * 破壊的変更が次のテストの初期値になり、不変性のテストが素通りする。
   */
  const makeShots = (): readonly LiveShot[] => [
    { id: shotA, status: 'ready' },
    { id: shotB, status: 'draft' },
  ]

  it('該当の Shot の状態を差し替える', () => {
    const result = applyProjectEvent(makeShots(), statusEvent(shotA, 'generating'))
    expect(result.shots.map((shot) => shot.status)).toEqual(['generating', 'draft'])
    expect(result.newTake).toBeNull()
  })

  it('入力を変更しない', () => {
    const shots = makeShots()
    const before = structuredClone(shots)
    applyProjectEvent(shots, statusEvent(shotA, 'generating'))
    expect(shots).toEqual(before)
  })

  it('状態が同じなら元の配列をそのまま返す', () => {
    const shots = makeShots()
    const result = applyProjectEvent(shots, statusEvent(shotA, 'ready'))
    expect(result.shots).toBe(shots)
  })

  /**
   * 絵コンテの画像のジョブ（ADR-0029）は Shot の状態ではない。**Shot の状態として当てない。**
   * 以前の書き方だと、生成ジョブ以外の出来事をすべて Shot の状態として当てていたので、
   * 絵を作っている間の「running」が Shot の状態に書き込まれていた。
   */
  it('絵コンテの画像のジョブの出来事では、Shot の状態を変えない', () => {
    const shots = makeShots()
    const result = applyProjectEvent(shots, {
      type: 'image_job.status',
      projectId,
      at: AT,
      shotId: shotA,
      jobId: ImageGenerationJobId.parse(JOB_ID),
      status: 'running',
      error: null,
    })
    expect(result.shots).toBe(shots)
    expect(result.newTake).toBeNull()
    expect(result.failure).toBeNull()
  })

  it('一覧に無い Shot は無視する', () => {
    const shots = makeShots()
    const unknown = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FZ9')
    const result = applyProjectEvent(shots, statusEvent(unknown, 'review'))
    expect(result.shots).toBe(shots)
    expect(result.newTake).toBeNull()
  })

  const jobEvent = (
    status: GenerationJobStatus,
    take: TakeId | null,
  ): ProjectEvent => ({
    type: 'generation_job.status',
    projectId,
    at: AT,
    shotId: shotA,
    jobId,
    status,
    takeId: take,
    error: null,
  })

  it('ジョブ成功で Shot の状態は触らない', () => {
    const shots = makeShots()
    const result = applyProjectEvent(shots, jobEvent('succeeded', takeId))
    expect(result.shots).toBe(shots)
  })

  it('ジョブ成功は新しい Take として残す', () => {
    const result = applyProjectEvent(makeShots(), jobEvent('succeeded', takeId))
    expect(result.newTake).toEqual({ shotId: shotA, takeId })
  })

  it('実行中・失敗は新しい Take にならない', () => {
    expect(applyProjectEvent(makeShots(), jobEvent('running', null)).newTake).toBeNull()
    expect(applyProjectEvent(makeShots(), jobEvent('failed', null)).newTake).toBeNull()
  })

  /**
   * **失敗を捨てない。** worker は理由まで作って流している。ここで落とすと
   * 画面には何も出ず、Shot は「生成中」のまま固まったように見える。
   */
  describe('失敗の受け取り', () => {
    // `jobEvent` を広げると union の別の枝（shot.status）に `error` を足す形になり
    // 型が通らない。ここは素直に組み立てる。
    const failedEvent = (error: string | null): ProjectEvent => ({
      type: 'generation_job.status',
      projectId,
      at: AT,
      shotId: shotA,
      jobId,
      status: 'failed',
      takeId: null,
      error,
    })

    it('失敗した Shot と理由を返す', () => {
      const result = applyProjectEvent(makeShots(), failedEvent('Provider が 500 を返しました'))

      expect(result.failure).toEqual({
        shotId: shotA,
        jobId,
        message: 'Provider が 500 を返しました',
      })
    })

    it('理由が空でも「失敗した」ことは落とさない', () => {
      const result = applyProjectEvent(makeShots(), failedEvent(null))

      expect(result.failure?.shotId).toBe(shotA)
      expect(result.failure?.message).not.toBe('')
    })

    it('成功・実行中では失敗にしない', () => {
      expect(applyProjectEvent(makeShots(), jobEvent('succeeded', takeId)).failure).toBeNull()
      expect(applyProjectEvent(makeShots(), jobEvent('running', null)).failure).toBeNull()
    })

    it('一覧に無い Shot の失敗は拾わない', () => {
      const unknown = ShotId.parse('01ARZ3NDEKTSV4RRFFQ69G5FZ9')
      const result = applyProjectEvent(makeShots(), {
        type: 'generation_job.status',
        projectId,
        at: AT,
        shotId: unknown,
        jobId,
        status: 'failed',
        takeId: null,
        error: 'だめでした',
      })

      expect(result.failure).toBeNull()
    })

    it('Shot の状態の出来事では失敗にならない', () => {
      expect(applyProjectEvent(makeShots(), statusEvent(shotA, 'blocked')).failure).toBeNull()
    })
  })

  it('一覧に無い Shot のジョブ成功は印にしない', () => {
    const other: readonly LiveShot[] = [{ id: shotB, status: 'draft' }]
    expect(applyProjectEvent(other, jobEvent('succeeded', takeId)).newTake).toBeNull()
  })
})
