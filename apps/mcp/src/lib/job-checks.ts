import { UPSCALE_REASON } from '@ixa/domain'
import { z } from 'zod'
import { IxaApiError, seg, type ApiClient } from '../api-client.js'
import { musicJobCheck } from '../tools/music-generation.js'
import { voiceJobCheck } from '../tools/narration-speak.js'
import { reviewCheck } from '../tools/review.js'
import { sfxJobCheck } from '../tools/sfx.js'
import { ToolInputError } from '../tool-def.js'
import {
  WireActiveGeneration,
  WireAnalysisFailure,
  WireGenerationJob,
  WireRenderJob,
  WireShotPoster,
  WireStartFrame,
  WireStartFrameHistory,
  WireTake,
} from '../wire.js'
import { assertListed, assertNarrationLinesInProject, assertShotsInProject, assertTakePairs } from './project-scope.js'
import type { Check, CheckResult } from './wait-loop.js'

/**
 * 待つ対象ごとの問い合わせ方。API にジョブの種類ごとの口があるので、それぞれを「終わったか」へ揃える。
 */

export const JobRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('generation'), id: z.string().ulid().describe('generation jobId') }),
  z.object({ kind: z.literal('render'), id: z.string().ulid().describe('renderJobId') }),
  z.object({ kind: z.literal('music'), id: z.string().ulid().describe('music jobId from generate_music') }),
  z.object({ kind: z.literal('sfx'), id: z.string().ulid().describe('sfx jobId from generate_sfx') }),
  z.object({ kind: z.literal('analysis'), id: z.string().ulid().describe('musicTrackId') }),
  z.object({ kind: z.literal('start_frame'), id: z.string().ulid().describe('shotId') }),
  z.object({ kind: z.literal('review'), id: z.string().ulid().describe('takeId from review_take'), shotId: z.string().ulid() }),
  z.object({ kind: z.literal('voice'), id: z.string().ulid().describe('voice jobId from speak_narration') }),
  z.object({
    kind: z.literal('upscale'),
    shotId: z.string().ulid(),
    takeId: z.string().ulid().describe('the SOURCE take being upscaled'),
  }),
])
export type JobRef = z.infer<typeof JobRef>

const pending = (detail: Record<string, unknown> = {}): CheckResult => ({ state: 'pending', detail })

const generationCheck = async (api: ApiClient, id: string): Promise<CheckResult> => {
  const job = await api.get(`/generation-jobs/${seg(id)}`, WireGenerationJob)
  if (job.status === 'queued' || job.status === 'running') return pending({ status: job.status, shotId: job.shotId })
  if (job.status === 'succeeded') return { state: 'succeeded', detail: { shotId: job.shotId } }
  return { state: job.status, detail: { shotId: job.shotId, error: job.error?.message ?? null } }
}

const renderCheck = async (api: ApiClient, id: string): Promise<CheckResult> => {
  const job = await api.get(`/renders/${seg(id)}`, WireRenderJob)
  if (job.status === 'succeeded') return { state: 'succeeded', detail: { outputAssetId: job.outputAssetId } }
  if (job.status === 'failed' || job.status === 'cancelled') return { state: job.status, detail: { error: job.error } }
  return pending({ status: job.status, progress: Math.round((job.progress ?? 0) * 100) / 100 })
}

/** 解析は出来るまで 404。失敗は別の口に残る。 */
const analysisCheck = async (api: ApiClient, trackId: string): Promise<CheckResult> => {
  try {
    await api.get(`/music-tracks/${seg(trackId)}/analysis`, z.unknown())
    return { state: 'succeeded', detail: {} }
  } catch (error) {
    if (!(error instanceof IxaApiError) || error.status !== 404) throw error
  }
  const failure = await api.get(`/music-tracks/${seg(trackId)}/analysis/failure`, WireAnalysisFailure)
  return failure === null ? pending() : { state: 'failed', detail: { error: failure.message } }
}

/**
 * 最初のコマ。チェック中・自動のやり直し中は待つ（ADR-0055）。できたら、いま付いている絵のチェックの結果も返す
 * （`retry` や `review` なら、エージェントが view で確かめるか retry_image で描き直す手がかり）。
 */
const startFrameCheck = async (api: ApiClient, shotId: string): Promise<CheckResult> => {
  const frame = await api.get(`/shots/${seg(shotId)}/start-frame`, WireStartFrame)
  const job = frame.job ?? null
  if (job !== null && (job.status === 'queued' || job.status === 'running' || job.status === 'checking')) {
    return pending({ status: job.status, attempt: job.attempt })
  }
  if (job !== null && (job.status === 'failed' || job.status === 'cancelled')) {
    return { state: job.status, detail: { error: job.error } }
  }
  if (frame.mediaAssetId === null) return { state: 'failed', detail: { error: '最初のコマがありません（描いていません）' } }
  const history = await api.get(`/shots/${seg(shotId)}/start-frame/history`, WireStartFrameHistory)
  const current = history.items.find((item) => item.current)
  return {
    state: 'succeeded',
    detail: { mediaAssetId: frame.mediaAssetId, check: current?.check ?? null, jobId: current?.jobId ?? null },
  }
}

/**
 * 解像度を上げたジョブには状態を引く口が無い。出来ると「元の Take を親に、理由が UPSCALE_REASON」の
 * Take が増えるので、それを見る。**失敗は見分けられない**（時間切れになる）。
 */
