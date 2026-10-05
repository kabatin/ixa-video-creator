import { TransitionId as TransitionIdSchema, newId, type Project } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  UNSUPPORTED_SCOPE_MESSAGE,
  renderRoutes,
  type RenderJobResponse,
  type TimelineIssueResponse,
} from '../routes/renders.js'
import { timelineRoutes } from '../routes/timeline.js'
import { aProject } from './fixtures.js'
import { aShot } from '@ixa/generation/testing'
import { aShotWithTake, renderDeps, type RenderFixtureDeps } from './timeline-deps.js'
import { aMediaAsset } from './in-memory-timeline-repositories.js'

type Ok<T> = { success: true; data: T }
type ErrorBody = { success: false; error: string; fields?: Record<string, string[]> }
type CreateRenderData = { renderJobId: string; warnings: TimelineIssueResponse[] }

/**
 * `POST /projects/:projectId/render` と RenderJob の参照。
 * 実 DB / 実ストレージ / 実キューには接続しない。
 */

const postRender = (
  deps: RenderFixtureDeps,
  project: Project,
  body: Record<string, unknown> = { preset: 'master_1080p' },
) =>
  renderRoutes(deps).request(`/projects/${project.id}/render`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /projects/:projectId/render', () => {
  it('検証を通れば 202 を返し、RenderJob を作ってキューへ投入する', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4 })
    const deps = renderDeps({
      project,
      shots: [withTake.shot],
      takes: [withTake.take],
      mediaAssets: [withTake.asset],
    })

    const response = await postRender(deps, project)
    const body = (await response.json()) as Ok<CreateRenderData>

    expect(response.status).toBe(202)
    expect(deps.renderJobs.snapshot()).toHaveLength(1)
    expect(deps.queue.enqueued()).toEqual([body.data.renderJobId])
    expect(deps.renderJobs.snapshot()[0]?.status).toBe('queued')
  })

  it('投入した時点の TimelineDocument を timelineSnapshot に保存する', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4 })
    const deps = renderDeps({
      project,
      shots: [withTake.shot],
      takes: [withTake.take],
      mediaAssets: [withTake.asset],
    })

    await postRender(deps, project)

    const snapshot = deps.renderJobs.snapshot()[0]?.timelineSnapshot
    expect(snapshot?.video1).toHaveLength(1)
    expect(snapshot?.video1[0]?.shotId).toBe(withTake.shot.id)
    expect(snapshot?.video1[0]?.durationSec).toBe(4)
    expect(snapshot?.fps).toBe(project.fps)
  })

  /** プレビューと同じく、書き出しにも絵コンテの画像を入れる（制作者 2026-10-02 の選択「プレビューも書き出しも絵を出す」）。 */
  it('採用 Take が無く絵コンテの画像がある Shot は、書き出しにも絵を入れる', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4 })
    const withFrame = aShot(project.id, { startSec: 4, durationSec: 4 })
    const frame = aMediaAsset({ kind: 'image', storageKey: 'media/ws/frame/original.png', mimeType: 'image/png' })
    const deps = renderDeps({
      project,
      shots: [withTake.shot, withFrame],
      takes: [withTake.take],
      mediaAssets: [withTake.asset, frame],
      startFrames: [{ shotId: withFrame.id, mediaAssetId: frame.id }],
    })

    expect((await postRender(deps, project)).status).toBe(202)

    const snapshot = deps.renderJobs.snapshot()[0]?.timelineSnapshot
    expect(snapshot?.video1.map((entry) => [entry.shotId, entry.kind ?? 'video'])).toEqual([
      [withTake.shot.id, 'video'],
      [withFrame.id, 'image'],
    ])
  })

  it('投入後に Shot を変更しても、保存済みスナップショットは変わらない', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4 })
    const deps = renderDeps({
      project,
      shots: [withTake.shot],
      takes: [withTake.take],
      mediaAssets: [withTake.asset],
    })

    await postRender(deps, project)
    const snapshot = deps.renderJobs.snapshot()[0]?.timelineSnapshot

    // 投入後に編集尺を伸ばす。以後の GET /timeline はこちらを返す。
    await deps.shots.update(withTake.shot.id, { durationSec: 9 })

    const live = await timelineRoutes(deps).request(`/projects/${project.id}/timeline`)
    const liveBody = (await live.json()) as Ok<{ video1: { durationSec: number }[] }>

    expect(liveBody.data.video1[0]?.durationSec).toBe(9)
    // レンダリング対象は投入時点の内容のまま。何を書き出したかが後から分かる。
    expect(snapshot?.video1[0]?.durationSec).toBe(4)
    expect(deps.renderJobs.snapshot()[0]?.timelineSnapshot).toEqual(snapshot)
  })

  it('Shot が重なっていれば validateTimeline の error で 422 にする', async () => {
    const project = aProject()
    // 0–4 と 2–6。ADR-0002 で Shot の時間は重ならない。
    const first = aShotWithTake(project, { code: 'shot_001', startSec: 0, durationSec: 4 })
    const second = aShotWithTake(project, { code: 'shot_002', startSec: 2, durationSec: 4 })

    const deps = renderDeps({
      project,
      shots: [first.shot, second.shot],
      takes: [first.take, second.take],
      mediaAssets: [first.asset, second.asset],
    })

    const response = await postRender(deps, project)
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(422)
    expect(body.fields?.timeline?.[0]).toContain('重なっている')
    // 検証に落ちたらジョブは作らない。キューにも入れない。
    expect(deps.renderJobs.snapshot()).toHaveLength(0)
    expect(deps.queue.enqueued()).toHaveLength(0)
  })

  it('warning だけなら 202 で通し、レスポンスに warnings を載せる', async () => {
    const project = aProject()
    const first = aShotWithTake(project, { code: 'shot_001', startSec: 0, durationSec: 4 })
    // 4–6 が空く。隙間は warning（黒画面になるが書き出しは止めない）。
    const second = aShotWithTake(project, { code: 'shot_002', startSec: 6, durationSec: 4 })

    const deps = renderDeps({
      project,
      shots: [first.shot, second.shot],
      takes: [first.take, second.take],
      mediaAssets: [first.asset, second.asset],
    })

    const response = await postRender(deps, project)
    const body = (await response.json()) as Ok<CreateRenderData>

    expect(response.status).toBe(202)
    expect(body.data.warnings.map((issue) => issue.code)).toContain('shot_gap')
    expect(body.data.warnings.every((issue) => issue.severity === 'warning')).toBe(true)
    expect(deps.renderJobs.snapshot()).toHaveLength(1)
  })

  it('error と warning が混ざっていても error があれば 422', async () => {
    const project = aProject()
    const first = aShotWithTake(project, { code: 'shot_001', startSec: 0, durationSec: 4 })
    const second = aShotWithTake(project, { code: 'shot_002', startSec: 2, durationSec: 4 })

    const deps = renderDeps({
      project,
      shots: [first.shot, second.shot],
      takes: [first.take, second.take],
      mediaAssets: [first.asset, second.asset],
      // 隣接していない Transition は error。
      transitions: [
        {
          id: newId(TransitionIdSchema),
          projectId: project.id,
          fromShotId: second.shot.id,
          toShotId: first.shot.id,
          type: 'dissolve',
          durationSec: 0.5,
        },
      ],
    })

    const response = await postRender(deps, project)
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(422)
    expect((body.fields?.timeline ?? []).length).toBeGreaterThan(1)
  })

  it('scope.type が shot なら 422 で未対応と返す（範囲で指定する。黙って full にしない）', async () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4 })
    const deps = renderDeps({
      project,
      shots: [withTake.shot],
      takes: [withTake.take],
      mediaAssets: [withTake.asset],
    })

    const response = await postRender(deps, project, {
      preset: 'preview_720p',
      scope: { type: 'shot', shotId: withTake.shot.id },
    })
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(422)
    expect(body.fields?.scope).toEqual([UNSUPPORTED_SCOPE_MESSAGE])
    expect(deps.renderJobs.snapshot()).toHaveLength(0)
    expect(deps.queue.enqueued()).toHaveLength(0)
  })

  /** 一部だけを書き出す（制作者 2026-10-02「途中までを誰かに見せたい時のために選択した Shot だけを動画として出力」）。 */
  describe('範囲（range）', () => {
    const threeShots = (project: Project) => {
      const shots = [
        aShotWithTake(project, { code: 'CUT-01', startSec: 0, durationSec: 4 }),
        aShotWithTake(project, { code: 'CUT-02', startSec: 4, durationSec: 4 }),
        aShotWithTake(project, { code: 'CUT-03', startSec: 8, durationSec: 4 }),
      ]
      return renderDeps({
        project,
        shots: shots.map((entry) => entry.shot),
        takes: shots.map((entry) => entry.take),
        mediaAssets: shots.map((entry) => entry.asset),
      })
    }

    it('区間だけを切ったタイムラインを保存して投入する', async () => {
      const project = aProject()
      const deps = threeShots(project)

      const response = await postRender(deps, project, {
        preset: 'preview_720p',
        scope: { type: 'range', start: 4, end: 8 },
      })

      expect(response.status).toBe(202)
      const [job] = deps.renderJobs.snapshot()
      expect(job?.scope).toEqual({ type: 'range', start: 4, end: 8 })
      expect(job?.timelineSnapshot.durationSec).toBe(4)
      expect(job?.timelineSnapshot.video1.map((shot) => [shot.startSec, shot.durationSec])).toEqual([[0, 4]])
      expect(deps.queue.enqueued()).toHaveLength(1)
    })

    it('区間が逆・空・尺の外なら 422（ジョブを作らない）', async () => {
      const project = aProject()
      const deps = threeShots(project)

      for (const scope of [
        { type: 'range', start: 8, end: 4 },
        { type: 'range', start: 4, end: 4 },
        { type: 'range', start: 4, end: 30 },
      ]) {
        const response = await postRender(deps, project, { preset: 'preview_720p', scope })
        const body = (await response.json()) as ErrorBody
        expect(response.status).toBe(422)
        expect(body.fields?.scope?.[0]).toMatch(/区間/)
      }
      expect(deps.renderJobs.snapshot()).toHaveLength(0)
    })

    it('区間の外の Shot の error では止めず、区間の中の error では止める', async () => {
      const project = aProject()
      // 0–4 と 2–6 が重なっている。8–12 は離れている。
      const overlapping = [
        aShotWithTake(project, { code: 'shot_001', startSec: 0, durationSec: 4 }),
        aShotWithTake(project, { code: 'shot_002', startSec: 2, durationSec: 4 }),
        aShotWithTake(project, { code: 'shot_003', startSec: 8, durationSec: 4 }),
      ]
      const deps = renderDeps({
        project,
        shots: overlapping.map((entry) => entry.shot),
        takes: overlapping.map((entry) => entry.take),
        mediaAssets: overlapping.map((entry) => entry.asset),
      })

      const outside = await postRender(deps, project, { preset: 'preview_720p', scope: { type: 'range', start: 8, end: 12 } })
      const inside = await postRender(deps, project, { preset: 'preview_720p', scope: { type: 'range', start: 0, end: 6 } })

      expect(outside.status).toBe(202)
      expect(inside.status).toBe(422)
      expect(deps.renderJobs.snapshot()).toHaveLength(1)
    })
  })

  it('未知の preset は 422', async () => {
    const project = aProject()
    const deps = renderDeps({ project })

    const response = await postRender(deps, project, { preset: 'master_8k' })

    expect(response.status).toBe(422)
  })

  it('存在しないプロジェクトは 404', async () => {
    const project = aProject()
    const deps = renderDeps({ project })

    const response = await postRender(deps, aProject())

    expect(response.status).toBe(404)
  })
})

