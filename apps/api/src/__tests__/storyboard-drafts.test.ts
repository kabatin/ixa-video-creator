import {
  MusicAnalysis as MusicAnalysisSchema,
  MusicAnalysisId as MusicAnalysisIdSchema,
  MediaAssetId as MediaAssetIdSchema,
  ProjectId as ProjectIdSchema,
  ShotId as ShotIdSchema,
  StoryboardDraftRunId as StoryboardDraftRunIdSchema,
  newId,
  type MusicAnalysis,
  type MusicSection,
  type MusicTrack,
  type Project,
  type Shot,
} from '@ixa/domain'
import { aShot, createInMemoryShotRepository } from '@ixa/generation/testing'
import { describe, expect, it } from 'vitest'
import type { StoryboardDraftOutcome, StoryboardDrafter } from '@ixa/provider-llm'
import {
  DUPLICATE_SHOT_IDS_MESSAGE,
  FOREIGN_RUN_MESSAGE,
  NO_SHOTS_MESSAGE,
  RUN_NOT_DONE_MESSAGE,
  storyboardDraftRoutes,
  type StoryboardDraftItemResponse,
  type StoryboardDraftRunResponse,
} from '../routes/storyboard-drafts.js'
import { aProject } from './fixtures.js'
import type { EditBatchRecorder } from '../routes/edit-batch-recording.js'
import { createInMemoryEditBatchRepository } from './in-memory-edit-batch-repository.js'
import { createInMemoryMusicAnalysisRepository } from './in-memory-music-analysis-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createInMemoryScriptRepository } from './in-memory-script-repositories.js'
import { createInMemoryStoryboardDraftRepository } from './in-memory-storyboard-draft-repository.js'
import { createInMemoryMusicTrackRepository } from './in-memory-timeline-repositories.js'

/**
 * 絵コンテの一括下書きと、その採用（PHASE 6.3 / P63-4）。
 *
 * この機能でいちばん起きてはいけないのは、**押していない Shot が変わること**。
 * 本制作の Shot の一部は既に Take を採用済みで、説明が黙って書き換わると
 * 生成済みの Take と食い違ったまま誰も気付かない。
 * だから「列挙した Shot だけが変わる」を最優先で固定する。
 */

/**
 * 成功と失敗を 1 つの型で受ける。交差型にすると `success` が衝突して `never` に潰れ、
 * 以降の参照がすべて型無しになる。テストは status を見てからどちらかだけを読む。
 */
type ApiBody<T> = {
  success: boolean
  data: T
  error?: string
  fields?: Record<string, string[]>
}

type DraftResult = { run: StoryboardDraftRunResponse; items: StoryboardDraftItemResponse[] }
type LatestResult = {
  run: StoryboardDraftRunResponse | null
  items: StoryboardDraftItemResponse[]
}
type AdoptResult = {
  adopted: StoryboardDraftItemResponse[]
  shots: { id: string; description: string; mood: string | null }[]
}

const SECTIONS: readonly MusicSection[] = Object.freeze([
  { start: 0, end: 8, label: 'intro', energy: 0.3 },
  { start: 8, end: 24, label: 'chorus', energy: 0.9 },
])

/** 案は「Shot の code から機械的に作る」だけ。中身の出来はここでは見ない。 */
const drafterFor = (
  shots: readonly Shot[],
  overrides: { name?: string; outcome?: StoryboardDraftOutcome; throws?: Error } = {},
): StoryboardDrafter & { seen: () => readonly unknown[] } => {
  const seen: unknown[] = []
  return {
    seen: () => seen,
    name: overrides.name ?? 'test-drafter',
    draft: (request) => {
      seen.push(request)
      if (overrides.throws !== undefined) return Promise.reject(overrides.throws)
      if (overrides.outcome !== undefined) return Promise.resolve(overrides.outcome)
      return Promise.resolve({
        ok: true,
        costUsd: 0.25,
        items: shots.map((shot) => ({
          shotId: shot.id,
          description: `案: ${shot.code}`,
          mood: '静かな緊張',
          reason: `${shot.code} は導入だから`,
        })),
      })
    },
  }
}

