import { ProviderId, compileSpec, computeSpecHash, type Project } from '@ixa/domain'
import { GenerationContextError } from '@ixa/generation'
import { createProviderRegistry } from '@ixa/provider-core'
import { describe, expect, it } from 'vitest'
import { createApp, type AppDeps } from '../app.js'
import { MAX_TAKES_PER_REQUEST } from '../routes/shots.js'
import { baseAppDeps, createRecordingQueue } from './app-deps.js'
import { aProject, createTestContextSource } from './fixtures.js'
import {
  aShot,
  aTake,
  createInMemoryShotRepository,
  createInMemoryTakeRepository,
} from '@ixa/generation/testing'
import { createInMemoryGenerationJobRepository } from './in-memory-generation-job-repository.js'
import { createInMemoryProjectRepository } from './in-memory-project-repository.js'
import { createTestVideoProvider, testModel } from './test-video-provider.js'
import {
  CHEAP_MODEL,
  buildFixture,
  postJson,
  type ErrorBody,
  type FixtureOptions,
  type GenerateData,
  type Ok,
} from './shot-test-support.js'

describe('POST /shots/:id/generate', () => {
  it('仕様を組み立てて GenerationJob を作り、キューへ投入する', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    expect(json.data.jobIds).toHaveLength(1)
    expect(json.data.resolvedModel).toBe('test/cheap')
    expect(json.data.specHash).toMatch(/^[0-9a-f]{64}$/)
    expect(json.data.duplicateOfTakeId).toBeNull()

    const jobs = f.generationJobs.snapshot()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.status).toBe('queued')
    expect(jobs[0]?.shotId).toBe(f.shot.id)
    expect(jobs[0]?.specHash).toBe(json.data.specHash)

    // キューに乗るのは ID だけ。実データは worker が DB から読む（ADR-0008）。
    expect(f.queue.enqueued()).toEqual(jobs.map((j) => j.id))

    const shot = f.shots.snapshot()[0]
    expect(shot?.status).toBe('generating')
  })

  it('count の分だけジョブを作る', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      count: MAX_TAKES_PER_REQUEST,
    })

    expect(res.status).toBe(202)
    expect(((await res.json()) as Ok<GenerateData>).data.jobIds).toHaveLength(MAX_TAKES_PER_REQUEST)
    expect(f.queue.enqueued()).toHaveLength(MAX_TAKES_PER_REQUEST)
  })

  it('count が上限を超えたら 422 でジョブを作らない', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      count: MAX_TAKES_PER_REQUEST + 1,
    })

    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('count')
    expect(f.generationJobs.snapshot()).toHaveLength(0)
    expect(f.queue.enqueued()).toHaveLength(0)
  })

  it('同じ specHash の Take があれば duplicateOfTakeId を返すが、生成は止めない', async () => {
    const f = buildFixture()

    // 1 度目の生成で specHash を得て、その仕様の Take が既にある状態を作る
    const first = (await (
      await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    ).json()) as Ok<GenerateData>
    const duplicate = await f.takes.create({
      ...aTake(f.shot, first.data.specHash),
      specHash: first.data.specHash,
    })

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    expect(json.data.specHash).toBe(first.data.specHash)
    expect(json.data.duplicateOfTakeId).toBe(duplicate.id)
    // 警告であって中断ではない
    expect(json.data.jobIds).toHaveLength(1)
    expect(f.generationJobs.snapshot()).toHaveLength(2)
  })

  it('AUTO ならルーターがモデルを選び、決定を GenerationJob に残す', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'AUTO' })
    expect(res.status).toBe(202)

    const json = (await res.json()) as Ok<GenerateData>
    expect(['test/cheap', 'test/good']).toContain(json.data.resolvedModel)

    const job = f.generationJobs.snapshot()[0]
    expect(job?.requestedModel).toBe('AUTO')
    expect(job?.resolvedModel).toBe(json.data.resolvedModel)
    expect(job?.routerDecision?.modelId).toBe(json.data.resolvedModel)
    expect(job?.routerDecision?.weightsVersion).toBe('balanced-v1')
  })

  /**
   * AUTO は「使う AI」で選んだ動画の AI の中から選ぶ（ADR-0032）。
   * .env で有料の口を有効にしていても、別の AI を選んだ人の AUTO（一括生成の既定）がそれを選ばない。
   */
  describe('AUTO と「使う AI」', () => {
    const PAID = testModel({ id: 'paid/best', providerId: 'paid', costPerSecondUsd: 0.001, characterConsistency: 1 })
    const appChoosing = (videoProvider: string) => {
      const project = aProject()
      const shot = aShot(project.id)
      const generationJobs = createInMemoryGenerationJobRepository()
      const deps: AppDeps = {
        ...baseAppDeps(),
        projects: createInMemoryProjectRepository([project]),
        shots: createInMemoryShotRepository([shot]),
        generationJobs,
        registry: createProviderRegistry([createTestVideoProvider([CHEAP_MODEL]), createTestVideoProvider([PAID])]),
        videoProvider: () => Promise.resolve(ProviderId.parse(videoProvider)),
      }
      return { app: createApp(deps), shot }
    }

    it('選んだ AI のモデルだけから選ぶ（安くて良い別の AI があっても）', async () => {
      const f = appChoosing('test')

      const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'AUTO' })

      expect(((await res.json()) as Ok<GenerateData>).data.resolvedModel).toBe('test/cheap')
    })

    it('明示したモデルは、選んだ AI の外でも使える', async () => {
      const f = appChoosing('test')

      const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'paid/best' })

      expect(((await res.json()) as Ok<GenerateData>).data.resolvedModel).toBe('paid/best')
    })

    it('選んだ AI がこの環境に無ければ、AUTO は理由を付けて断る', async () => {
      const f = appChoosing('vpipe')

      const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'AUTO' })

      expect(res.status).toBe(422)
      expect(JSON.stringify(await res.json())).toContain('使う AI')
    })
  })

  it('編集尺をモデルが出せる生成尺へ切り上げた仕様になる（ADR-0011）', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    const json = (await res.json()) as Ok<GenerateData>

    // 編集尺 3.75 秒 → 対応値 4/6/8 のうち 4 秒へ切り上げ
    const expected = await computeSpecHash(
      compileSpec({
        project: f.project,
        shot: f.shot,
        characters: [],
        references: [],
        generationDurationSec: 4,
        seed: null,
        negativePrompt: null,
      }),
    )
    expect(json.data.specHash).toBe(expected)
  })

  it('登録されたモデルで出せない尺なら 422', async () => {
    const project = aProject()
    // 対応値は 4/6/8 秒。30 秒は切り上げ先が無い（ADR-0011）。
    const tooLong = aShot(project.id, { durationSec: 30, code: 'shot_999', order: 9000 })
    const f = buildFixture({ project, extraShots: [tooLong] })

    const res = await postJson(f.app, `/shots/${tooLong.id}/generate`, { model: 'test/cheap' })

    expect(res.status).toBe(422)
    expect(f.generationJobs.snapshot()).toHaveLength(0)
  })

  it('存在しない Shot は 404', async () => {
    const f = buildFixture()
    const res = await postJson(f.app, `/shots/${aShot(f.project.id).id}/generate`, {
      model: 'test/cheap',
    })
    expect(res.status).toBe(404)
  })
})

