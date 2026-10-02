import { OpenAPIHono } from '@hono/zod-openapi'
import {
  ShotId as ShotIdSchema,
  TakeId as TakeIdSchema,
  newId,
  type CreateEditBatchInput,
  type EditBatch,
  type Project,
  type Shot,
  TimelineClip,
  TimelineClipId,
} from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { shotBeforePatch } from '../routes/edit-batch-recording.js'
import { describe, expect, it } from 'vitest'
import { registerErrorHandlers, validationHook } from '../errors.js'
import { createLogger } from '../logger.js'
import {
  ALREADY_UNDONE_MESSAGE,
  NOTHING_TO_UNDO_MESSAGE,
  editBatchRoutes,
  type EditBatchSummaryResponse,
  type UndoEditBatchResponse,
} from '../routes/edit-batches.js'
import { FOREIGN_SHOT_REASON, SHOT_NOT_FOUND_REASON } from '../routes/shots-bulk.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryTimelineClipRepository } from './in-memory-timeline-repositories.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { aProject } from './fixtures.js'
import type { ErrorBody, Ok } from './shot-test-support.js'

/**
 * 一括で変えた操作の履歴と取り消し（P64-1）。
 *
 * ここで守りたいのは 3 つ。
 * 1. **変えた欄だけが戻る。** その後に人が直した無関係な欄は残る
 * 2. **二度取り消さない。** 二度当てると後の編集を古い値で塗り潰す
 * 3. **当てられなかったものは理由つきで返る。** 黙って飛ばさない（L-013 / L-015）
 */

type Scene = {
  readonly app: OpenAPIHono
  readonly project: Project
  readonly shots: ReturnType<typeof createInMemoryShotRepository>
  readonly editBatches: ReturnType<typeof createInMemoryEditBatchRepository>
  readonly clips: ReturnType<typeof createInMemoryTimelineClipRepository>
  /**
   * `selectTake` / `updateStatus` を呼んだ回数。
   * **最終状態ではなく呼び出しそのものを見る**（lessons L-022）。
   * 同じ値を当て直しても最終状態は変わらないので、状態だけでは
   * 「触らなかった」を確かめられない。
   */
  readonly selectTakeCalls: () => number
  readonly updateStatusCalls: () => number
}

const scene = (options: {
  readonly shots?: readonly Shot[]
  readonly otherProjects?: readonly Project[]
  readonly project?: Project
} = {}): Scene => {
  const project = options.project ?? aProject()
  const shots = createInMemoryShotRepository(options.shots ?? [])
  const editBatches = createInMemoryEditBatchRepository()
  const clips = createInMemoryTimelineClipRepository()
  let selectTakeCalls = 0
  let updateStatusCalls = 0
  const app = new OpenAPIHono({ defaultHook: validationHook })
  registerErrorHandlers(app, createLogger('silent'))
  app.route(
    '/',
    editBatchRoutes({
      projects: createInMemoryProjectRepository([project, ...(options.otherProjects ?? [])]),
      shots: {
        findById: (id) => shots.findById(id),
        update: (id, patch) => shots.update(id, patch),
        selectTake: (shotId, takeId) => {
          selectTakeCalls += 1
          return shots.selectTake(shotId, takeId)
        },
        updateStatus: (shotId, status) => {
          updateStatusCalls += 1
          return shots.updateStatus(shotId, status)
        },
      },
      editBatches,
      timelineClips: clips,
    }),
  )
  return {
    app,
    project,
    shots,
    editBatches,
    clips,
    selectTakeCalls: () => selectTakeCalls,
    updateStatusCalls: () => updateStatusCalls,
  }
}

const seed = async (s: Scene, input: Omit<CreateEditBatchInput, 'projectId'> & {
  readonly projectId?: Project['id']
}): Promise<EditBatch> =>
  await s.editBatches.create({ projectId: s.project.id, ...input })

const list = async (s: Scene): Promise<EditBatchSummaryResponse[]> => {
  const res = await s.app.request(`/projects/${s.project.id}/edit-batches`)
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: EditBatchSummaryResponse[] }).data
}

