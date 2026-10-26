import { join } from 'node:path'
import {
  DUB_ONSET_KEEP_SEC,
  agreement,
  cutPlan,
  fitTempo,
  pairChunks,
  pickReading,
  planLipPair,
  readingVariants,
  roundMs,
  shouldStopTrying,
  speechChunks,
  trimBounds,
  voicedMask,
  type DialogueLine,
  type DubChunk,
  type DubJobId,
  type DubLineMode,
  type DubLineRecord,
  type DubReading,
  type DubWarning,
  type LineSpan,
  type Project,
  type VoiceProfile,
} from '@ixa/domain'
import {
  DUB_PCM_RATE,
  SPEECH_FRAME,
  matchLevelGainDb,
  readPcm16k,
  rmsFramesFromPcm,
  stretchChunks,
  voicedLevelOfPcm,
  type DubVoice,
} from '@ixa/media'
import type { DubProcessorDeps } from './deps.js'
import { readAloud, type ReadInJob } from './tts-cache.js'

/**
 * 1 行を読み直して置く（ADR-0062）。読み方を最大 3 通り試し（保存済みはそのまま使う）、伸縮して、
 * 行の消す範囲の中の一致率で選ぶ。**1.6 倍を超えたら止めるのは、試した読み方がどれも超えたときだけ。**
 */

export type LineInput = {
  readonly lineIndex: number
  readonly line: DialogueLine
  /** 元の声の行の区間。足す行は null。 */
  readonly span: LineSpan | null
  readonly voice: VoiceProfile
  /** 距離（行の指定、無ければキャラクターの既定）。 */
  readonly levelDb: number
  /** 合わせる元の声の大きさ（行の区間、足す行は音量を合わせる行の区間）。測れなければ null。 */
  readonly sourceLevelDb: number | null
  /** 次の行の元の声の頭（口に合わせる行の最後の組はここの手前で切る）。無ければ null。 */
  readonly nextSourceStartSec: number | null
  /** 一致率を比べる窓（行の消す範囲）。口に合わせない行は null。 */
  readonly window: DubChunk | null
}

export type LineContext = {
  readonly project: Project
  readonly dubJobId: DubJobId
  readonly workDir: string
  readonly shotDurationSec: number
  readonly sourceChunks: readonly DubChunk[]
  /** 行の区間を決めるときに読んだ読み上げ（使い回す）。 */
  readonly readInJob?: ReadInJob
}

export type LineResult = {
  readonly record: DubLineRecord
  readonly voices: readonly DubVoice[]
  readonly costUsd: number
}

type Placed = { readonly path: string; readonly startSec: number; readonly endSec: number }

type Attempt =
  | {
      readonly ok: true
      readonly reading: DubReading
      readonly agreement: number | null
      readonly countsMatched: boolean
      readonly placed: readonly Placed[]
      readonly tempos: readonly number[]
      readonly warnings: readonly DubWarning[]
      readonly costUsd: number
    }
  | { readonly ok: false; readonly reason: string; readonly costUsd: number }

const modeOf = (line: DialogueLine): DubLineMode => {
  const dub = line.dub
  if (dub?.cutSec !== undefined) return 'cut'
  if (dub?.fitSec !== undefined) return 'fit'
  if (dub?.placeAtSec !== undefined || dub?.added === true) return 'place_at'
  return 'lip'
}

const MISMATCH_WARNING: DubWarning = { code: 'chunk_count_mismatch', message: '読み上げと口の区切りの数が違うので、つないで合わせました' }

const lengthOf = (chunks: readonly DubChunk[]): number => chunks.reduce((sum, chunk) => sum + (chunk.endSec - chunk.startSec), 0)

/** 置いた声の話している区間（Shot の時刻）。 */
const placedChunks = async (placed: Placed, raw: string): Promise<readonly DubChunk[]> =>
  speechChunks(rmsFramesFromPcm(await readPcm16k(placed.path, raw), SPEECH_FRAME)).map((chunk) => ({
    startSec: chunk.startSec + placed.startSec,
    endSec: chunk.endSec + placed.startSec,
  }))