const anAnalysis = (musicTrackId: MusicTrack['id']): MusicAnalysis =>
  MusicAnalysisSchema.parse({
    id: newId(MusicAnalysisIdSchema),
    musicTrackId,
    analyzerVersion: 'librosa-v1',
    durationSec: 24,
    bpm: 120,
    bpmConfidence: 0.9,
    beats: [0, 0.5, 1],
    downbeats: [0],
    sections: [...SECTIONS],
    energyCurve: { hopSec: 0.1, values: [0.1, 0.2] },
    onsets: [],
    drops: [],
    waveformPeaksKey: 'peaks/test.json',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  })

const buildRoutes = async (options: {
  project?: Project | null
  /** 経路の Project 以外にも実在させたい Project。他 Project の run を試すのに要る。 */
  otherProjects?: readonly Project[]
  shots?: readonly Shot[]
  script?: string | null
  withAnalysis?: boolean
  drafter?: StoryboardDrafter
  /** 記録の口を差し替える（作れないときの振る舞いを見るため）。 */
  editBatches?: EditBatchRecorder
}) => {
  const project = options.project === undefined ? aProject() : options.project
  const shots = options.shots ?? []

  const projects = createInMemoryProjectRepository([
    ...(project === null ? [] : [project]),
    ...(options.otherProjects ?? []),
  ])
  const shotRepo = createInMemoryShotRepository(shots)
  const scripts = createInMemoryScriptRepository()
  const musicTracks = createInMemoryMusicTrackRepository()
  const musicAnalyses = createInMemoryMusicAnalysisRepository()
  const drafts = createInMemoryStoryboardDraftRepository()

  if (project !== null && options.script !== undefined && options.script !== null) {
    const script = await scripts.ensureForProject(project.id)
    await scripts.appendVersion({
      scriptId: script.id,
      content: options.script,
      authoredBy: 'human',
    })
  }

  if (project !== null && options.withAnalysis === true) {
    const track = await musicTracks.create({
      projectId: project.id,
      mediaAssetId: newId(MediaAssetIdSchema),
      title: 'iXA CUP',
      isMaster: true,
      offsetSec: 0,
    })
    await musicAnalyses.create(anAnalysis(track.id))
  }

  const drafter = options.drafter ?? drafterFor(shots)
  const editBatches = createInMemoryEditBatchRepository()

  return {
    project,
    shotRepo,
    drafts,
    drafter,
    editBatches,
    app: storyboardDraftRoutes({
      projects,
      shots: shotRepo,
      scripts,
      musicTracks,
      musicAnalyses,
      drafts,
      drafter,
      editBatches: options.editBatches ?? editBatches,
    }),
  }
}

type App = Awaited<ReturnType<typeof buildRoutes>>['app']

const postDraft = async (app: App, projectId: string) => {
  const res = await app.request(`/projects/${projectId}/storyboard/drafts`, { method: 'POST' })
  return { status: res.status, body: (await res.json()) as ApiBody<DraftResult> }
}

const getLatest = async (app: App, projectId: string) => {
  const res = await app.request(`/projects/${projectId}/storyboard/drafts`)
  return { status: res.status, body: (await res.json()) as ApiBody<LatestResult> }
}

const postAdopt = async (
  app: App,
  projectId: string,
  runId: string,
  shotIds: readonly string[],
) => {
  const res = await app.request(
    `/projects/${projectId}/storyboard/drafts/${runId}/adopt`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shotIds }),
    },
  )
  return { status: res.status, body: (await res.json()) as ApiBody<AdoptResult> }
}