const undo = async (s: Scene, id: string) =>
  await s.app.request(`/projects/${s.project.id}/edit-batches/${id}/undo`, { method: 'POST' })

const undoOk = async (s: Scene, id: string): Promise<UndoEditBatchResponse> => {
  const res = await undo(s, id)
  expect(res.status).toBe(200)
  return ((await res.json()) as Ok<UndoEditBatchResponse>).data
}

describe('GET /projects/{projectId}/edit-batches', () => {
  it('直近が先頭に並び、取り消し済みも消えずに残る', async () => {
    const s = scene()
    const older = await seed(s, {
      kind: 'draft_adopt',
      summary: '絵コンテの案を 2 件採用しました',
      entries: [{ shotId: newId(ShotIdSchema), patch: { description: '前の説明' } }],
    })
    const newer = await seed(s, {
      kind: 'bulk_update',
      summary: 'Shot を 3 件まとめて変更しました',
      entries: [{ shotId: newId(ShotIdSchema), patch: { mood: 'calm' } }],
    })
    await s.editBatches.markUndone(older.id, new Date())

    const rows = await list(s)
    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id])
    expect(rows[0]?.canUndo).toBe(true)
    expect(rows[1]?.canUndo).toBe(false)
    expect(rows[1]?.undoneAt).not.toBeNull()
  })

  it('他 Project の記録は混ざらない', async () => {
    const other = aProject()
    const s = scene({ otherProjects: [other] })
    await s.editBatches.create({
      projectId: other.id,
      kind: 'bulk_update',
      summary: '別の作品の一括変更',
      entries: [{ shotId: newId(ShotIdSchema), patch: { mood: 'calm' } }],
    })
    expect(await list(s)).toEqual([])
  })

  it('Project が無ければ 404', async () => {
    const s = scene()
    const res = await s.app.request(`/projects/${aProject().id}/edit-batches`)
    expect(res.status).toBe(404)
  })
})

