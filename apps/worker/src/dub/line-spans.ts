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
  type Project,
} from '@ixa/domain'
import { SPEECH_FRAME, readPcm16k, rmsFramesFromPcm } from '@ixa/media'
import { VoiceProviderError } from '@ixa/provider-core'
import { DubFailure, mapSequential, type DubProcessorDeps } from './deps.js'
import { lineLabel, type Speaker } from './plan.js'
import { readAloud, ttsCacheKey, type ReadInJob } from './tts-cache.js'

/**
 * 行の区間を、読み上げの長さで決める（ADR-0062）。区間を決める前に、手の区間の無い読み直す行の読み上げ
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

/** 行の区間。決まらなければ、どの行かを言い、まとまった区間を文字数の比で割った案を付けて止める。 */
export const assignLineSpans = async (input: {
  readonly deps: DubProcessorDeps
  readonly context: SpanContext
  readonly lines: readonly DialogueLine[]
  readonly speakers: ReadonlyMap<CharacterId, Speaker>
  readonly sourceChunks: readonly DubChunk[]
  readonly assertNotCancelled: () => Promise<void>
}): Promise<AssignedSpans> => {
  const targets = input.lines.flatMap((line, index) => (needsLength(line) ? [index] : []))
  const first = await readLengths({ ...input, only: targets, count: 1 })
  const context = { ...input.context, readInJob: first.readInJob }
  const tried = assignLines(input.sourceChunks, input.lines, first.lengths)
  const retry = !tried.ok && tried.cause === 'no_fit' ? await readLengths({ ...input, context, only: tried.lineIndices, count: 3 }) : null
  const lengths = retry === null ? first.lengths : new Map([...first.lengths, ...retry.lengths])
  const assigned = retry === null ? tried : assignLines(input.sourceChunks, input.lines, lengths)
  if (!assigned.ok) throw new DubFailure('lines_unassigned', assigned.reason, { suggestedSpans: assigned.suggestions })
  return {
    spans: new Map(assigned.spans.map((span) => [span.lineIndex, span])),
    warnings: assigned.warnings,
    costUsd: first.costUsd + (retry?.costUsd ?? 0),
    readInJob: new Map([...first.readInJob, ...(retry?.readInJob ?? [])]),
  }
}