const upscaleCheck = async (api: ApiClient, shotId: string, takeId: string): Promise<CheckResult> => {
  const takes = await api.get(`/shots/${seg(shotId)}/takes`, z.array(WireTake))
  const upscaled = takes.find((t) => t.parentTakeId === takeId && t.regenerationReason === UPSCALE_REASON)
  return upscaled === undefined ? pending() : { state: 'succeeded', detail: { upscaledTakeId: upscaled.id } }
}

export const checkFor = (api: ApiClient, ref: JobRef): Check => {
  switch (ref.kind) {
    case 'generation':
      return { label: ref, poll: () => generationCheck(api, ref.id) }
    case 'render':
      return { label: ref, poll: () => renderCheck(api, ref.id) }
    case 'music':
      return { label: ref, poll: () => musicJobCheck(api, ref.id) }
    case 'sfx':
      return { label: ref, poll: () => sfxJobCheck(api, ref.id) }
    case 'analysis':
      return { label: ref, poll: () => analysisCheck(api, ref.id) }
    case 'start_frame':
      return { label: ref, poll: () => startFrameCheck(api, ref.id) }
    case 'review':
      return { label: ref, poll: () => reviewCheck(api, ref.id) }
    case 'voice':
      return { label: ref, poll: () => voiceJobCheck(api, ref.id) }
    case 'upscale':
      return { label: ref, poll: () => upscaleCheck(api, ref.shotId, ref.takeId) }
  }
}

const ACTIVE_RENDER = new Set(['queued', 'rendering', 'encoding'])

/**
 * 作品の中で動いているもの全部（動画の生成・最初のコマ・書き出し）が止むまで。
 * 解像度上げと曲作り・効果音作りは含まない（ジョブ ID で待つ）。
 */
export const projectActivityCheck = (api: ApiClient, projectId: string): Check => ({
  label: { kind: 'project', projectId },
  poll: async () => {
    const [generations, posters, renders] = await Promise.all([
      api.get(`/projects/${seg(projectId)}/generations/active`, z.array(WireActiveGeneration)),
      api.get(`/projects/${seg(projectId)}/shot-posters`, z.array(WireShotPoster)),
      api.get(`/projects/${seg(projectId)}/renders`, z.array(WireRenderJob)),
    ])
    const drawing = posters.filter((p) => p.drawing).length
    const rendering = renders.filter((r) => ACTIVE_RENDER.has(r.status)).length
    const detail = {
      videoGenerations: { queued: generations.filter((g) => g.status === 'queued').length, running: generations.filter((g) => g.status === 'running').length },
      startFramesDrawing: drawing,
      rendersActive: rendering,
    }
    return generations.length + drawing + rendering === 0 ? { state: 'succeeded', detail } : pending(detail)
  },
})

const idsOf = <K extends JobRef['kind']>(refs: readonly JobRef[], kind: K): readonly Extract<JobRef, { kind: K }>[] =>
  refs.filter((r): r is Extract<JobRef, { kind: K }> => r.kind === kind)

const WireVoiceJobLine = z.object({ lineId: z.string().nullable() })

/**
 * 待つジョブがどれもこの作品のものか（待つと中身＝状態・素材・指摘を返すので、作品の外のものは待たない）。
 * ジョブの口の多くは作品を返さないので、持ち主（Shot・Take・行）か作品の一覧で引く。
 * 曲・効果音は作品の最近のジョブの一覧（曲 20 件・効果音 50 件）にあるものだけを通す。
 */
export const assertJobsInProject = async (api: ApiClient, projectId: string, refs: readonly JobRef[]): Promise<void> => {
  const project = `/projects/${seg(projectId)}`
  const listed = async (kind: 'render' | 'music' | 'sfx' | 'analysis', path: string, label: string): Promise<void> => {
    const ids = idsOf(refs, kind).map((r) => r.id)
    if (ids.length > 0) await assertListed(api, `${project}/${path}`, ids, label)
  }
  const [generationShots, voiceLines] = await Promise.all([
    Promise.all(idsOf(refs, 'generation').map(async (r) => (await api.get(`/generation-jobs/${seg(r.id)}`, WireGenerationJob)).shotId)),
    Promise.all(idsOf(refs, 'voice').map(async (r) => ({ id: r.id, lineId: (await api.get(`/voice-jobs/${seg(r.id)}`, WireVoiceJobLine)).lineId }))),
  ])
  const unowned = voiceLines.filter((v) => v.lineId === null).map((v) => v.id)
  if (unowned.length > 0) throw new ToolInputError(`作品の行に結び付かない声のジョブは待てません: ${unowned.join(', ')}`)
  const shotIds = [...generationShots, ...idsOf(refs, 'start_frame').map((r) => r.id)]
  if (shotIds.length > 0) await assertShotsInProject(api, projectId, shotIds)
  const lineIds = voiceLines.flatMap((v) => (v.lineId === null ? [] : [v.lineId]))
  if (lineIds.length > 0) await assertNarrationLinesInProject(api, projectId, lineIds)
  await assertTakePairs(api, projectId, [
    ...idsOf(refs, 'review').map((r) => ({ shotId: r.shotId, takeId: r.id })),
    ...idsOf(refs, 'upscale').map((r) => ({ shotId: r.shotId, takeId: r.takeId })),
  ])
  await listed('render', 'renders', '書き出し')
  await listed('music', 'music-jobs', '曲のジョブ（最近のもの）')
  await listed('sfx', 'sfx-jobs', '効果音のジョブ（最近のもの）')
  await listed('analysis', 'music-tracks', '楽曲')
}