describe('POST /projects/{projectId}/edit-batches/{id}/undo', () => {
  it('変えた欄だけを戻し、その後に人が直した欄は残す', async () => {
    const project = aProject()
    const live = aShot(project.id, { startSec: 8, description: '元の説明', mood: 'calm' })
    const s = scene({ project, shots: [live] })

    const batch = await seed(s, {
      kind: 'rough_cut',
      summary: '粗編集を 1 件の Shot へ適用しました',
      entries: [{ shotId: live.id, patch: { startSec: 8 } }],
    })
    // 粗編集のあとに人が説明を直した。これは戻ってはいけない。
    await s.shots.update(live.id, { startSec: 12.5, description: '人が後から直した説明' })

    const result = await undoOk(s, batch.id)
    expect(result.restored).toEqual([live.id])
    expect(result.failed).toEqual([])

    const after = await s.shots.findById(live.id)
    expect(after?.startSec).toBe(8)
    expect(after?.description).toBe('人が後から直した説明')
    expect(after?.mood).toBe('calm')
  })

  it('採用 Take を戻す（欄がある記録だけ）', async () => {
    const takeId = newId(TakeIdSchema)
    const project = aProject()
    const live = aShot(project.id, { selectedTakeId: newId(TakeIdSchema) })
    const s = scene({ project, shots: [live] })

    const batch = await seed(s, {
      kind: 'rough_cut',
      summary: '粗編集を 1 件の Shot へ適用しました',
      entries: [{ shotId: live.id, patch: {}, selectedTakeId: takeId }],
    })

    await undoOk(s, batch.id)
    expect((await s.shots.findById(live.id))?.selectedTakeId).toBe(takeId)
    expect(s.selectTakeCalls()).toBe(1)
  })

  it('採用 Take の欄が無い記録は、採用を触らない', async () => {
    const takeId = newId(TakeIdSchema)
    const project = aProject()
    const live = aShot(project.id, { selectedTakeId: takeId, startSec: 3 })
    const s = scene({ project, shots: [live] })
    const batch = await seed(s, {
      kind: 'rough_cut',
      summary: '粗編集を 1 件の Shot へ適用しました',
      entries: [{ shotId: live.id, patch: { startSec: 1 } }],
    })

    await undoOk(s, batch.id)
    const after = await s.shots.findById(live.id)
    expect(after?.startSec).toBe(1)
    expect(after?.selectedTakeId).toBe(takeId)
    // **採用の口を呼んでいないこと**まで見る。当て直しでは状態が変わらない（L-022）。
    expect(s.selectTakeCalls()).toBe(0)
  })

  it('状態の欄がある記録は、採用と状態の両方を戻す', async () => {
    const takeId = newId(TakeIdSchema)
    const project = aProject()
    // 一括採用のあとの姿。採用済みで status は review。
    const live = aShot(project.id, { selectedTakeId: takeId, status: 'review' })
    const s = scene({ project, shots: [live] })
    const batch = await seed(s, {
      kind: 'bulk_update',
      summary: '採用 Take を 1 件まとめて決めました',
      // 採用前は「未採用・ready」だった。
      entries: [{ shotId: live.id, patch: {}, selectedTakeId: null, status: 'ready' }],
    })

    const result = await undoOk(s, batch.id)

    expect(result.restored).toEqual([live.id])
    const after = await s.shots.findById(live.id)
    expect(after?.selectedTakeId).toBeNull()
    // **採用だけ戻して状態が新しいまま、にしない。**
    expect(after?.status).toBe('ready')
    expect(s.updateStatusCalls()).toBe(1)
  })

  it('状態の欄が無い記録は、状態を触らない', async () => {
    const project = aProject()
    const live = aShot(project.id, { startSec: 3, status: 'approved' })
    const s = scene({ project, shots: [live] })
    const batch = await seed(s, {
      kind: 'rough_cut',
      summary: '粗編集を 1 件の Shot へ適用しました',
      entries: [{ shotId: live.id, patch: { startSec: 1 } }],
    })

    await undoOk(s, batch.id)

    expect((await s.shots.findById(live.id))?.status).toBe('approved')
    // **状態の口を呼んでいないこと**まで見る。同じ値の当て直しは状態に現れない。
    expect(s.updateStatusCalls()).toBe(0)
  })

  it('二度目の取り消しは 409 と理由を返す', async () => {
    const project = aProject()
    const live = aShot(project.id, { startSec: 5 })
    const s = scene({ project, shots: [live] })
    const batch = await seed(s, {
      kind: 'bulk_update',
      summary: 'Shot を 1 件まとめて変更しました',
      entries: [{ shotId: live.id, patch: { mood: 'calm' } }],
    })

    await undoOk(s, batch.id)
    const second = await undo(s, batch.id)
    expect(second.status).toBe(409)
    expect(((await second.json()) as ErrorBody).error).toBe(ALREADY_UNDONE_MESSAGE)
  })

  it('消えた Shot は理由つきで返り、残りは戻る', async () => {
    const project = aProject()
    const kept = aShot(project.id, { code: 'shot_001', mood: 'calm' })
    const removed = aShot(project.id, { code: 'shot_002', mood: 'calm' })
    const s = scene({ project, shots: [kept, removed] })
    const batch = await seed(s, {
      kind: 'bulk_update',
      summary: 'Shot を 2 件まとめて変更しました',
      entries: [
        { shotId: removed.id, patch: { mood: 'tense' } },
        { shotId: kept.id, patch: { mood: 'tense' } },
      ],
    })
    await s.shots.softDelete(removed.id)

    const result = await undoOk(s, batch.id)
    expect(result.restored).toEqual([kept.id])
    expect(result.failed).toEqual([{ shotId: removed.id, reason: SHOT_NOT_FOUND_REASON }])
    expect((await s.shots.findById(kept.id))?.mood).toBe('tense')
  })

  it('他 Project の Shot は当てずに理由を返す', async () => {
    const other = aProject()
    const foreign = aShot(other.id)
    const s = scene({ shots: [foreign], otherProjects: [other] })
    const batch = await seed(s, {
      kind: 'bulk_update',
      summary: 'Shot を 1 件まとめて変更しました',
      entries: [{ shotId: foreign.id, patch: { mood: 'tense' } }],
    })

    const result = await undoOk(s, batch.id)
    expect(result.failed).toEqual([{ shotId: foreign.id, reason: FOREIGN_SHOT_REASON }])
    expect((await s.shots.findById(foreign.id))?.mood).toBe(foreign.mood)
  })

  it('`null` の記録は採用を外す方向へ戻す（「触っていない」と区別する）', async () => {
    const project = aProject()
    const live = aShot(project.id, { selectedTakeId: newId(TakeIdSchema) })
    const s = scene({ project, shots: [live] })
    const batch = await seed(s, {
      kind: 'rough_cut',
      summary: '粗編集を 1 件の Shot へ適用しました',
      // **`null` は「採用していなかった」**（欄が無いのは「触っていない」・L-021）。
      entries: [{ shotId: live.id, patch: {}, selectedTakeId: null }],
    })

    const result = await undoOk(s, batch.id)
    expect(result.restored).toEqual([live.id])
    expect((await s.shots.findById(live.id))?.selectedTakeId).toBeNull()
    expect(s.selectTakeCalls()).toBe(1)
  })

  it('entries が空の記録は取り消す内容が無いと返す', async () => {
    const s = scene()
    const batch = await seed(s, { kind: 'bulk_update', summary: '何も変わらなかった', entries: [] })
    const res = await undo(s, batch.id)
    expect(res.status).toBe(409)
    expect(((await res.json()) as ErrorBody).error).toBe(NOTHING_TO_UNDO_MESSAGE)
  })

  it('他 Project の記録は 404', async () => {
    const other = aProject()
    const s = scene({ otherProjects: [other] })
    const batch = await s.editBatches.create({
      projectId: other.id,
      kind: 'bulk_update',
      summary: '別の作品の一括変更',
      entries: [{ shotId: newId(ShotIdSchema), patch: { mood: 'calm' } }],
    })
    expect((await undo(s, batch.id)).status).toBe(404)
  })

  it('粗編集の取り消しはロック済み Shot を動かさない', async () => {
    const project = aProject()
    const locked = aShot(project.id, { startSec: 4, lockedAt: new Date('2026-02-01T00:00:00Z') })
    const s = scene({ project, shots: [locked] })
    const batch = await seed(s, {
      kind: 'rough_cut',
      summary: '粗編集を 1 件の Shot へ適用しました',
      entries: [{ shotId: locked.id, patch: { startSec: 1 } }],
    })

    const result = await undoOk(s, batch.id)
    expect(result.restored).toEqual([])
    expect(result.failed[0]?.shotId).toBe(locked.id)
    expect(result.failed[0]?.reason).toContain(locked.code)
    expect((await s.shots.findById(locked.id))?.startSec).toBe(4)
  })

  it('一括変更の取り消しはロックを見ない（行きで見ていないため）', async () => {
    const project = aProject()
    const locked = aShot(project.id, {
      mood: 'tense',
      lockedAt: new Date('2026-02-01T00:00:00Z'),
    })
    const s = scene({ project, shots: [locked] })
    const batch = await seed(s, {
      kind: 'bulk_update',
      summary: 'Shot を 1 件まとめて変更しました',
      entries: [{ shotId: locked.id, patch: { mood: 'calm' } }],
    })

    const result = await undoOk(s, batch.id)
    expect(result.restored).toEqual([locked.id])
    expect((await s.shots.findById(locked.id))?.mood).toBe('calm')
  })
})

