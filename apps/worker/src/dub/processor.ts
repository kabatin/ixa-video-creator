import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DUB_NO_AUDIO_REASON,
  DUB_NO_DIALOGUE_REASON,
  DUB_REASON,
  roundMs,
  speechChunks,
  type DubChunk,
  type DubJob,
  type DubLineRecord,
  type DubParams,
  type LineSpan,
  type MediaAsset,
  type Project,
  type Shot,
  type Take,
} from '@ixa/domain'
import { syncDialogueTelops } from '@ixa/generation'
import { SPEECH_FRAME, mixDub, probeMedia, readPcm16k, rmsFramesFromPcm, sourceIsMono, type DubVoice } from '@ixa/media'
import { VoiceProviderError } from '@ixa/provider-core'
import { GEMINI_DEFAULT_TTS_MODEL } from '@ixa/provider-voice'
import { recordTake } from '../generation/complete.js'
import { DubCancelled, DubFailure, type DubProcessorDeps } from './deps.js'
import { DubJobData } from './job-data.js'
import { dubLine, type LineContext, type LineInput, type LineResult } from './line-dub.js'
import { dubMuteRanges, lineInputs, lineLabel, lineSpans, resolveSpeakers, type Speaker } from './plan.js'

/**
 * 採用中の Take の声を、キャラクターのセリフの声で読み直して差し替える（ADR-0062 段 5b）。
 *
 * 1. 元の Take の音を 16kHz にし、声の区間 → 行の区間
 * 2. 行ごとに読み方を最大 3 通り試し（保存済みはそのまま使う）→ 伸縮 → 一致率で選ぶ → 音量を合わせる
 * 3. 混ぜる（映像は写すだけ）→ 新しい Take（spec を写し、親は元の Take、理由は dub）→ 採用 → 字幕を作り直す
 *
 * **元の Take は変えない**（追記のみ）。止まるときは、どの行・誰の声かを言う日本語の理由で止める。
 */

/**
 * 知らない失敗のときに画面・MCP に出す文。**元の文（手元のパス・ffmpeg の出力など）は出さず、ログにだけ残す。**
 */
export const UNEXPECTED_DUB_MESSAGE = '声を差し替える途中で止まりました。もう一度差し替えてください'

export type DubOutcome =
  | { readonly state: 'succeeded'; readonly takeId: string }
  | { readonly state: 'failed'; readonly code: string }
  | { readonly state: 'cancelled' }
  | { readonly state: 'skipped'; readonly reason: string }

const TERMINAL: readonly DubJob['status'][] = ['succeeded', 'failed', 'cancelled']

type Loaded = {
  readonly job: DubJob
  readonly shot: Shot
  readonly project: Project
  readonly source: Take
  readonly sourceAsset: MediaAsset
}

const load = async (deps: DubProcessorDeps, job: DubJob): Promise<Loaded> => {
  const shot = await deps.shots.findById(job.shotId)
  if (shot === null) throw new DubFailure('shot_missing', 'この Shot は消されました')
  const project = await deps.projects.findById(shot.projectId)
  if (project === null) throw new DubFailure('project_missing', 'この作品は消されました')
  const source = await deps.takes.findById(job.sourceTakeId, { includeHidden: true })
  if (source === null) throw new DubFailure('source_missing', '元の Take が見つかりませんでした')
  const sourceAsset = await deps.mediaAssets.findById(source.mediaAssetId)
  if (sourceAsset === null) throw new DubFailure('source_media_missing', '元の Take の映像が見つかりませんでした')
  if (shot.dialogue.length === 0) throw new DubFailure('no_dialogue', DUB_NO_DIALOGUE_REASON)
  return { job, shot, project, source, sourceAsset }
}

const assertNotCancelled = async (deps: DubProcessorDeps, job: DubJob): Promise<void> => {
  if ((await deps.dubJobs.findById(job.id))?.status === 'cancelled') throw new DubCancelled(job.id)
}

type Source = {
  readonly videoPath: string
  readonly mono: boolean
  readonly durationSec: number
  readonly pcm: Int16Array
  readonly chunks: readonly DubChunk[]
}

/** 元の Take の動画を手元に置き、音を測る。音が無ければ止める。 */
const readSource = async (deps: DubProcessorDeps, loaded: Loaded, workDir: string): Promise<Source> => {
  const videoPath = join(workDir, 'source.mp4')
  await writeFile(videoPath, await deps.storage.get(loaded.sourceAsset.storageKey))
  const mono = await sourceIsMono(videoPath).catch(() => {
    throw new DubFailure('no_source_audio', DUB_NO_AUDIO_REASON)
  })
  const durationSec = (await probeMedia(videoPath)).durationSec
  if (durationSec === null || !(durationSec > 0)) throw new DubFailure('source_unreadable', '元の Take の長さを測れませんでした')
  const pcm = await readPcm16k(videoPath, join(workDir, 'source.raw'))
  return { videoPath, mono, durationSec, pcm, chunks: speechChunks(rmsFramesFromPcm(pcm, SPEECH_FRAME)) }
}

