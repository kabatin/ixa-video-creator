import { writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import {
  MAX_TAKE_PEAKS,
  alignTimedText,
  charTimesFromSegments,
  linesFromTranscript,
  type CharTime,
  type MediaAssetId,
  type VoiceJob,
} from '@ixa/domain'
import type { TranscribeResult, TranscribeToolId, Transcriber } from '@ixa/provider-core'
import { VoiceJobCancelled, VoiceJobFailure, type VoiceProcessorDeps } from './deps.js'
import { publishVoiceJobStatus } from './events.js'
import { ingestVoice } from './ingest.js'

/**
 * 録音を取り込む・字の時刻を取る（ADR-0038）。
 * - 録音: 軽いノイズ除去と大きさを揃えた音を素材にし、文字起こしして行に分ける。各行の Take は同じ音の区間を指す
 * - 字の時刻: Take の音を文字起こしして、表示の字に時刻を付ける（音・読みは変えない）
 */

const TRANSCRIBE_TOOLS: readonly TranscribeToolId[] = ['stub', 'whisper_cpp', 'elevenlabs', 'gemini_api']
const PEAKS_PER_SEC = 50
const MAX_FILE_PEAKS = 50_000

const transcriberOf = (deps: VoiceProcessorDeps, job: VoiceJob): Transcriber => {
  const tool = TRANSCRIBE_TOOLS.find((candidate) => candidate === job.tool)
  const transcriber = tool === undefined ? null : deps.transcriber(tool)
  if (transcriber === null) {
    throw new VoiceJobFailure({
      code: 'provider_unavailable',
      message: 'この環境ではこの文字起こしの AI を使えません。「使う AI…」で文字起こしの AI が使えるか確かめてください。',
      retryable: false,
    })
  }
  return transcriber
}

/** 素材を手元のファイルに落とす。 */
const download = async (deps: VoiceProcessorDeps, mediaAssetId: MediaAssetId, dir: string, name: string): Promise<string> => {
  const asset = await deps.mediaAssets.findById(mediaAssetId)
  if (asset === null) throw new VoiceJobFailure({ code: 'input_missing', message: '聞き取る音が見つかりません（消された可能性があります）。', retryable: false })
  const path = join(dir, `${name}${extname(asset.storageKey) || '.wav'}`)
  await writeFile(path, await deps.storage.get(asset.storageKey))
  return path
}

const start = async (deps: VoiceProcessorDeps, job: VoiceJob): Promise<void> => {
  const running = await deps.voiceJobs.markRunning(job.id)
  if (running.status === 'cancelled') throw new VoiceJobCancelled(job.id)
  await publishVoiceJobStatus(deps, running)
}

const throwIfCancelled = async (deps: VoiceProcessorDeps, job: VoiceJob): Promise<void> => {
  if ((await deps.voiceJobs.findById(job.id))?.status === 'cancelled') throw new VoiceJobCancelled(job.id)
}

/** 字の時刻（返さない AI は区間の中を拍で割り振る）。 */
const charsOf = (result: TranscribeResult): readonly CharTime[] => result.chars ?? charTimesFromSegments(result.segments)

/** 区間の波形を、点の数の上限まで間引く（大きいほうを残す）。 */
const slicePeaks = (peaks: readonly number[], inSec: number, outSec: number): number[] => {
  const slice = peaks.slice(Math.floor(inSec * PEAKS_PER_SEC), Math.ceil(outSec * PEAKS_PER_SEC))
  const step = Math.ceil(slice.length / MAX_TAKE_PEAKS)
  if (step <= 1) return slice
  return Array.from({ length: Math.ceil(slice.length / step) }, (_, i) => Math.max(...slice.slice(i * step, (i + 1) * step)))
}

const roundMs = (seconds: number): number => Math.round(seconds * 1000) / 1000

export const runTranscribe = async (deps: VoiceProcessorDeps, job: VoiceJob, dir: string): Promise<void> => {
  const transcriber = transcriberOf(deps, job)
  const project = await deps.projects.findById(job.projectId)
  if (project === null) throw new VoiceJobFailure({ code: 'project_missing', message: 'この作品は消されました。', retryable: false })
  const sourceAssetId = job.inputMediaAssetId
  if (sourceAssetId === null) throw new VoiceJobFailure({ code: 'input_missing', message: '聞き取る音がありません。', retryable: false })
  const input = await download(deps, sourceAssetId, dir, 'recording')
  await start(deps, job)

  const cleanedPath = join(dir, 'cleaned.m4a')
  const loudness = await deps.audio.normalize(input, cleanedPath, { denoise: true })
  const durationSec = await deps.audio.durationSec(cleanedPath)
  const peaks = await deps.audio.peaks(cleanedPath, join(dir, 'peaks.raw'), Math.min(MAX_FILE_PEAKS, Math.max(10, Math.round(durationSec * PEAKS_PER_SEC))))
  const settings = await deps.audioSettings.get(job.projectId)
  const result = await transcriber.transcribe({
    audioPath: cleanedPath,
    language: 'ja',
    // 読み辞書の言葉（登場人物の名前など）に聞き取りを寄せる。
    keyterms: settings.readingDictionary.map((entry) => entry.written),
    workDir: dir,
    durationSec,
  })
  const transcribed = linesFromTranscript(charsOf(result))
  if (transcribed.length === 0) {
    throw new VoiceJobFailure({ code: 'no_speech', message: '声を聞き取れませんでした。録音の音を確かめてください。', retryable: false })
  }
  await throwIfCancelled(deps, job)

  const cleanedId = await ingestVoice(deps, project, cleanedPath, { type: 'derived', sourceAssetId, operation: 'voice_cleanup' })
  const existing = await deps.lines.findByProject(job.projectId)
  const nextOrder = existing.reduce((max, line) => Math.max(max, line.order + 1), 0)
  const placeAt = job.placeAtSec ?? 0
  const lines = await deps.lines.createMany(
    transcribed.map((line, index) => ({
      projectId: job.projectId,
      order: nextOrder + index,
      text: line.text,
      voiceProfileId: job.voiceProfileId,
      startSec: roundMs(placeAt + line.startSec),
    })),
  )
  for (const [index, line] of lines.entries()) {
    const source = transcribed[index]
    if (source === undefined) continue
    const take = await deps.takes.create({
      lineId: line.id,
      source: { type: 'recording', voiceJobId: job.id },
      mediaAssetId: cleanedId,
      inSec: source.startSec,
      outSec: source.endSec,
      spokenText: source.text,
      displayText: source.text,
      specHash: null,
      charTimes: [...source.chars],
      loudnessLufs: Number.isFinite(loudness.integratedLufs) ? loudness.integratedLufs : null,
      peaks: slicePeaks(peaks, source.startSec, source.endSec),
      costUsd: 0,
    })
    await deps.lines.update(line.id, { selectedTakeId: take.id })
  }
  // 文字起こしの額はジョブに残す（行ごとの Take には割らない）。
  const succeeded = await deps.voiceJobs.markSucceeded(job.id, { costUsd: result.costUsd, providerRecord: { ...result.record, lines: lines.length } })
  await publishVoiceJobStatus(deps, succeeded)
}

export const runCharTiming = async (deps: VoiceProcessorDeps, job: VoiceJob, dir: string): Promise<void> => {
  const transcriber = transcriberOf(deps, job)
  const take = job.takeId === null ? null : await deps.takes.findById(job.takeId)
  if (take === null) throw new VoiceJobFailure({ code: 'take_missing', message: 'この声の Take が見つかりません。', retryable: false })
  const input = await download(deps, take.mediaAssetId, dir, 'take')
  await start(deps, job)
  const result = await transcriber.transcribe({ audioPath: input, language: 'ja', keyterms: [], workDir: dir, durationSec: take.outSec })
  // Take の区間の字だけを、区間の頭からの秒にして、表示の字と突き合わせる。
  const within = charsOf(result)
    .filter((char) => char.startSec >= take.inSec && char.startSec < take.outSec)
    .map((char) => ({ char: char.char, startSec: char.startSec - take.inSec, endSec: char.endSec - take.inSec }))
  await throwIfCancelled(deps, job)
  await deps.takes.setCharTimes(take.id, alignTimedText(within, take.displayText))
  const succeeded = await deps.voiceJobs.markSucceeded(job.id, { costUsd: result.costUsd, providerRecord: { ...result.record } })
  await publishVoiceJobStatus(deps, succeeded)
}