describe('GET /renders/:id と GET /projects/:projectId/renders', () => {
  const seeded = async () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4 })
    const deps = renderDeps({
      project,
      shots: [withTake.shot],
      takes: [withTake.take],
      mediaAssets: [withTake.asset],
    })
    const created = await postRender(deps, project)
    const body = (await created.json()) as Ok<CreateRenderData>
    return { deps, project, renderJobId: body.data.renderJobId }
  }

  it('進捗と状態を返す', async () => {
    const { deps, renderJobId } = await seeded()

    const response = await renderRoutes(deps).request(`/renders/${renderJobId}`)
    const body = (await response.json()) as Ok<RenderJobResponse>

    expect(response.status).toBe(200)
    expect(body.data.id).toBe(renderJobId)
    expect(body.data.status).toBe('queued')
    expect(body.data.progress).toBe(0)
    expect(body.data.outputAssetId).toBeNull()
    // timelineSnapshot は巨大なので一覧・詳細では返さない。
    expect(body.data).not.toHaveProperty('timelineSnapshot')
  })

  it('無ければ 404', async () => {
    const { deps } = await seeded()

    const missing = newId(TransitionIdSchema) // ULID 形式であれば検証は通る
    const response = await renderRoutes(deps).request(`/renders/${missing}`)

    expect(response.status).toBe(404)
  })

  it('プロジェクトの一覧を返す', async () => {
    const { deps, project, renderJobId } = await seeded()

    const response = await renderRoutes(deps).request(`/projects/${project.id}/renders`)
    const body = (await response.json()) as { success: true; data: RenderJobResponse[] }

    expect(response.status).toBe(200)
    expect(body.data.map((job) => job.id)).toEqual([renderJobId])
  })
})