/**
 * 参照解決の失敗と、それ以外の想定外の失敗を取り違えないこと。
 * 以前はここで `Error` を丸ごと 422 に畳んでいたため、DB の接続断まで
 * 「モデルが不正」として 422 で返り、障害が利用者の入力ミスに見えていた。
 */
describe('POST /shots/:id/generate の失敗の切り分け', () => {
  /** charactersForShot だけが失敗する文脈。他は空を返す。 */
  const appThatFailsContext = (error: Error) => {
    const project = aProject()
    const shot = aShot(project.id)
    const generationJobs = createInMemoryGenerationJobRepository()
    const deps: AppDeps = {
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots: createInMemoryShotRepository([shot]),
      generationJobs,
      registry: createProviderRegistry([createTestVideoProvider([CHEAP_MODEL])]),
      generationContext: {
        ...createTestContextSource({}),
        charactersForShot: () => Promise.reject(error),
      },
    }
    return { app: createApp(deps), shot, generationJobs }
  }

  it('壊れたキャラクター参照は 422 を characters フィールドで返す', async () => {
    const f = appThatFailsContext(
      new GenerationContextError('Shot が存在しない Character を参照しています'),
    )

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })

    expect(res.status).toBe(422)
    const body = (await res.json()) as ErrorBody
    // モデルのせいにしない。直すべきは Shot とキャラクターの紐づけ。
    expect(body.fields?.characters?.[0]).toContain('存在しない Character')
    expect(body.fields?.model).toBeUndefined()
    expect(f.generationJobs.snapshot()).toHaveLength(0)
  })

  it('想定外の失敗は 422 に畳まず 500 にする', async () => {
    const f = appThatFailsContext(new Error('connection terminated unexpectedly'))

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })

    expect(res.status).toBe(500)
    expect(f.generationJobs.snapshot()).toHaveLength(0)
  })
})

