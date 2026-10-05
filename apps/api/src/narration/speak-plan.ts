import {
  estimateSpeechSec,
  lineReading,
  voiceSpecHash,
  voiceSpecOf,
  type NarrationLine,
  type NarrationTakeId,
  type ReadingEntry,
  type VoiceProfile,
  type VoiceSpec,
} from '@ixa/domain'
import type { NarrationDeps } from './deps.js'

/**
 * 1 行を声にするかの見立て（ADR-0038）。1 行の口とまとめての口が同じ規則を使う。
 * - 同じ読み・声・設定の Take があれば作り直さない（選んでいればそのまま、ほかの Take ならそれを選ぶ）
 */
export type SpeakPlan =
  | { readonly kind: 'no_voice' }
  | { readonly kind: 'unavailable'; readonly voice: VoiceProfile }
  | { readonly kind: 'active' }
  | { readonly kind: 'up_to_date'; readonly takeId: NarrationTakeId }
  | { readonly kind: 'reuse'; readonly takeId: NarrationTakeId }
  | {
      readonly kind: 'speak'
      readonly voice: VoiceProfile
      readonly spec: VoiceSpec
      readonly estimateUsd: number
    }

export type SpeakContext = {
  readonly voices: ReadonlyMap<string, VoiceProfile>
  readonly dictionary: readonly ReadingEntry[]
  /** 作っている途中の行。 */
  readonly activeLineIds: ReadonlySet<string>
}

export const planSpeak = async (deps: NarrationDeps, line: NarrationLine, context: SpeakContext): Promise<SpeakPlan> => {
  const voice = line.voiceProfileId === null ? undefined : context.voices.get(line.voiceProfileId)
  if (voice === undefined) return { kind: 'no_voice' }
  if (deps.voiceAdapter(voice.tool) === null) return { kind: 'unavailable', voice }
  if (context.activeLineIds.has(line.id)) return { kind: 'active' }
  const reading = lineReading(line, context.dictionary).reading
  const spec = voiceSpecOf(voice, line, reading)
  const existing = await deps.takes.findLatestBySpecHash(line.id, await voiceSpecHash(spec))
  if (existing !== null) {
    return existing.id === line.selectedTakeId ? { kind: 'up_to_date', takeId: existing.id } : { kind: 'reuse', takeId: existing.id }
  }
  const estimateUsd = deps.speakCostEstimate({
    tool: voice.tool,
    model: voice.model,
    readingChars: [...reading].length,
    estimatedSec: estimateSpeechSec(reading, voice.speed),
  })
  return { kind: 'speak', voice, spec, estimateUsd }
}

/** 見立てに要るものを 1 度に集める。 */
export const speakContextFor = async (deps: NarrationDeps, projectId: VoiceProfile['projectId']): Promise<SpeakContext> => {
  const [voices, settings, active] = await Promise.all([
    deps.voices.findByProject(projectId),
    deps.audioSettings.get(projectId),
    deps.voiceJobs.findActiveByProject(projectId),
  ])
  return {
    voices: new Map(voices.map((voice) => [voice.id as string, voice])),
    dictionary: settings.readingDictionary,
    activeLineIds: new Set(active.flatMap((job) => (job.lineId === null ? [] : [job.lineId as string]))),
  }
}

/** 声の AI の口が無いときの言葉。 */
export const unavailableMessage = (voice: VoiceProfile): string =>
  `「${voice.name}」の AI は、この環境ではまだ使えません。「使う AI…」で声の AI が使えるか確かめてください`