/** 口に合わせる。区間を 1 対 1 に組み、組ごとに一定の倍率で伸縮して元の区間の頭に置く。 */
const lipAttempt = async (
  input: LineInput,
  context: LineContext,
  ttsPath: string,
  name: string,
): Promise<Omit<Extract<Attempt, { ok: true }>, 'reading' | 'costUsd'> | { readonly ok: false; readonly reason: string }> => {
  const span = input.span
  if (span === null) return { ok: false, reason: '元の声の区間がありません' }
  const pcm = await readPcm16k(ttsPath, join(context.workDir, `${name}.raw`))
  const ttsDurationSec = pcm.length / DUB_PCM_RATE
  const ttsChunks = speechChunks(rmsFramesFromPcm(pcm, SPEECH_FRAME))
  if (ttsChunks.length === 0) return { ok: false, reason: '読み上げに声がありませんでした' }
  const sourceChunks = span.chunks.length > 0 ? span.chunks : [{ startSec: span.startSec, endSec: span.endSec }]
  const paired = pairChunks(ttsChunks, sourceChunks)
  const plans = paired.pairs.map((pair, k) =>
    planLipPair(pair, {
      ttsDurationSec,
      nextSourceStartSec: paired.pairs[k + 1]?.source.startSec ?? input.nextSourceStartSec,
      shotDurationSec: context.shotDurationSec,
    }),
  )
  const failed = plans.find((plan) => !plan.ok)
  if (failed !== undefined && !failed.ok) return { ok: false, reason: failed.reason }
  const okPlans = plans.flatMap((plan) => (plan.ok ? [plan] : []))
  const placed = await Promise.all(
    okPlans.map(async (plan, k): Promise<Placed> => {
      const path = join(context.workDir, `${name}.lip${String(k)}.wav`)
      const natural = lengthOf(plan.pieces) / plan.tempo
      const cut = plan.cut ? cutPlan(natural, plan.placedEndSec - plan.placedStartSec) : undefined
      await stretchChunks(ttsPath, path, { pieces: plan.pieces, tempo: plan.tempo, cut })
      return { path, startSec: plan.placedStartSec, endSec: plan.placedEndSec }
    }),
  )
  const window = input.window
  const voiced = (await Promise.all(placed.map((p, k) => placedChunks(p, join(context.workDir, `${name}.lip${String(k)}.raw`))))).flat()
  const score =
    window === null ? null : agreement(voicedMask(context.sourceChunks, window.startSec, window.endSec), voicedMask(voiced, window.startSec, window.endSec))
  return {
    ok: true,
    agreement: score,
    countsMatched: paired.countsMatched,
    placed,
    tempos: okPlans.map((plan) => plan.tempo),
    warnings: [...okPlans.flatMap((plan) => plan.warnings), ...(paired.countsMatched ? [] : [MISMATCH_WARNING])],
  }
}

/** 口に合わせずに置く（置く時刻・収める長さ・切る長さ・足す行）。 */
const placeAttempt = async (
  input: LineInput,
  context: LineContext,
  ttsPath: string,
  name: string,
): Promise<Omit<Extract<Attempt, { ok: true }>, 'reading' | 'costUsd'> | { readonly ok: false; readonly reason: string }> => {
  const dub = input.line.dub
  const pcm = await readPcm16k(ttsPath, join(context.workDir, `${name}.raw`))
  const bounds = trimBounds(rmsFramesFromPcm(pcm, SPEECH_FRAME), pcm.length / DUB_PCM_RATE)
  if (bounds === null) return { ok: false, reason: '読み上げに声がありませんでした' }
  const length = bounds.endSec - bounds.startSec
  const fit = dub?.fitSec === undefined ? null : fitTempo(length, dub.fitSec)
  if (fit !== null && !fit.ok) return { ok: false, reason: fit.reason }
  const tempo = fit?.ok === true ? fit.tempo : 1
  const cut = dub?.cutSec === undefined ? undefined : cutPlan(length, dub.cutSec)
  const startSec = roundMs(dub?.placeAtSec ?? Math.max(0, (input.span?.startSec ?? 0) - DUB_ONSET_KEEP_SEC))
  const endSec = roundMs(Math.min(context.shotDurationSec, startSec + (cut === undefined ? length / tempo : cut.durationSec)))
  const path = join(context.workDir, `${name}.place.wav`)
  await stretchChunks(ttsPath, path, { pieces: [bounds], tempo, cut })
  return {
    ok: true,
    agreement: null,
    countsMatched: true,
    placed: [{ path, startSec, endSec: Math.max(startSec, endSec) }],
    tempos: [tempo],
    warnings: fit?.ok === true ? fit.warnings : [],
  }
}

