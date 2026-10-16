import { musicTrackTitle, type MusicJob, type MusicTrackId, type Project } from '@ixa/domain'
import type { MusicJobStatusFromProvider, ProviderJobHandle } from '@ixa/provider-core'
import { MusicJobCancelled, MusicJobFailure, type MusicAdapter, type MusicProcessorDeps } from './deps.js'
import { publishMusicJobStatus } from './events.js'
import { ingestMusic } from './ingest.js'
import { waitForMusic } from './wait.js'

type Succeeded = Extract<MusicJobStatusFromProvider, { state: 'succeeded' }>

/** 止められていたら投げる。できた曲を取り込む前に見る（止めたのに楽曲が増えないように）。 */
const throwIfCancelled = async (deps: MusicProcessorDeps, job: MusicJob): Promise<void> => {
  const current = await deps.musicJobs.findById(job.id)
  if (current?.status === 'cancelled') throw new MusicJobCancelled(job.id)
}

/**
 * できた曲を楽曲にする。1 曲ずつ素材 → 楽曲 → 解析の順。
 * **マスターは、作品にマスターが無いときの 1 曲目だけ。** 既にあるマスター（制作者が選んだ曲）は変えない。
 */
const registerTracks = async (
  deps: MusicProcessorDeps,
  project: Project,
  job: MusicJob,
  result: Succeeded,
): Promise<readonly MusicTrackId[]> => {
  const hasMaster = (await deps.musicTracks.findByProject(project.id)).some((track) => track.isMaster)
  const ids: MusicTrackId[] = []
  for (const [index, output] of result.outputs.entries()) {
    const mediaAssetId = await ingestMusic(deps, project, output.path, job.id)
    const track = await deps.musicTracks.create({
      projectId: project.id,
      mediaAssetId,
      title: musicTrackTitle(job.spec, index),
      isMaster: !hasMaster && index === 0,
    })
    await deps.analysisQueue.enqueue(track.id)
    ids.push(track.id)
  }
  return ids
}

/** 調べるための記録。生成先のジョブと、返ってきた記録（長さ・種・かかった時間）。鍵と URL は入れない。 */
const recordOf = (handle: ProviderJobHandle, raw: Record<string, unknown> = {}): Record<string, unknown> => ({
  providerId: handle.providerId,
  modelId: handle.modelId,
  providerJobRef: handle.ref,
  ...raw,
})

/**
 * 曲を作って楽曲にする（ADR-0048）。順番（GPU）は呼ぶ側が持っている。
 * 作り始めの印 → 投入（冪等キーはジョブの ID）→ 出来上がりを待つ → 数を確かめる → 取り込む → 成功。
 * 手元に置いた WAV は、失敗しても片付ける。
 */
export const generateMusic = async (deps: MusicProcessorDeps, adapter: MusicAdapter, job: MusicJob): Promise<void> => {
  const project = await deps.projects.findById(job.projectId)
  if (project === null) {
    throw new MusicJobFailure({ code: 'project_missing', message: 'この作品は消されました。', retryable: false })
  }
  const running = await deps.musicJobs.markRunning(job.id)
  // 拾ってから作り始めるまでの間に止められた（止めた行は上書きされずに返ってくる）。
  if (running.status === 'cancelled') throw new MusicJobCancelled(job.id)
  await publishMusicJobStatus(deps, running)

  const { spec } = job
  const handle = await adapter.provider.submit({
    model: adapter.model,
    prompt: spec.prompt,
    lyrics: spec.lyrics,
    durationSec: spec.durationSec,
    instrumental: spec.instrumental,
    seed: spec.seed,
    count: spec.count,
    // 投げ直しても二重に作らせない。
    idempotencyKey: job.id,
  })
  await deps.musicJobs.recordProvider(job.id, recordOf(handle))
  try {
    const result = await waitForMusic(deps, adapter.provider, handle, job.id)
    if (result.outputs.length !== spec.count) {
      throw new MusicJobFailure(
        {
          code: 'output_count_mismatch',
          message: `${String(spec.count)} 曲頼みましたが ${String(result.outputs.length)} 曲しか返ってきませんでした。`,
          retryable: true,
        },
        recordOf(handle, result.raw),
      )
    }
    await throwIfCancelled(deps, job)
    const musicTrackIds = await registerTracks(deps, project, job, result)
    const succeeded = await deps.musicJobs.markSucceeded(job.id, {
      musicTrackIds,
      providerRecord: recordOf(handle, result.raw),
    })
    await publishMusicJobStatus(deps, succeeded)
  } finally {
    await adapter.provider.release?.(handle)
  }
}
