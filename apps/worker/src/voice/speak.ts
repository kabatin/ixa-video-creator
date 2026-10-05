import { join } from 'node:path'
import {
  MAX_TAKE_PEAKS,
  displayTimesFromReading,
  lineReading,
  voiceSpecHash,
  type CharTime,
  type NarrationLine,
  type Project,
  type VoiceJob,
  type VoiceSpec,
} from '@ixa/domain'
import type { SpeakResult } from '@ixa/provider-core'
import { VoiceJobCancelled, VoiceJobFailure, type VoiceProcessorDeps } from './deps.js'
import { publishVoiceJobStatus } from './events.js'
import { syncTelopsAfterVoice } from './telops.js'
import { generatedVoiceOrigin, ingestVoice } from './ingest.js'

/**
 * 行を声にする・試しに読む（ADR-0038）。AI に読ませ → 大きさを整え → 長さと波形を測り → 素材にする。
 * 行の声は Take を足して行に選ぶ。試しに読んだ声はジョブに音だけ残す。
 */

/** 1 秒あたりの波形の点。 */
const PEAKS_PER_SEC = 50

/** 止められていたら手を引く（止めた行は上書きされずに返ってくる）。 */
const throwIfCancelled = async (deps: VoiceProcessorDeps, job: VoiceJob): Promise<void> => {
  const current = await deps.voiceJobs.findById(job.id)
  if (current?.status === 'cancelled') throw new VoiceJobCancelled(job.id)
}

const specOf = (job: VoiceJob): VoiceSpec => {
  if (job.spec === null) throw new VoiceJobFailure({ code: 'spec_missing', message: '声の指定がありません。', retryable: false })
  return job.spec
}

const projectOf = async (deps: VoiceProcessorDeps, job: VoiceJob): Promise<Project> => {
  const project = await deps.projects.findById(job.projectId)
  if (project === null) throw new VoiceJobFailure({ code: 'project_missing', message: 'この作品は消されました。', retryable: false })
  return project
}

type Spoken = {
  readonly result: SpeakResult
  readonly path: string
  readonly loudnessLufs: number | null
  readonly durationSec: number
  readonly peaks: readonly number[]
}

/** 読ませて、整えて、測る。 */
const speakAndMeasure = async (deps: VoiceProcessorDeps, job: VoiceJob, spec: VoiceSpec, dir: string): Promise<Spoken> => {
  const adapter = deps.voiceAdapter(spec.tool)
  if (adapter === null) {
    throw new VoiceJobFailure({
      code: 'provider_unavailable',
      message: 'この環境ではこの声の AI を使えません。「使う AI…」で声の AI が使えるか確かめてください。',
      retryable: false,
    })
  }
  const running = await deps.voiceJobs.markRunning(job.id)
  if (running.status === 'cancelled') throw new VoiceJobCancelled(job.id)
  await publishVoiceJobStatus(deps, running)

  const result = await adapter.speak({
    text: spec.reading,
    model: spec.model,
    voiceName: spec.voiceName,
    styleNote: spec.styleNote,
    direction: spec.direction,
    speed: spec.speed,
    tuning: spec.tuning,
    language: spec.language,
    outputBasePath: join(dir, 'raw'),
  })
  // 読み終わった後に止められたら、取り込まない（止めたのに声が変わらないように）。
  await throwIfCancelled(deps, job)
  const path = join(dir, 'voice.m4a')
  const loudness = await deps.audio.normalize(result.audioPath, path, { denoise: false })
  const durationSec = await deps.audio.durationSec(path)
  if (!(durationSec > 0)) throw new VoiceJobFailure({ code: 'empty_audio', message: '声が空でした。読みを確かめてください。', retryable: true })
  const points = Math.min(MAX_TAKE_PEAKS, Math.max(10, Math.round(durationSec * PEAKS_PER_SEC)))
  const peaks = await deps.audio.peaks(path, join(dir, 'peaks.raw'), points)
  return {
    result,
    path,
    loudnessLufs: Number.isFinite(loudness.integratedLufs) ? loudness.integratedLufs : null,
    durationSec,
    peaks,
  }
}

/**
 * 読みの字の時刻を、表示の字の時刻にする。**頼んだ後に読みが変わっていたら付けない**
 * （辞書や読みを直した後の表示に、前の読みの時刻を写すと字幕がずれる）。
 */
const displayTimesOf = async (
  deps: VoiceProcessorDeps,
  line: NarrationLine,
  spec: VoiceSpec,
  readingTimes: readonly CharTime[] | null,
): Promise<readonly CharTime[] | null> => {
  if (readingTimes === null) return null
  const settings = await deps.audioSettings.get(line.projectId)
  const applied = lineReading(line, settings.readingDictionary)
  if (applied.reading !== spec.reading) return null
  try {
    return displayTimesFromReading(applied, readingTimes)
  } catch (error) {
    deps.logger.warn({ lineId: line.id, err: error }, '字の時刻を表示に写せませんでした。時刻なしで続けます')
    return null
  }
}

export const runSpeak = async (deps: VoiceProcessorDeps, job: VoiceJob, dir: string): Promise<void> => {
  const spec = specOf(job)
  const project = await projectOf(deps, job)
  const line = job.lineId === null ? null : await deps.lines.findById(job.lineId)
  if (line === null) throw new VoiceJobFailure({ code: 'line_missing', message: 'この行は消されました。', retryable: false })

  const spoken = await speakAndMeasure(deps, job, spec, dir)
  const mediaAssetId = await ingestVoice(deps, project, spoken.path, generatedVoiceOrigin(job.id))
  const take = await deps.takes.create({
    lineId: line.id,
    source: { type: 'generated', voiceJobId: job.id, tool: spec.tool, model: spec.model, voiceName: spec.voiceName },
    mediaAssetId,
    inSec: 0,
    outSec: spoken.durationSec,
    spokenText: spec.reading,
    displayText: line.text,
    specHash: await voiceSpecHash(spec),
    charTimes: await displayTimesOf(deps, line, spec, spoken.result.charTimes).then((times) => (times === null ? null : [...times])),
    loudnessLufs: spoken.loudnessLufs,
    peaks: [...spoken.peaks],
    costUsd: spoken.result.costUsd,
  })
  // 作り直したら新しい声を選ぶ（前の声に戻すのは Take を選び直せばよい）。
  await deps.lines.update(line.id, { selectedTakeId: take.id })
  await syncTelopsAfterVoice(deps, job)
  const succeeded = await deps.voiceJobs.markSucceeded(job.id, { costUsd: spoken.result.costUsd, providerRecord: { ...spoken.result.record } })
  await publishVoiceJobStatus(deps, succeeded)
}

export const runPreview = async (deps: VoiceProcessorDeps, job: VoiceJob, dir: string): Promise<void> => {
  const spec = specOf(job)
  const project = await projectOf(deps, job)
  const spoken = await speakAndMeasure(deps, job, spec, dir)
  const mediaAssetId = await ingestVoice(deps, project, spoken.path, generatedVoiceOrigin(job.id))
  const succeeded = await deps.voiceJobs.markSucceeded(job.id, {
    costUsd: spoken.result.costUsd,
    providerRecord: { ...spoken.result.record },
    resultMediaAssetId: mediaAssetId,
  })
  await publishVoiceJobStatus(deps, succeeded)
}