const tryReading = async (
  deps: DubProcessorDeps,
  input: LineInput,
  context: LineContext,
  variant: { readonly kind: DubReading; readonly text: string },
): Promise<Attempt> => {
  const name = `line${String(input.lineIndex)}-${variant.kind}`
  const tts = await readAloud(deps, context, { voice: input.voice, direction: input.line.dub?.style ?? '', text: variant.text }, name)
  const attempt =
    modeOf(input.line) === 'lip' ? await lipAttempt(input, context, tts.path, name) : await placeAttempt(input, context, tts.path, name)
  return attempt.ok ? { ...attempt, reading: variant.kind, costUsd: tts.costUsd } : { ...attempt, costUsd: tts.costUsd }
}

/** 読み方を順に試す。数が合い一致率 0.9 以上（口に合わせない行は収まった時点）で打ち切る。 */
const tryReadings = async (
  deps: DubProcessorDeps,
  input: LineInput,
  context: LineContext,
  variants: readonly { readonly kind: DubReading; readonly text: string }[],
  done: readonly Attempt[] = [],
): Promise<readonly Attempt[]> => {
  const [next, ...rest] = variants
  if (next === undefined) return done
  const attempt = await tryReading(deps, input, context, next)
  const tried = [...done, attempt]
  const enough = attempt.ok && (modeOf(input.line) !== 'lip' || shouldStopTrying(attempt))
  return enough ? tried : tryReadings(deps, input, context, rest, tried)
}

const concatPcm = async (placed: readonly Placed[], workDir: string, name: string): Promise<Int16Array> => {
  const parts = await Promise.all(placed.map((p, k) => readPcm16k(p.path, join(workDir, `${name}.level${String(k)}.raw`))))
  const out = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((offset, part) => {
    out.set(part, offset)
    return offset + part.length
  }, 0)
  return out
}

const uniqueWarnings = (warnings: readonly DubWarning[]): readonly DubWarning[] =>
  warnings.filter((warning, index) => warnings.findIndex((other) => other.code === warning.code) === index).slice(0, 8)

export type LineOutcome = { readonly ok: true; readonly result: LineResult } | { readonly ok: false; readonly reason: string; readonly costUsd: number }

export const dubLine = async (deps: DubProcessorDeps, input: LineInput, context: LineContext): Promise<LineOutcome> => {
  const attempts = await tryReadings(deps, input, context, readingVariants(input.line.text).slice(0, 3))
  const costUsd = attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0)
  const best = pickReading(attempts.flatMap((attempt) => (attempt.ok ? [attempt] : [])))
  if (best === null) {
    const last = attempts[attempts.length - 1]
    return { ok: false, reason: last !== undefined && !last.ok ? last.reason : '読み上げを作れませんでした', costUsd }
  }
  const pcm = await concatPcm(best.placed, context.workDir, `line${String(input.lineIndex)}`)
  const gainDb = matchLevelGainDb({ sourceLevelDb: input.sourceLevelDb, voiceLevelDb: voicedLevelOfPcm(pcm), levelDb: input.levelDb })
  const record: DubLineRecord = {
    lineIndex: input.lineIndex,
    mode: modeOf(input.line),
    added: input.line.dub?.added === true,
    sourceStartSec: input.span === null ? null : roundMs(input.span.startSec),
    sourceEndSec: input.span === null ? null : roundMs(input.span.endSec),
    placedStartSec: roundMs(Math.min(...best.placed.map((p) => p.startSec))),
    placedEndSec: roundMs(Math.max(...best.placed.map((p) => p.endSec))),
    agreement: best.agreement,
    tempoMin: Math.min(...best.tempos),
    tempoMax: Math.max(...best.tempos),
    reading: best.reading,
    warnings: [...uniqueWarnings(best.warnings)],
  }
  return { ok: true, result: { record, voices: best.placed.map((p) => ({ path: p.path, startSec: p.startSec, gainDb })), costUsd } }
}