/** 行を順に読み直す。額は Take に載せる分（ジョブの行には読み上げのたびに足してある）。 */
const dubLines = async (
  deps: DubProcessorDeps,
  job: DubJob,
  inputs: readonly LineInput[],
  context: LineContext,
  speakers: ReadonlyMap<string, Speaker>,
): Promise<{ readonly results: ReadonlyMap<number, LineResult>; readonly costUsd: number }> =>
  inputs.reduce<Promise<{ readonly results: ReadonlyMap<number, LineResult>; readonly costUsd: number }>>(async (previous, input) => {
    const acc = await previous
    await assertNotCancelled(deps, job)
    const outcome = await dubLine(deps, input, context).catch((error: unknown) => {
      if (error instanceof VoiceProviderError) {
        throw new DubFailure('tts_failed', `${lineLabel(input.lineIndex, speakers.get(input.line.speakerId)?.character.displayName ?? '')}: ${error.message}`, {
          retryable: error.retryable,
        })
      }
      throw error
    })
    const name = speakers.get(input.line.speakerId)?.character.displayName ?? ''
    if (!outcome.ok) {
      throw new DubFailure('too_fast', `${lineLabel(input.lineIndex, name)}: ${outcome.reason}`)
    }
    return { results: new Map([...acc.results, [input.lineIndex, outcome.result]]), costUsd: acc.costUsd + outcome.result.costUsd }
  }, Promise.resolve({ results: new Map(), costUsd: 0 }))

/** 元の声のままの行の記録（置いた時刻 = 元の区間）。 */
const keptRecord = (lineIndex: number, span: LineSpan): DubLineRecord => ({
  lineIndex,
  mode: 'keep_original',
  added: false,
  sourceStartSec: roundMs(span.startSec),
  sourceEndSec: roundMs(span.endSec),
  placedStartSec: roundMs(span.startSec),
  placedEndSec: roundMs(span.endSec),
  agreement: null,
  tempoMin: 1,
  tempoMax: 1,
  reading: null,
  warnings: [],
})

const recordsOf = (
  shot: Shot,
  spans: ReadonlyMap<number, LineSpan>,
  results: ReadonlyMap<number, LineResult>,
): readonly DubLineRecord[] =>
  shot.dialogue.flatMap((_, index) => {
    const result = results.get(index)
    if (result !== undefined) return [result.record]
    const span = spans.get(index)
    return span === undefined ? [] : [keptRecord(index, span)]
  })

/** 出来た Take を採用する。**人が待つ間に別の Take を選んでいたら、その選びを奪わない。** */
const selectIfStillSource = async (deps: DubProcessorDeps, loaded: Loaded, take: Take): Promise<void> => {
  const selected = await deps.shots.selectTakeIfCurrent(loaded.shot.id, loaded.source.id, take.id)
  if (selected === null) return
  try {
    await deps.events.publish({
      type: 'shot.status',
      projectId: loaded.project.id,
      at: new Date().toISOString(),
      shotId: selected.id,
      status: selected.status,
    })
  } catch (error) {
    deps.logger.warn({ shotId: selected.id, err: error }, '出来事を流せませんでした。画面の表示が古いままになることがあります')
  }
}

const finish = async (deps: DubProcessorDeps, loaded: Loaded, take: Take): Promise<void> => {
  try {
    await deps.mediaQueue.enqueue(take.mediaAssetId)
  } catch (error) {
    deps.logger.error({ takeId: take.id, mediaAssetId: take.mediaAssetId, err: error }, 'media キューへ投入できませんでした。大きさと fps が計測されていません')
  }
  await selectIfStillSource(deps, loaded, take)
  try {
    await syncDialogueTelops({ shots: deps.shots, takes: deps.takes, mediaAssets: deps.mediaAssets, lock: deps.clipLock }, loaded.project.id)
  } catch (error) {
    deps.logger.error({ projectId: loaded.project.id, err: error }, 'セリフの字幕を作り直せませんでした（次に Shot を直したときに揃います）')
  }
}