/** 書き出しの音量を揃える（ADR-0039）。既定は揃える。揃えた後の大きさを一覧で返す。 */
describe('POST /projects/:projectId/render（音量を揃える）', () => {
  const ready = () => {
    const project = aProject()
    const withTake = aShotWithTake(project, { startSec: 0, durationSec: 4 })
    return { project, deps: renderDeps({ project, shots: [withTake.shot], takes: [withTake.take], mediaAssets: [withTake.asset] }) }
  }

  it('既定では揃える。揃えないと選べる', async () => {
    const { project, deps } = ready()

    await postRender(deps, project)
    await postRender(deps, project, { preset: 'master_1080p', normalizeLoudness: false })

    expect(deps.renderJobs.snapshot().map((job) => job.normalizeLoudness)).toEqual([true, false])
  })

  it('一覧に、揃えたか・揃えた後の大きさを返す', async () => {
    const { project, deps } = ready()
    await postRender(deps, project)
    const [job] = deps.renderJobs.snapshot()
    if (job === undefined) throw new Error('ジョブがありません')
    await deps.renderJobs.update(job.id, { status: 'succeeded', loudnessLufs: -14.1 })

    const response = await renderRoutes(deps).request(`/projects/${project.id}/renders`)
    const body = (await response.json()) as Ok<RenderJobResponse[]>

    expect(body.data[0]).toMatchObject({ normalizeLoudness: true, loudnessLufs: -14.1 })
  })
})
