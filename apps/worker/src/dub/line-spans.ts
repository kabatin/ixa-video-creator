import { join } from 'node:path'
import {
  assignLines,
  readingVariants,
  speechChunks,
  type CharacterId,
  type DialogueLine,
  type DubChunk,
  type DubJobId,
  type LineSpan,
  type LineSpanWarning,
  type LineTranscript,
  type Project,
} from '@ixa/domain'
import { SPEECH_FRAME, readPcm16k, rmsFramesFromPcm } from '@ixa/media'
import { VoiceProviderError } from '@ixa/provider-core'
import { DubFailure, mapSequential, type DubProcessorDeps } from './deps.js'
import { lineLabel, type Speaker } from './plan.js'
import { readAloud, ttsCacheKey, type ReadInJob } from './tts-cache.js'

/**
 * 行の区間を決める（ADR-0062）。まず元の Take の音を文字起こしし（台本を寄せる手がかりに渡す）、その語で決める。
 * 文字起こしの口が無い・失敗したときは、読み上げの長さで決め、その行に警告を残す（ログにも書く）。
 *
 * 読み上げの長さは、文字起こしの決め手と控えに使う。区間を決める前に、手の区間の無い読み直す行の読み上げ
 * （最初の読み方）を読み、その声の長さで割り当てる。どの割り当てでも 1.6 倍を超える行があれば、
 * その行だけ残りの読み方も読んで割り当て直し、それでも収まらなければ止める。
 *
 * 読んだ読み上げは保存されるので、この後の行ごとの読み直しは払わずに使い回す。
 */

type SpanContext = { readonly project: Project; readonly dubJobId: DubJobId; readonly workDir: string; readonly readInJob?: ReadInJob }

export type AssignedSpans = {
  readonly spans: ReadonlyMap<number, LineSpan>
  readonly warnings: readonly LineSpanWarning[]
  /** 区間を決めるために払った額。 */
  readonly costUsd: number
  /** 区間を決めるために読んだ読み上げ（行ごとの読み直しで使い回す）。 */
  readonly readInJob: ReadInJob
}

type Lengths = {
  readonly lengths: ReadonlyMap<number, readonly number[]>
  readonly costUsd: number
  readonly readInJob: ReadInJob
}

/** 読み上げの長さで区間を決める行（元の声のまま・足す行・手の区間のある行は読まない）。 */
const needsLength = (line: DialogueLine): boolean =>
  line.dub?.keepOriginal !== true && line.dub?.added !== true && (line.dub?.startSec === undefined || line.dub.endSec === undefined)

const voicedSecOf = async (path: string, raw: string): Promise<number> =>
  speechChunks(rmsFramesFromPcm(await readPcm16k(path, raw), SPEECH_FRAME)).reduce((sum, chunk) => sum + (chunk.endSec - chunk.startSec), 0)

const ttsFailure = (error: unknown, label: string): unknown =>
  error instanceof VoiceProviderError ? new DubFailure('tts_failed', `${label}: ${error.message}`, { retryable: error.retryable }) : error