describe('POST /projects/{id}/storyboard/drafts', () => {
  it('存在しない Project は 404 を返す', async () => {
    const { app } = await buildRoutes({ project: null })
    const { status } = await postDraft(app, newId(ShotIdSchema))
    expect(status).toBe(404)
  })

  it('Shot が 1 件も無ければ 422（下書きする対象が無い）', async () => {
    const { app, project } = await buildRoutes({ shots: [] })
    const { status, body } = await postDraft(app, (project as Project).id)

    expect(status).toBe(422)
    expect(body.fields?.shots).toEqual([NO_SHOTS_MESSAGE])
  })

  it('案を保存し、run を done にして返す', async () => {
    const project = aProject()
    const shots = [aShot(project.id, { code: 'A' }), aShot(project.id, { code: 'B' })]
    const { app, drafts } = await buildRoutes({ project, shots })

    const { status, body } = await postDraft(app, project.id)

    expect(status).toBe(201)
    expect(body.data.run.status).toBe('done')
    expect(body.data.run.costUsd).toBe(0.25)
    expect(body.data.items).toHaveLength(2)
    expect(drafts.itemSnapshot()).toHaveLength(2)
  })

  /** **下書きは Shot を書き換えない。** ここが通らなければ機能そのものが間違っている。 */
  it('Shot をひとつも書き換えない', async () => {
    const project = aProject()
    const shots = [aShot(project.id, { code: 'A', description: '元の説明' })]
    const { app, shotRepo } = await buildRoutes({ project, shots })

    await postDraft(app, project.id)

    const after = await shotRepo.findByProject(project.id)
    expect(after[0]?.description).toBe('元の説明')
  })

  it('できた案は既定で 1 件も採用されていない（adoptedAt は null）', async () => {
    const project = aProject()
    const shots = [aShot(project.id, { code: 'A' }), aShot(project.id, { code: 'B' })]
    const { app } = await buildRoutes({ project, shots })

    const { body } = await postDraft(app, project.id)
    expect(body.data.items.every((item) => item.adoptedAt === null)).toBe(true)
  })

  it('使った口の名前を run に残す（質の違いを後から切り分けるため）', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const { app } = await buildRoutes({
      project,
      shots,
      drafter: drafterFor(shots, { name: 'claude-cli-storyboard-drafter' }),
    })

    const { body } = await postDraft(app, project.id)
    expect(body.data.run.drafter).toBe('claude-cli-storyboard-drafter')
  })

  it('脚本と曲の構成を下書きに渡す', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const drafter = drafterFor(shots)
    const { app } = await buildRoutes({
      project,
      shots,
      script: '# 台本\n決勝の朝。',
      withAnalysis: true,
      drafter,
    })

    await postDraft(app, project.id)
    const [request] = drafter.seen() as { script: string | null; sections: MusicSection[] }[]

    expect(request?.script).toContain('決勝の朝')
    expect(request?.sections.map((section) => section.label)).toEqual(['intro', 'chorus'])
  })

  /** 作品の方針（ADR-0030）。ルックと避けたいものも案の材料にする。 */
  it('作品のルックと避けたいものを下書きに渡す', async () => {
    const project = { ...aProject(), styleGuide: '35mm フィルム、夜の雨', avoid: '文字' }
    const shots = [aShot(project.id)]
    const drafter = drafterFor(shots)
    const { app } = await buildRoutes({ project, shots, drafter })

    await postDraft(app, project.id)
    const [request] = drafter.seen() as { look: string; avoid: string }[]

    expect(request).toMatchObject({ look: '35mm フィルム、夜の雨', avoid: '文字' })
  })

  it('脚本も解析も無くても下書きできる（null と空で渡す）', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const drafter = drafterFor(shots)
    const { app } = await buildRoutes({ project, shots, drafter })

    const { status } = await postDraft(app, project.id)
    const [request] = drafter.seen() as { script: string | null; sections: MusicSection[] }[]

    expect(status).toBe(201)
    expect(request?.script).toBeNull()
    expect(request?.sections).toEqual([])
  })

  /** **失敗を保存する。** 保存しないと「押したのに何も起きなかった」と区別が付かない。 */
  it('下書きが失敗したら run を failed にし、理由を残す', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const { app, drafts } = await buildRoutes({
      project,
      shots,
      drafter: drafterFor(shots, {
        outcome: {
          ok: false,
          // **CLI が走った後の失敗。** 額は 0 ではない。
          costUsd: 0.1,
          error: { code: 'missing_shot_id', message: '2 件のうち 1 件の案が返りませんでした' },
        },
      }),
    })

    const { status, body } = await postDraft(app, project.id)

    expect(status).toBe(201)
    expect(body.data.run.status).toBe('failed')
    expect(body.data.run.error?.code).toBe('missing_shot_id')
    expect(body.data.items).toEqual([])
    // 失敗した run の案は 1 件も保存しない（半端な案を残さない）。
    expect(drafts.itemSnapshot()).toEqual([])
  })

  it('下書きが例外を投げても run を failed にして残す（握り潰さない）', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const { app } = await buildRoutes({
      project,
      shots,
      drafter: drafterFor(shots, { throws: new Error('CLI が落ちた') }),
    })

    const { status, body } = await postDraft(app, project.id)

    expect(status).toBe(201)
    expect(body.data.run.status).toBe('failed')
    expect(body.data.run.error?.message).toContain('CLI が落ちた')
  })

  it('run を running のまま残さない（画面が実行中と出し続ける状態を作らない）', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const { app, drafts } = await buildRoutes({
      project,
      shots,
      drafter: drafterFor(shots, { throws: new Error('落ちた') }),
    })

    await postDraft(app, project.id)
    expect(drafts.runSnapshot().map((run) => run.status)).toEqual(['failed'])
  })
})

