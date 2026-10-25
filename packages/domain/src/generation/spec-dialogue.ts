import type { Character } from '../character/character.js'
import type { DialogueLine } from '../shot/dialogue.js'
import type { SpecDialogue } from './spec.js'

/**
 * セリフを生成仕様へ写す（ADR-0059）。
 *
 * 話し手の呼び名と声の説明は**キャラクターの欄をそのまま**使う。Shot ごとに言い換えると、
 * H3 は別の声として作り、同じキャラクターの声が Shot ごとに変わる。
 */

/** 話し手として仕様に要るキャラクターの属性。 */
export type DialogueSpeaker = Pick<
  Character,
  'id' | 'displayName' | 'speakerNo' | 'speechName' | 'voiceDescription'
>

/** 話し手の印。H3 の公式の書き方（`(S2)`）に合わせる。 */
export const speakerTagOf = (speakerNo: number): string => `S${String(speakerNo)}`

/** 話し手がそろっていないので Take を作れない。理由は画面にそのまま出せる日本語。 */
export class DialogueSpeakerError extends Error {
  override readonly name = 'DialogueSpeakerError'
  constructor(readonly problems: readonly string[]) {
    super(problems.join(' / '))
  }
}

const isBlank = (value: string | null): boolean => value === null || value.trim() === ''

/**
 * Take を作る前に直してもらうことを返す（空ならそろっている）。
 * 同じ話し手の行が何行あっても、理由は 1 回だけ挙げる。
 */
export const dialogueSpeakerProblems = (
  lines: readonly DialogueLine[],
  speakers: readonly DialogueSpeaker[],
): readonly string[] => {
  const speakerIds = [...new Set(lines.map((line) => line.speakerId))]
  return speakerIds.flatMap((id) => {
    const speaker = speakers.find((candidate) => candidate.id === id)
    if (speaker === undefined) return ['セリフの話し手が見つかりません（消したキャラクターかもしれません）']
    return [
      ...(isBlank(speaker.speechName) ? [`セリフの話し手「${speaker.displayName}」に英語の呼び名がありません`] : []),
      ...(isBlank(speaker.voiceDescription)
        ? [`セリフの話し手「${speaker.displayName}」に声の説明（英語）がありません`]
        : []),
    ]
  })
}

export type CompileSpecDialogueInput = {
  readonly lines: readonly DialogueLine[]
  /** 行の話し手（画面外の人を含む）。 */
  readonly speakers: readonly DialogueSpeaker[]
  /** 映っている人（Shot の配役の順）。 */
  readonly onScreen: readonly DialogueSpeaker[]
}

/**
 * 行が無ければ null（仕様にキーを置かない）。話し手がそろっていなければ `DialogueSpeakerError`。
 * 映っていても英語の呼び名が無い人は、名指しできないので一覧に入れない。
 */
export const compileSpecDialogue = (input: CompileSpecDialogueInput): SpecDialogue | null => {
  if (input.lines.length === 0) return null
  const problems = dialogueSpeakerProblems(input.lines, input.speakers)
  if (problems.length > 0) throw new DialogueSpeakerError(problems)

  const lines = input.lines.map((line) => {
    const speaker = input.speakers.find((candidate) => candidate.id === line.speakerId)
    // 上の検査を通っているので必ずいる。型のために確かめ直す（黙って飛ばさない）。
    if (speaker === undefined || speaker.speechName === null || speaker.voiceDescription === null) {
      throw new DialogueSpeakerError(['セリフの話し手が見つかりません'])
    }
    return {
      speakerTag: speakerTagOf(speaker.speakerNo),
      speechName: speaker.speechName,
      voiceDescription: speaker.voiceDescription,
      text: line.text,
      offscreen: line.offscreen,
    }
  })

  const onScreen = input.onScreen.flatMap((person) =>
    isBlank(person.speechName) || person.speechName === null
      ? []
      : [{ speakerTag: speakerTagOf(person.speakerNo), speechName: person.speechName }],
  )
  return { lines, onScreen }
}
