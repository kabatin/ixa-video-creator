import { sfxClipPlacement, type MediaAssetId, type Project, type SfxJob, type TimelineClipId } from '@ixa/domain'
import type { ProviderJobHandle, SfxJobStatusFromProvider } from '@ixa/provider-core'
import { SfxJobCancelled, SfxJobFailure, type SfxAdapter, type SfxProcessorDeps } from './deps.js'
import { publishSfxJobStatus } from './events.js'
import { ingestSfx } from './ingest.js'
import { stopRemoteSfx, waitForSfx } from './wait.js'

type Succeeded = Extract<SfxJobStatusFromProvider, { state: 'succeeded' }>

/** 止められていたら投げる。できた音を取り込む前に見る（止めたのに素材とクリップが増えないように）。 */
const throwIfCancelled = async (deps: SfxProcessorDeps, job: SfxJob): Promise<void> => {
  const current = await deps.sfxJobs.findById(job.id)
  if (current?.status === 'cancelled') throw new SfxJobCancelled(job.id)
}

/**
 * 1 本目を効果音の段（SFX）に置く。きっかけの時刻・音量で、**実際の音の長さ**ぶん、短いフェードアウトを付けて。
 *
 * **同じ素材のクリップが効果音の段に既にあれば、置かずにそれを使う。** 置いた後で worker が落ちると、
 * 同じジョブがやり直される（冪等キーで同じ音が返り、素材は中身で 1 つにまとまる）。ここで見ないと同じ音が 2 つ鳴る。
 */
const placeFirst = async (
  deps: SfxProcessorDeps,
  project: Project,
  job: SfxJob,
  mediaAssetId: MediaAssetId,
  actualDurationSec: number,
): Promise<TimelineClipId> => {
  const existing = await deps.timelineClips.findByProject(project.id)
  const already = existing.find(
    (clip) => clip.track === 'SFX' && clip.content.type === 'media' && clip.content.mediaAssetId === mediaAssetId,
  )
  if (already !== undefined) return already.id
  const placement = sfxClipPlacement(job.spec.cue, actualDurationSec)
  const clip = await deps.timelineClips.create({
    projectId: project.id,
    track: 'SFX',
    startSec: placement.startSec,
    durationSec: placement.durationSec,
    layer: 0,
    opacity: 1,
    content: {
      type: 'media',
      mediaAssetId,
      inSec: 0,
      outSec: placement.durationSec,
      volume: placement.volume,
      fadeOutSec: placement.fadeOutSec,
    },
  })
  return clip.id
}

/** 調べるための記録。生成先のジョブと、返ってきた記録（長さ・種・かかった時間）。鍵と URL は入れない。 */
const recordOf = (handle: ProviderJobHandle, raw: Record<string, unknown> = {}): Record<string, unknown> => ({
  providerId: handle.providerId,
  modelId: handle.modelId,
  providerJobRef: handle.ref,
  ...raw,
})

/** できた音を素材にし、1 本目を置く。素材は番号順。 */
const register = async (
  deps: SfxProcessorDeps,
  project: Project,
  job: SfxJob,
  result: Succeeded,
): Promise<{ readonly mediaAssetIds: readonly MediaAssetId[]; readonly timelineClipId: TimelineClipId }> => {
  const mediaAssetIds: MediaAssetId[] = []
  for (const output of result.outputs) {
    mediaAssetIds.push(await ingestSfx(deps, project, output.path, job.id))
  }
  const [firstId] = mediaAssetIds
  const [firstOutput] = result.outputs
  // 本数は呼ぶ側で確かめてある（1 本以上）。
  if (firstId === undefined || firstOutput === undefined) {
    throw new SfxJobFailure({ code: 'output_missing', message: '効果音が 1 本も返ってきませんでした。', retryable: true })
  }
  const timelineClipId = await placeFirst(deps, project, job, firstId, firstOutput.durationSec)
  return { mediaAssetIds, timelineClipId }
}

/**
 * 成功にして知らせる。**置いている間に止められていたら**、行は止めたまま（上書きされない）返ってくる。
 * 置いたクリップは消さない（人が触ったかもしれない）。代わりにクリップの ID を載せて止めた知らせを流し、
 * 画面にタイムラインを読み直させる。
 */
const settle = async (
  deps: SfxProcessorDeps,
  job: SfxJob,
  outcome: { readonly mediaAssetIds: readonly MediaAssetId[]; readonly timelineClipId: TimelineClipId },
  providerRecord: Record<string, unknown>,
): Promise<void> => {
  const settled = await deps.sfxJobs.markSucceeded(job.id, { ...outcome, providerRecord })
  if (settled.status === 'succeeded') {
    await publishSfxJobStatus(deps, settled)
    return
  }
  deps.logger.warn(
    { sfxJobId: job.id, status: settled.status, timelineClipId: outcome.timelineClipId },
    '効果音を置いている間にジョブが止められました。置いた音は残します',
  )
  await publishSfxJobStatus(deps, { ...settled, timelineClipId: outcome.timelineClipId })
  throw new SfxJobCancelled(job.id)
}

/**
 * 効果音を作って置く（ADR-0052）。順番（GPU）は呼ぶ側が持っている。
 * 投入（冪等キーはジョブの ID）→ 作り始めの印 → 出来上がりを待つ → 数を確かめる → 取り込む → 1 本目を置く → 成功。
 * 手元に置いた WAV は、失敗しても片付ける。
 */
export const generateSfx = async (deps: SfxProcessorDeps, adapter: SfxAdapter, job: SfxJob): Promise<void> => {
  const project = await deps.projects.findById(job.projectId)
  if (project === null) {
    throw new SfxJobFailure({ code: 'project_missing', message: 'この作品は消されました。', retryable: false })
  }
  const { spec } = job
  const handle = await adapter.provider.submit({
    model: adapter.model,
    prompt: spec.cue.prompt,
    negativePrompt: null,
    durationSec: spec.cue.durationSec,
    seed: spec.seed,
    count: spec.count,
    // 投げ直しても二重に作らせない。
    idempotencyKey: job.id,
  })
  try {
    await deps.sfxJobs.recordProvider(job.id, recordOf(handle))
    // 作り始めの印は**投入が通ってから**付ける（混んでいて積み直す間に「作っています」と出さない）。
    const running = await deps.sfxJobs.markRunning(job.id)
    if (running.status === 'cancelled') {
      await stopRemoteSfx(deps, adapter.provider, handle, job.id)
      throw new SfxJobCancelled(job.id)
    }
    await publishSfxJobStatus(deps, running)
    const result = await waitForSfx(deps, adapter, handle, job.id)
    if (result.outputs.length !== spec.count) {
      throw new SfxJobFailure(
        {
          code: 'output_count_mismatch',
          message: `${String(spec.count)} 本頼みましたが ${String(result.outputs.length)} 本しか返ってきませんでした。`,
          retryable: true,
        },
        recordOf(handle, result.raw),
      )
    }
    await throwIfCancelled(deps, job)
    const outcome = await register(deps, project, job, result)
    await settle(deps, job, outcome, recordOf(handle, result.raw))
  } finally {
    await adapter.provider.release?.(handle)
  }
}