describe('POST /projects/{id}/storyboard/drafts/{runId}/adopt', () => {
  /** 案を作ってから採用するまでを 1 本にまとめる。 */
  const withDraft = async (
    shotOverrides: readonly Partial<Shot>[],
    otherProjects: readonly Project[] = [],
  ) => {
    const project = aProject()
    const shots = shotOverrides.map((overrides) => aShot(project.id, overrides))
    const built = await buildRoutes({ project, shots, otherProjects })
    const { body } = await postDraft(built.app, project.id)
    return { ...built, project, shots, run: body.data.run, items: body.data.items }
  }

  /** **この機能の中核。** 押していない Shot は変わってはいけない。 */
  it('列挙した Shot だけを書き換え、他の Shot は変えない', async () => {
    const { app, project, shots, run, shotRepo } = await withDraft([
      { code: 'A', description: 'Aの元の説明', mood: 'calm' },
      { code: 'B', description: 'Bの元の説明', mood: 'calm' },
    ])
    const [first, second] = shots as [Shot, Shot]

    const { status } = await postAdopt(app, project.id, run.id, [first.id])

    expect(status).toBe(200)
    const after = await shotRepo.findByProject(project.id)
    const byId = new Map(after.map((shot) => [shot.id, shot] as const))

    expect(byId.get(first.id)?.description).toBe('案: A')
    expect(byId.get(second.id)?.description).toBe('Bの元の説明')
    expect(byId.get(second.id)?.mood).toBe('calm')
  })

  it('採用していない案の adoptedAt は null のまま（「不採用」ではなく「未決」）', async () => {
    const { app, project, shots, run, drafts } = await withDraft([{ code: 'A' }, { code: 'B' }])
    const [first, second] = shots as [Shot, Shot]

    await postAdopt(app, project.id, run.id, [first.id])

    const snapshot = drafts.itemSnapshot()
    expect(snapshot.find((item) => item.shotId === first.id)?.adoptedAt).not.toBeNull()
    expect(snapshot.find((item) => item.shotId === second.id)?.adoptedAt).toBeNull()
  })

  it('雰囲気も一緒に書き換える', async () => {
    const { app, project, shots, run, shotRepo } = await withDraft([{ code: 'A', mood: '元の雰囲気' }])
    const [first] = shots as [Shot]

    await postAdopt(app, project.id, run.id, [first.id])
    const after = await shotRepo.findByProject(project.id)

    expect(after[0]?.mood).toBe('静かな緊張')
  })

  it('全件を明示的に列挙すれば一括で採用できる', async () => {
    const { app, project, shots, run, shotRepo } = await withDraft([{ code: 'A' }, { code: 'B' }])

    const { status, body } = await postAdopt(
      app,
      project.id,
      run.id,
      shots.map((shot) => shot.id),
    )

    expect(status).toBe(200)
    expect(body.data.adopted).toHaveLength(2)
    const after = await shotRepo.findByProject(project.id)
    expect(after.map((shot) => shot.description)).toEqual(['案: A', '案: B'])
  })

  it('更新後の Shot を返す（画面が「いまの説明」を描き直せるように）', async () => {
    const { app, project, shots, run } = await withDraft([{ code: 'A' }, { code: 'B' }])
    const [first] = shots as [Shot]

    const { body } = await postAdopt(app, project.id, run.id, [first.id])

    expect(body.data.shots).toHaveLength(1)
    expect(body.data.shots[0]?.description).toBe('案: A')
  })

  it('二度同じ Shot を採用しても最初の時刻を残す（冪等）', async () => {
    const { app, project, shots, run, drafts } = await withDraft([{ code: 'A' }])
    const [first] = shots as [Shot]

    await postAdopt(app, project.id, run.id, [first.id])
    const firstAdoptedAt = drafts.itemSnapshot()[0]?.adoptedAt
    const { status } = await postAdopt(app, project.id, run.id, [first.id])

    expect(status).toBe(200)
    expect(drafts.itemSnapshot()[0]?.adoptedAt).toEqual(firstAdoptedAt)
  })

  it('案の中身は採用しても変わらない（追記のみ）', async () => {
    const { app, project, shots, run, drafts, items } = await withDraft([{ code: 'A' }])
    const [first] = shots as [Shot]

    await postAdopt(app, project.id, run.id, [first.id])
    const stored = drafts.itemSnapshot()[0]

    expect(stored?.description).toBe(items[0]?.description)
    expect(stored?.reason).toBe(items[0]?.reason)
  })

  it('案の無い Shot が 1 件でもあれば何も採用しない', async () => {
    const { app, project, shots, run, shotRepo } = await withDraft([
      { code: 'A', description: 'Aの元の説明' },
    ])
    const [first] = shots as [Shot]
    const stranger = newId(ShotIdSchema)

    const { status, body } = await postAdopt(app, project.id, run.id, [first.id, stranger])

    expect(status).toBe(422)
    expect(body.fields?.shotIds?.[0]).toContain(stranger)
    const after = await shotRepo.findByProject(project.id)
    expect(after[0]?.description).toBe('Aの元の説明')
  })

  it('同じ Shot を 2 回指定したら 422', async () => {
    const { app, project, shots, run } = await withDraft([{ code: 'A' }])
    const [first] = shots as [Shot]

    const { status, body } = await postAdopt(app, project.id, run.id, [first.id, first.id])

    expect(status).toBe(422)
    expect(JSON.stringify(body.fields)).toContain(DUPLICATE_SHOT_IDS_MESSAGE)
  })

  it('空の列挙は 422（既定で全件採用に化けさせない）', async () => {
    const { app, project, run } = await withDraft([{ code: 'A' }])
    const { status } = await postAdopt(app, project.id, run.id, [])
    expect(status).toBe(422)
  })

  it('存在しない run は 404', async () => {
    const { app, project } = await withDraft([{ code: 'A' }])
    const { status } = await postAdopt(
      app,
      project.id,
      newId(StoryboardDraftRunIdSchema),
      [newId(ShotIdSchema)],
    )
    expect(status).toBe(404)
  })

  /**
   * **実在する別の Project から、この run を指す。**
   * 相手の Project を登録しないと `projects.findById` の 404 で先に落ち、
   * `run.projectId !== projectId` の枝を一度も通らない。
   */
  it('他 Project から参照した run は 404（別の作品の案を紛れ込ませない）', async () => {
    const other = aProject({ name: '別の Project' })
    const { app, run } = await withDraft([{ code: 'A' }], [other])

    const { status, body } = await postAdopt(app, other.id, run.id, [newId(ShotIdSchema)])

    expect(status).toBe(404)
    expect(body.error).toBe(FOREIGN_RUN_MESSAGE)
  })

  it('まだ完了していない run は採用できない', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const { app, drafts } = await buildRoutes({ project, shots })
    const run = await drafts.createRun({ projectId: project.id, drafter: 'test', status: 'running' })

    const { status, body } = await postAdopt(app, project.id, run.id, [
      (shots[0] as Shot).id,
    ])

    expect(status).toBe(422)
    expect(body.fields?.runId).toEqual([RUN_NOT_DONE_MESSAGE])
  })

  it('ULID でない runId は 422', async () => {
    const { app, project } = await withDraft([{ code: 'A' }])
    const res = await app.request(
      `/projects/${project.id}/storyboard/drafts/not-a-ulid/adopt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shotIds: [newId(ShotIdSchema)] }),
      },
    )
    expect(res.status).toBe(422)
  })

  it('既に削除された Shot は 422 で弾き、何も採用しない', async () => {
    const { app, project, shots, run, shotRepo, drafts } = await withDraft([
      { code: 'A' },
      { code: 'B' },
    ])
    const [first, second] = shots as [Shot, Shot]
    await shotRepo.softDelete(second.id)

    const { status } = await postAdopt(app, project.id, run.id, [first.id, second.id])

    expect(status).toBe(422)
    expect(drafts.itemSnapshot().every((item) => item.adoptedAt === null)).toBe(true)
  })
})

describe('GET /projects/{id}/storyboard/drafts', () => {
  it('存在しない Project は 404 を返す', async () => {
    const { app } = await buildRoutes({ project: null })
    const { status } = await getLatest(app, newId(ProjectIdSchema))
    expect(status).toBe(404)
  })

  it('ULID でない ID は 422 を返す', async () => {
    const { app, project } = await buildRoutes({ shots: [] })
    expect(project).not.toBeNull()
    const res = await app.request('/projects/not-a-ulid/storyboard/drafts')
    expect(res.status).toBe(422)
  })

  /**
   * **3 つの状態を区別する。** ここを混ぜると、
   * 「まだ押していない」と「押したが途中で落ちた」が同じ画面になる。
   */
  it('まだ一度も下書きしていなければ run は null（案 0 件ではない）', async () => {
    const project = aProject()
    const { app } = await buildRoutes({ project, shots: [aShot(project.id)] })

    const { status, body } = await getLatest(app, project.id)

    expect(status).toBe(200)
    expect(body.data.run).toBeNull()
    expect(body.data.items).toEqual([])
  })

  it('画面を開き直しても案が残る（保存した内容をそのまま返す）', async () => {
    const project = aProject()
    const shots = [aShot(project.id, { code: 'A' }), aShot(project.id, { code: 'B' })]
    const { app } = await buildRoutes({ project, shots })
    const created = await postDraft(app, project.id)

    const { status, body } = await getLatest(app, project.id)

    expect(status).toBe(200)
    expect(body.data.run?.id).toBe(created.body.data.run.id)
    expect(body.data.items.map((item) => item.description)).toEqual(['案: A', '案: B'])
  })

  /** 途中で落ちた run は `running` のまま残る。**いつ始まったかを必ず添える。** */
  it('running のまま残った run は status と開始時刻を返し、案は返さない', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const { app, drafts } = await buildRoutes({ project, shots })
    const run = await drafts.createRun({ projectId: project.id, drafter: 'test', status: 'running' })
    await drafts.addItems(run.id, [
      { shotId: (shots[0] as Shot).id, description: '途中の案', mood: null, reason: '途中' },
    ])

    const { body } = await getLatest(app, project.id)

    expect(body.data.run?.status).toBe('running')
    expect(body.data.run?.createdAt).toEqual(expect.any(String))
    // 揃っていない案を並べると、全部揃っているように見えてしまう。
    expect(body.data.items).toEqual([])
  })

  it('失敗した run は理由を添えて返す（黙って「案なし」にしない）', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const { app } = await buildRoutes({
      project,
      shots,
      drafter: drafterFor(shots, {
        outcome: { ok: false, costUsd: 0.1, error: { code: 'cli_timeout', message: '終わらない' } },
      }),
    })
    await postDraft(app, project.id)

    const { body } = await getLatest(app, project.id)

    expect(body.data.run?.status).toBe('failed')
    expect(body.data.run?.error?.code).toBe('cli_timeout')
    // **失敗しても払った額は残る。** 0 に畳むと費用メーターが嘘になる。
    expect(body.data.run?.costUsd).toBe(0.1)
  })

  it('作り直したら新しい run を返す（古い run に戻らない）', async () => {
    const project = aProject()
    const shots = [aShot(project.id)]
    const { app } = await buildRoutes({ project, shots })
    const first = await postDraft(app, project.id)
    const second = await postDraft(app, project.id)

    const { body } = await getLatest(app, project.id)

    expect(body.data.run?.id).toBe(second.body.data.run.id)
    expect(body.data.run?.id).not.toBe(first.body.data.run.id)
  })

  it('採用した印も一緒に返る（開き直しても採否が分かる）', async () => {
    const project = aProject()
    const shots = [aShot(project.id, { code: 'A' }), aShot(project.id, { code: 'B' })]
    const { app } = await buildRoutes({ project, shots })
    const created = await postDraft(app, project.id)
    await postAdopt(app, project.id, created.body.data.run.id, [(shots[0] as Shot).id])

    const { body } = await getLatest(app, project.id)
    const byShot = new Map(body.data.items.map((item) => [item.shotId, item] as const))

    expect(byShot.get((shots[0] as Shot).id)?.adoptedAt).not.toBeNull()
    expect(byShot.get((shots[1] as Shot).id)?.adoptedAt).toBeNull()
  })
})

/**
 * 採用の記録（P64-1）。**書く直前に「変える前」を残す。**
 * 27 件が一度に書き換わるので、記録が無いと戻せない。
 */
describe('絵コンテの採用は「変える前」を記録する', () => {
  const withDraft = async (shotOverrides: readonly Partial<Shot>[]) => {
    const project = aProject()
    const shots = shotOverrides.map((overrides) => aShot(project.id, overrides))
    const built = await buildRoutes({ project, shots })
    const { body } = await postDraft(built.app, project.id)
    return { ...built, project, shots, run: body.data.run }
  }

  it('変わる欄だけを、採用した Shot のぶんだけ残す', async () => {
    const { app, project, shots, run, editBatches } = await withDraft([
      { code: 'A', description: 'Aの元の説明', mood: '元の雰囲気' },
      { code: 'B', description: 'Bの元の説明', mood: '元の雰囲気' },
    ])
    const [first] = shots as [Shot]

    await postAdopt(app, project.id, run.id, [first.id])

    const [batch] = editBatches.snapshot()
    expect(batch?.kind).toBe('draft_adopt')
    expect(batch?.entries).toEqual([
      { shotId: first.id, patch: { description: 'Aの元の説明', mood: '元の雰囲気' } },
    ])
    // 採用 Take は触らないので、欄そのものを作らない（lessons L-021）。
    expect(batch?.entries[0] && 'selectedTakeId' in batch.entries[0]).toBe(false)
  })

  it('同じ値を採用し直しただけの Shot は記録に入れない', async () => {
    // 下書きは description を `案: {code}` / mood を `静かな緊張` にする。
    const { app, project, shots, run, editBatches } = await withDraft([
      { code: 'A', description: '案: A', mood: '静かな緊張' },
      { code: 'B', description: 'Bの元の説明', mood: '静かな緊張' },
    ])

    await postAdopt(app, project.id, run.id, shots.map((shot) => shot.id))

    const [batch] = editBatches.snapshot()
    // A は 1 欄も変わらないので落ちる。B は description だけ変わる。
    expect(batch?.entries).toEqual([
      { shotId: shots[1]?.id, patch: { description: 'Bの元の説明' } },
    ])
  })

  /** **記録は書き込みの「直前」に作る。** 作れなかったなら 1 件も書かない。 */
  it('記録を作れなければ Shot を 1 件も書かない', async () => {
    const project = aProject()
    const shots = [aShot(project.id, { code: 'A', description: 'Aの元の説明' })]
    const built = await buildRoutes({
      project,
      shots,
      editBatches: { create: () => Promise.reject(new Error('記録を作れませんでした')) },
    })
    const { body } = await postDraft(built.app, project.id)

    // このアプリは onError を登録していないので、本文ではなく状態だけを見る。
    const res = await built.app.request(
      `/projects/${project.id}/storyboard/drafts/${body.data.run.id}/adopt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shotIds: [shots[0]?.id ?? ''] }),
      },
    )

    expect(res.status).toBe(500)
    const after = await built.shotRepo.findByProject(project.id)
    expect(after[0]?.description).toBe('Aの元の説明')
  })

  it('1 件も変わらなければ記録そのものを作らない', async () => {
    const { app, project, shots, run, editBatches } = await withDraft([
      { code: 'A', description: '案: A', mood: '静かな緊張' },
    ])

    const { status } = await postAdopt(app, project.id, run.id, [shots[0]?.id ?? ''])

    expect(status).toBe(200)
    expect(editBatches.snapshot()).toEqual([])
  })

  it('既に採用済みの案を押し直しても、記録は増えない', async () => {
    const { app, project, shots, run, editBatches } = await withDraft([
      { code: 'A', description: 'Aの元の説明', mood: '元の雰囲気' },
    ])
    const ids = [shots[0]?.id ?? '']

    await postAdopt(app, project.id, run.id, ids)
    await postAdopt(app, project.id, run.id, ids)

    expect(editBatches.snapshot()).toHaveLength(1)
  })
})