/**
 * 記録に書ける欄（P64-1）。
 *
 * **`lockedAt` は書けない。** `Date` は jsonb から読み戻せず、読み出しの
 * `parse` で落ちる。ロックは人が「ここは触らない」と決める行為でもあり、
 * 一括を取り消したときに機械が覆してよいものではない。
 */
describe('shotBeforePatch', () => {
  it('変わる欄だけを、変える前の値で返す', () => {
    const shot = aShot(aProject().id, { mood: '元の雰囲気', description: '元の説明' })

    const before = shotBeforePatch(shot, { mood: '新しい雰囲気', description: '元の説明' })

    expect(before).toEqual({ mood: '元の雰囲気' })
  })

  it('**`lockedAt` は記録に入れない**（型でも検証でも落とす）', () => {
    const locked = new Date('2026-02-01T00:00:00Z')
    const shot = aShot(aProject().id, { mood: '元の雰囲気', lockedAt: null })

    // 呼ぶ側が誤って渡しても、記録には入らない。
    const before = shotBeforePatch(shot, { mood: '新しい雰囲気', lockedAt: locked })

    expect(before).toEqual({ mood: '元の雰囲気' })
    expect('lockedAt' in before).toBe(false)
  })
})

/**
 * テロップの見た目のまとめ変更の取り消し（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。
 * 変える前の見た目と styleId を書き戻す。文字は触らない。消えたテロップは理由つきで返し、残りは戻す。
 */
