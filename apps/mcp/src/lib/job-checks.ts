import { UPSCALE_REASON } from '@ixa/domain'
import { z } from 'zod'
import { IxaApiError, seg, type ApiClient } from '../api-client.js'
import { musicJobCheck } from '../tools/music-generation.js'
import { sfxJobCheck } from '../tools/sfx.js'
import {
  WireActiveGeneration,
  WireAnalysisFailure,
  WireGenerationJob,
  WireRenderJob,
  WireShotPoster,
  WireStartFrame,
  WireTake,
} from '../wire.js'
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

const startFrameCheck = async (api: ApiClient, shotId: string): Promise<CheckResult> => {
  const frame = await api.get(`/shots/${seg(shotId)}/start-frame`, WireStartFrame)
  const job = frame.job ?? null
  if (job !== null && (job.status === 'queued' || job.status === 'running')) return pending({ status: job.status })
  if (job !== null && (job.status === 'failed' || job.status === 'cancelled')) {
    return { state: job.status, detail: { error: job.error } }
  }
  return frame.mediaAssetId === null
    ? { state: 'failed', detail: { error: '最初のコマがありません（描いていません）' } }
    : { state: 'succeeded', detail: { mediaAssetId: frame.mediaAssetId } }
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