describe('GET /generation-jobs/:id', () => {
  it('生成ジョブの状態を返す（UI が完了を判定できるようにするため）', async () => {
    const f = buildFixture()
    const gen = (await (
      await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    ).json()) as Ok<GenerateData>
    const jobId = gen.data.jobIds[0] as string

    const res = await f.app.request(`/generation-jobs/${jobId}`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as Ok<{ id: string; status: string; shotId: string }>
    expect(json.data.id).toBe(jobId)
    expect(json.data.shotId).toBe(f.shot.id)
    expect(json.data.status).toBe('queued')
  })

  it('存在しない id は 404', async () => {
    const f = buildFixture()
    const res = await f.app.request('/generation-jobs/01ARZ3NDEKTSV4RRFFQ69G5FZZ')
    expect(res.status).toBe(404)
  })
})

describe('コスト上限（実 Provider に切り替えたときの歯止め）', () => {
  /** 1 秒 $1 の高額モデル。4 秒生成で $4 になる。 */
  const PRICEY = testModel({ id: 'test/pricey', costPerSecondUsd: 1 })

  const priceyFixture = (options: FixtureOptions = {}) => {
    const project: Project = options.project ?? aProject()
    const shot = aShot(project.id)
    const shots = createInMemoryShotRepository([shot])
    const takes = createInMemoryTakeRepository(options.takes ?? [])
    const deps: AppDeps = {
      ...baseAppDeps(),
      projects: createInMemoryProjectRepository([project]),
      shots,
      takes,
      generationJobs: createInMemoryGenerationJobRepository(),
      registry: createProviderRegistry([createTestVideoProvider([PRICEY])]),
      generationQueue: createRecordingQueue(),
    }
    return { app: createApp(deps), project, shot, takes }
  }

  it('1 回の要求の上限を超えたら 422 で止め、キューに入れない', async () => {
    const f = priceyFixture()
    // 4 秒 × $1 × 4 本 = $16。既定の要求上限 $6 を超える
    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/pricey',
      count: 4,
    })
    expect(res.status).toBe(422)
    const json = (await res.json()) as { error: string; fields?: Record<string, string[]> }
    expect(json.error).toContain('上限')
    expect(json.fields?.cost).toEqual(['request'])
  })

  it('Shot の累積が上限に達したら 422（既に払った分を含めて判定する）', async () => {
    const f = priceyFixture()
    // 既に $5.5 使っている Shot に、さらに $4 を要求する
    await f.takes.create({
      ...aTake(f.shot, 'e'.repeat(64)),
      costUsd: 5.5,
    })
    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/pricey',
      count: 1,
    })
    expect(res.status).toBe(422)
    const json = (await res.json()) as { fields?: Record<string, string[]> }
    expect(json.fields?.cost).toEqual(['shot'])
  })

  it('プロジェクト予算を超えたら 422', async () => {
    const f = priceyFixture({ project: aProject({ budgetUsd: 3 }) })
    // 予算 $3 に対して 4 秒 × $1 = $4
    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/pricey',
      count: 1,
    })
    expect(res.status).toBe(422)
  })

  it('上限内なら通常どおり 202 で投入される', async () => {
    const f = priceyFixture()
    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/pricey',
      count: 1,
    })
    expect(res.status).toBe(202)
  })

  it('コスト 0 の Provider（スタブ）では発動しない', async () => {
    const f = buildFixture()
    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      count: 4,
    })
    expect(res.status).toBe(202)
  })
})

/**
 * レビューの指摘から人が選んだ直しを添えた生成（PHASE 6.1）。
 *
 * **仕様と行の両方に届く必要がある。** 仕様にしか無いと worker が組み直したとき
 * 一致せず `spec_drift` で落ち、行にしか無いと Provider へ指示が届かない（L-012）。
 */