/** 行ごとに、読み方を `count` 通りまで読み、声の長さを測る（`only` の行だけ）。 */
const readLengths = async (input: {
  readonly deps: DubProcessorDeps
  readonly context: SpanContext
  readonly lines: readonly DialogueLine[]
  readonly speakers: ReadonlyMap<CharacterId, Speaker>
  readonly only: readonly number[]
  readonly count: number
  readonly assertNotCancelled: () => Promise<void>
}): Promise<Lengths> => {
  const read = await mapSequential(input.only, async (lineIndex) => {
    const line = input.lines[lineIndex]
    const speaker = line === undefined ? undefined : input.speakers.get(line.speakerId)
    if (line === undefined || speaker === undefined) return { lineIndex, lengths: [], costUsd: 0, files: [] }
    const label = lineLabel(lineIndex, speaker.character.displayName)
    const variants = readingVariants(line.text).slice(0, input.count)
    const readings = await mapSequential(variants, async (variant) => {
      await input.assertNotCancelled()
      const name = `span-line${String(lineIndex)}-${variant.kind}`
      const request = { voice: speaker.voice, direction: line.dub?.style ?? '', text: variant.text }
      const tts = await readAloud(input.deps, input.context, request, name).catch((error: unknown) => {
        throw ttsFailure(error, label)
      })
      const sec = await voicedSecOf(tts.path, join(input.context.workDir, `${name}.raw`))
      return { sec, costUsd: tts.costUsd, file: [ttsCacheKey(request), tts.path] as const }
    })
    return {
      lineIndex,
      lengths: readings.map((r) => r.sec),
      costUsd: readings.reduce((sum, r) => sum + r.costUsd, 0),
      files: readings.map((r) => r.file),
    }
  })
  return {
    lengths: new Map(read.map((entry) => [entry.lineIndex, entry.lengths])),
    costUsd: read.reduce((sum, entry) => sum + entry.costUsd, 0),
    readInJob: new Map(read.flatMap((entry) => entry.files)),
  }
}

/** 台本（H3 が話した行。足す行は話していない）。 */
export const scriptPrompt = (lines: readonly DialogueLine[]): string =>
  lines
    .filter((line) => line.dub?.added !== true)
    .map((line) => line.text.trim())
    .join(' ')

/** 文字起こしの語。口が無い・失敗したなら null（理由はログに書く。語の中身・音の置き場は書かない）。 */
const transcriptOf = async (input: {
  readonly deps: DubProcessorDeps
  readonly context: SpanContext
  readonly lines: readonly DialogueLine[]
  readonly sourcePcm: Int16Array
}): Promise<LineTranscript> => {
  const transcribe = input.deps.transcribe
  if (transcribe === null) {
    input.deps.logger.warn({ dubJobId: input.context.dubJobId }, '文字起こしの口が無いので、行の区間を読み上げの長さで決めます')
    return null
  }
  try {
    return await transcribe({ pcm: input.sourcePcm, key: input.context.dubJobId, prompt: scriptPrompt(input.lines) })
  } catch (error) {
    input.deps.logger.warn(
      { dubJobId: input.context.dubJobId, err: error },
      '文字起こしに失敗したので、行の区間を読み上げの長さで決めます（apps/audio が動いているか確かめてください）',
    )
    return null
  }
}

/** 行の区間。決まらなければ、どの行かを言い、まとまった区間を文字数の比で割った案を付けて止める。 */
export const assignLineSpans = async (input: {
  readonly deps: DubProcessorDeps
  readonly context: SpanContext
  readonly lines: readonly DialogueLine[]
  readonly speakers: ReadonlyMap<CharacterId, Speaker>
  readonly sourceChunks: readonly DubChunk[]
  readonly sourcePcm: Int16Array
  readonly assertNotCancelled: () => Promise<void>
}): Promise<AssignedSpans> => {
  const transcript = await transcriptOf(input)
  await input.assertNotCancelled()
  const targets = input.lines.flatMap((line, index) => (needsLength(line) ? [index] : []))
  const first = await readLengths({ ...input, only: targets, count: 1 })
  const context = { ...input.context, readInJob: first.readInJob }
  const tried = assignLines(input.sourceChunks, input.lines, first.lengths, transcript)
  const retry = !tried.ok && tried.cause === 'no_fit' ? await readLengths({ ...input, context, only: tried.lineIndices, count: 3 }) : null
  const lengths = retry === null ? first.lengths : new Map([...first.lengths, ...retry.lengths])
  const assigned = retry === null ? tried : assignLines(input.sourceChunks, input.lines, lengths, transcript)
  if (!assigned.ok) throw new DubFailure('lines_unassigned', assigned.reason, { suggestedSpans: assigned.suggestions })
  return {
    spans: new Map(assigned.spans.map((span) => [span.lineIndex, span])),
    warnings: assigned.warnings,
    costUsd: first.costUsd + (retry?.costUsd ?? 0),
    readInJob: new Map([...first.readInJob, ...(retry?.readInJob ?? [])]),
  }
}
