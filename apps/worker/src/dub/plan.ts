import {
  muteRanges,
  type Character,
  type CharacterId,
  type DialogueLine,
  type DubChunk,
  type LineSpan,
  type VoiceProfile,
} from '@ixa/domain'
import { voicedLevelOfPcm } from '@ixa/media'
import { DubFailure, mapSequential, type DubProcessorDeps } from './deps.js'
import type { LineInput } from './line-dub.js'

/**
 * 差し替えの前の確かめと、行ごとの入力（ADR-0062）。止める理由は全部日本語で、どの行・誰の声かを言う。
 */

export type Speaker = { readonly character: Character; readonly voice: VoiceProfile }

export const lineLabel = (index: number, name: string): string => `セリフの ${String(index + 1)} 行目（${name}）`

/** 読み直す行の話し手の、セリフの声。無い・Gemini でない・鍵の名札が違えば止める。 */
export const resolveSpeakers = async (
  deps: DubProcessorDeps,
  lines: readonly DialogueLine[],
): Promise<ReadonlyMap<CharacterId, Speaker>> => {
  const ids = [...new Set(lines.filter((line) => line.dub?.keepOriginal !== true).map((line) => line.speakerId))]
  const speakers = await mapSequential(ids, async (id): Promise<readonly [CharacterId, Speaker]> => {
    const character = await deps.characters.findById(id)
    const index = lines.findIndex((line) => line.speakerId === id)
    if (character === null) throw new DubFailure('speaker_missing', `${lineLabel(index, '話し手不明')}: 話し手のキャラクターが消されています`)
    const label = lineLabel(index, character.displayName)
    const voiceId = character.dialogueVoiceProfileId
    const voice = voiceId === null ? null : await deps.voices.findById(voiceId)
    if (voice === null) {
      throw new DubFailure(
        'no_dialogue_voice',
        `${label}: ${character.displayName} にセリフの声がありません。キャラクターの「セリフの声」を選んでください`,
      )
    }
    if (voice.tool !== 'gemini_api') {
      throw new DubFailure('dialogue_voice_not_gemini', `${label}: セリフの声「${voice.name}」は Gemini の声ではありません。Gemini の声を選んでください`)
    }
    const designed = voice.designedVoice
    if (designed !== null && designed.keyLabel !== deps.keyLabel) {
      const now = deps.keyLabel === null ? '今は鍵の名札が未設定' : `今の鍵は「${deps.keyLabel}」`
      throw new DubFailure(
        'key_label_mismatch',
        `${label}: 声「${voice.name}」は別の鍵（名札「${designed.keyLabel}」）で作った声なので読めません（${now}）。` +
          '作った鍵に戻すか、今の鍵で声を作り直してください',
      )
    }
    return [id, { character, voice }] as const
  })
  return new Map(speakers)
}

/** 1 行の消す範囲（元の声のままの行は無い）。 */
const windowOf = (line: DialogueLine, span: LineSpan | undefined, sourceChunks: readonly DubChunk[]): DubChunk | null =>
  span === undefined || line.dub?.keepOriginal === true
    ? null
    : (muteRanges([{ startSec: span.startSec, endSec: span.endSec, snap: line.dub?.snap }], sourceChunks)[0] ?? null)

/** 行ごとの入力（声・距離・合わせる大きさ・次の声の頭・一致率の窓）。 */
export const lineInputs = (input: {
  readonly lines: readonly DialogueLine[]
  readonly spans: ReadonlyMap<number, LineSpan>
  readonly speakers: ReadonlyMap<CharacterId, Speaker>
  readonly sourcePcm: Int16Array
  readonly sourceChunks: readonly DubChunk[]
}): readonly LineInput[] =>
  input.lines.flatMap((line, lineIndex): readonly LineInput[] => {
    if (line.dub?.keepOriginal === true) return []
    const speaker = input.speakers.get(line.speakerId)
    if (speaker === undefined) return []
    const span = input.spans.get(lineIndex) ?? null
    const levelSpan = span ?? (line.dub?.levelLikeIndex === undefined ? null : (input.spans.get(line.dub.levelLikeIndex) ?? null))
    const next = [...input.spans.values()]
      .filter((other) => span !== null && other.startSec > span.startSec)
      .reduce<number | null>((min, other) => (min === null || other.startSec < min ? other.startSec : min), null)
    return [
      {
        lineIndex,
        line,
        span,
        voice: speaker.voice,
        levelDb: line.dub?.levelDb ?? speaker.character.dialogueLevelDb,
        sourceLevelDb: levelSpan === null ? null : voicedLevelOfPcm(input.sourcePcm, levelSpan),
        nextSourceStartSec: next,
        window: windowOf(line, input.spans.get(lineIndex), input.sourceChunks),
      },
    ]
  })

/** 元の声を消す範囲（足す行は元の声が無いので消さない）。 */
export const dubMuteRanges = (
  lines: readonly DialogueLine[],
  spans: ReadonlyMap<number, LineSpan>,
  sourceChunks: readonly DubChunk[],
): readonly DubChunk[] =>
  muteRanges(
    lines.flatMap((line, index) => {
      const span = spans.get(index)
      return span === undefined ? [] : [{ startSec: span.startSec, endSec: span.endSec, snap: line.dub?.snap, keepOriginal: line.dub?.keepOriginal }]
    }),
    sourceChunks,
  )