const run = async (deps: DubProcessorDeps, job: DubJob, workDir: string): Promise<Take | null> => {
  const loaded = await load(deps, job)
  const lines = loaded.shot.dialogue
  const speakers = await resolveSpeakers(deps, lines)
  const source = await readSource(deps, loaded, workDir)
  const spans = lineSpans(source.chunks, lines)
  const inputs = lineInputs({ lines, spans, speakers, sourcePcm: source.pcm, sourceChunks: source.chunks })
  const context: LineContext = { project: loaded.project, dubJobId: job.id, workDir, shotDurationSec: source.durationSec, sourceChunks: source.chunks }
  const { results, costUsd } = await dubLines(deps, job, inputs, context, speakers)
  const voices: readonly DubVoice[] = [...results.values()].flatMap((result) => result.voices)
  const outputPath = join(workDir, 'dubbed.mp4')
  const loudness = await mixDub(
    { videoPath: source.videoPath, voices, muteRanges: dubMuteRanges(lines, spans, source.chunks), sourceMono: source.mono },
    outputPath,
  )
  const record: DubParams = {
    kind: 'dub',
    sourceTakeId: loaded.source.id,
    voiceTool: 'gemini_api',
    model: inputs[0]?.voice.model ?? GEMINI_DEFAULT_TTS_MODEL,
    integratedLufs: Number.isFinite(loudness.integratedLufs) ? loudness.integratedLufs : null,
    lines: [...recordsOf(loaded.shot, spans, results)],
  }
  await assertNotCancelled(deps, job)
  const startedAt = job.startedAt ?? job.queuedAt
  const take = await recordTake(deps, {
    shot: loaded.shot,
    project: loaded.project,
    // 映像は元の Take のまま。仕様・送った文も元のものを写す（違うのは声だけ）。
    spec: loaded.source.spec,
    specHash: loaded.source.specHash,
    providerId: loaded.source.providerId,
    modelId: loaded.source.modelId,
    output: { type: 'local', path: outputPath },
    seedUsed: loaded.source.seedUsed,
    costUsd,
    raw: {},
    sentPrompt: loaded.source.sentPrompt,
    generationTimeSec: Math.max(0, (Date.now() - startedAt.getTime()) / 1000),
    lineage: { parentTakeId: loaded.source.id, regenerationReason: DUB_REASON },
    autoRetake: false,
    providerParams: record,
    onDuplicateMedia: 'new_take',
  })
  const succeeded = await deps.dubJobs.markSucceeded(job.id, { takeId: take.id, record })
  // 書き込みの直前に止められていたら、出来た Take は残すが採用しない（追記のみ）。
  if (succeeded.status === 'cancelled') return null
  await finish(deps, loaded, take)
  return take
}

const markUnexpectedFailure = async (deps: DubProcessorDeps, job: DubJob, error: unknown): Promise<void> => {
  deps.logger.error({ dubJobId: job.id, err: error }, '声の差し替えが知らない理由で止まりました')
  try {
    await deps.dubJobs.markFailed(job.id, { code: 'unexpected', message: UNEXPECTED_DUB_MESSAGE, retryable: true })
  } catch (cause) {
    deps.logger.error({ dubJobId: job.id, err: cause }, '失敗を記録できませんでした。行が「動いている」のまま残ります')
  }
}

export const processDubJob = async (deps: DubProcessorDeps, data: unknown): Promise<DubOutcome> => {
  const parsed = DubJobData.parse(data)
  const found = await deps.dubJobs.findById(parsed.dubJobId)
  if (found === null) throw new Error(`DubJob が見つかりません: ${parsed.dubJobId}`)
  // 冪等性の要。同じジョブが 2 回走っても Take を二重に作らない。
  if (TERMINAL.includes(found.status)) return { state: 'skipped', reason: `status=${found.status}` }
  const job = await deps.dubJobs.markRunning(found.id)
  if (job.status === 'cancelled') return { state: 'skipped', reason: 'status=cancelled' }

  const workDir = join(deps.workDir, job.id)
  await mkdir(workDir, { recursive: true })
  try {
    const take = await run(deps, job, workDir)
    if (take === null) return { state: 'cancelled' }
    deps.logger.info({ dubJobId: job.id, takeId: take.id }, '声を差し替えた Take を作りました')
    return { state: 'succeeded', takeId: take.id }
  } catch (error) {
    if (error instanceof DubCancelled) return { state: 'cancelled' }
    if (error instanceof DubFailure) {
      await deps.dubJobs.markFailed(job.id, error.failure)
      deps.logger.warn({ dubJobId: job.id, code: error.failure.code }, '声の差し替えが止まりました')
      return { state: 'failed', code: error.failure.code }
    }
    // 知らない失敗。行を「動いている」のまま残さない（キューは再試行しないので、残すと永久に止まる）。
    await markUnexpectedFailure(deps, job, error)
    throw error
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch((error: unknown) => {
      deps.logger.warn({ dubJobId: job.id, err: error }, '作業用のファイルを消せませんでした')
    })
  }
}