describe('テロップの記録の取り消し', () => {
  const textClip = (projectId: Project['id'], params: Record<string, unknown>): TimelineClip =>
    TimelineClip.parse({
      id: newId(TimelineClipId),
      projectId,
      track: 'TEXT',
      startSec: 0,
      durationSec: 2,
      layer: 1,
      content: { type: 'text', templateKey: 'plain', params },
      opacity: 1,
      createdAt: new Date(),
    })

  it('見た目と styleId を変える前へ戻し、文字は残す。前に見た目が無かったなら外す', async () => {
    const s = scene()
    // 置き場は作るときに ID を振り直すので、作った後の値を使う。
    const styled = await s.clips.create(
      textClip(s.project.id, { text: '一行目', style: { color: '#FF0000', size: 0.08 }, styleId: 'style-a', lyricLine: 0 }),
    )
    const bare = await s.clips.create(textClip(s.project.id, { text: '二行目', style: { size: 0.08 }, styleId: null }))
    const batch = await seed(s, {
      kind: 'text_style',
      summary: 'テロップ 2 件の大きさを変えました',
      entries: [],
      clipEntries: [
        { clipId: styled.id, style: { color: '#FF0000' }, styleId: 'style-a' },
        { clipId: bare.id, style: null, styleId: null },
      ],
    })

    const result = await undoOk(s, batch.id)

    expect(result.restoredClips).toEqual([styled.id, bare.id])
    expect(result.failedClips).toEqual([])
    const [first, second] = s.clips.snapshot()
    expect(first?.content).toEqual({
      type: 'text',
      templateKey: 'plain',
      params: { text: '一行目', style: { color: '#FF0000' }, styleId: 'style-a', lyricLine: 0 },
    })
    expect(second?.content).toEqual({ type: 'text', templateKey: 'plain', params: { text: '二行目', styleId: null } })
  })

  it('消えたテロップは理由つきで返し、残りは戻す。履歴にはテロップの件数を出す', async () => {
    const s = scene()
    const live = await s.clips.create(textClip(s.project.id, { text: '一行目', style: { size: 0.08 } }))
    const gone = newId(TimelineClipId)
    const batch = await seed(s, {
      kind: 'text_style',
      summary: 'テロップ 2 件の大きさを変えました',
      entries: [],
      clipEntries: [
        { clipId: live.id, style: {}, styleId: null },
        { clipId: gone, style: {}, styleId: null },
      ],
    })

    expect((await list(s))[0]).toMatchObject({ clipCount: 2, shotCount: 0, canUndo: true })
    const result = await undoOk(s, batch.id)

    expect(result.restoredClips).toEqual([live.id])
    expect(result.failedClips.map((failure) => failure.clipId)).toEqual([gone])
    expect(result.failedClips[0]?.reason).toMatch(/見つかりません/)
  })
})