describe('POST /shots/:id/generate — 指摘の直し（corrections）', () => {
  it('直しを GenerationJob の行に積む', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      corrections: ['顔をもっと近く', '光を強く'],
    })

    expect(res.status).toBe(202)
    const jobs = f.generationJobs.snapshot()
    expect(jobs).toHaveLength(1)
    // ここが抜けると worker が同じ仕様を組み直せず spec_drift で落ちる。
    expect(jobs[0]?.corrections).toEqual(['顔をもっと近く', '光を強く'])
  })

  it('直しを添えると specHash が変わる（重複として捨てられない）', async () => {
    // **同じ Shot で比べる。** 別の fixture は shotId が違うので、
    // 直しの有無と無関係にハッシュが変わってしまい何も確かめられない。
    const f = buildFixture()

    const plain = (await (
      await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    ).json()) as Ok<GenerateData>
    const corrected = (await (
      await postJson(f.app, `/shots/${f.shot.id}/generate`, {
        model: 'test/cheap',
        corrections: ['顔をもっと近く'],
      })
    ).json()) as Ok<GenerateData>

    expect(corrected.data.specHash).not.toBe(plain.data.specHash)
  })

  it('直しを添えなければ specHash も行も今までどおり', async () => {
    const f = buildFixture()

    const plain = (await (
      await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/cheap' })
    ).json()) as Ok<GenerateData>
    const empty = (await (
      await postJson(f.app, `/shots/${f.shot.id}/generate`, {
        model: 'test/cheap',
        corrections: [],
      })
    ).json()) as Ok<GenerateData>

    expect(empty.data.specHash).toBe(plain.data.specHash)
    expect(f.generationJobs.snapshot().map((job) => job.corrections)).toEqual([[], []])
  })

  it('件数の上限を超えたら 422 でジョブを作らない', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      corrections: ['a', 'b', 'c', 'd', 'e', 'f'],
    })

    expect(res.status).toBe(422)
    expect(Object.keys(((await res.json()) as ErrorBody).fields ?? {})).toContain('corrections')
    expect(f.generationJobs.snapshot()).toHaveLength(0)
    expect(f.queue.enqueued()).toHaveLength(0)
  })

  it('1 件が長すぎたら 422 でジョブを作らない', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      corrections: ['あ'.repeat(501)],
    })

    expect(res.status).toBe(422)
    // 長さの違反は要素ごとに返る（`corrections.0`）。どの行が長いか分かる必要がある。
    expect(
      Object.keys(((await res.json()) as ErrorBody).fields ?? {}).some((key) =>
        key.startsWith('corrections'),
      ),
    ).toBe(true)
    expect(f.generationJobs.snapshot()).toHaveLength(0)
  })

  it('空白だけの直しを受け付けない', async () => {
    const f = buildFixture()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/cheap',
      corrections: ['   '],
    })

    expect(res.status).toBe(422)
    expect(f.generationJobs.snapshot()).toHaveLength(0)
  })
})

/**
 * 予算で止まること（API 経由）。
 *
 * `checkCostLimits` のドメイン単体テストは緑だが、**API から呼ばれて 422 が返り、
 * ジョブが 1 件も作られない**ところまでは検査されていなかった。
 * しかも本番のスタブ Provider は単価 0（`costPerSecondUsd: 0`）なので、
 * 見積が必ず 0 になり、**実 Provider を有料でつなぐまでこの分岐は一度も走らない**。
 * ここで走らせておく。失敗モードが「無制限に課金される」なので、
 * 生成失敗の経路より優先度が高い。
 */
describe('予算の上限', () => {
  const overBudget = () => buildFixture({ project: aProject({ budgetUsd: 0.01 }) })

  it('予算を超える見積なら 422 でジョブを作らない', async () => {
    const f = overBudget()

    // test/good は 0.5 USD/秒。Shot の尺に関わらず 0.01 は超える。
    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/good' })

    expect(res.status).toBe(422)
    expect(f.generationJobs.snapshot()).toHaveLength(0)
    expect(f.queue.enqueued()).toHaveLength(0)
  })

  it('弾いた理由が cost として返る（何にぶつかったか分かる）', async () => {
    const f = overBudget()

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/good' })
    const body = (await res.json()) as ErrorBody

    expect(Object.keys(body.fields ?? {})).toContain('cost')
    expect(body.error).toBeTruthy()
  })

  it('予算に収まる見積なら通す（止めすぎない）', async () => {
    const f = buildFixture({ project: aProject({ budgetUsd: 500 }) })

    const res = await postJson(f.app, `/shots/${f.shot.id}/generate`, { model: 'test/good' })

    expect(res.status).toBe(202)
    expect(f.queue.enqueued().length).toBeGreaterThan(0)
  })

  it('本数を増やすと上限にぶつかる（1 本あたりではなく合計で見る）', async () => {
    // 1 本なら通り、4 本なら超える予算にする。
    const f = buildFixture({ project: aProject({ budgetUsd: 2 }) })

    const one = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/good',
      count: 1,
    })
    expect(one.status).toBe(202)

    const many = await postJson(f.app, `/shots/${f.shot.id}/generate`, {
      model: 'test/good',
      count: MAX_TAKES_PER_REQUEST,
    })
    expect(many.status).toBe(422)
  })
})
