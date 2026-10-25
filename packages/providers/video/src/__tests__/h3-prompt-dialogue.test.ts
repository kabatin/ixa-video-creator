import type { ShotGenerationSpec, SpecDialogue } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  buildH3Prompt,
  H3_DIALOGUE_PROMPT_FORMAT,
  H3_PROMPT_FORMAT,
  h3PromptFormatFor,
} from '../vpipe/h3-prompt.js'
import { makeSpec } from './fixtures.js'

/**
 * セリフのある Shot の書き方（`h3-official-v4-dialogue`。ADR-0059）。
 *
 * **版ごと文面を凍結する。** 下のゴールデンが落ちたら直すのではなく次の版を足す。
 * 呼び名と声の説明はキャラクターの欄を一字一句そのまま入れる（Shot ごとに声が変わらないように）。
 */

const CAT = { speakerTag: 'S2', speechName: 'The cat', voiceDescription: "a soft, sly, teasing young woman's voice" }
const MOUSE = { speakerTag: 'S1', speechName: 'The mouse', voiceDescription: "a small, nervous boy's voice" }

const withDialogue = (dialogue: SpecDialogue): ShotGenerationSpec => {
  const base = makeSpec({
    camera: { size: 'medium', angleH: null, angle: null, lensMm: null, movement: 'static', movementIntensity: null },
  })
  return {
    ...base,
    promptParts: { ...base.promptParts, shotDescription: 'ネコがネズミに話しかける', dialogue },
  }
}

const IMAGE_LINE =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'

const golden = (description: string): string =>
  [
    IMAGE_LINE,
    '',
    `integrated_multimodal_description: [Shot 1] Framed as a medium shot. ネコがネズミに話しかける. ${description} The camera holds a static shot.`,
    '',
    'overall_soundscape: Only the dialogue and the ambient sound of the scene.',
    '',
    'non_diegetic_music: None.',
  ].join('\n')

const build = (spec: ShotGenerationSpec): string =>
  buildH3Prompt({ spec, hasStartImage: true, hasEndImage: false })

describe('h3PromptFormatFor', () => {
  it('セリフのある Shot だけ v4。無い Shot は今の版のまま', () => {
    expect(H3_DIALOGUE_PROMPT_FORMAT).toBe('h3-official-v4-dialogue')
    expect(h3PromptFormatFor(makeSpec())).toBe(H3_PROMPT_FORMAT)
    expect(h3PromptFormatFor(withDialogue({ lines: [{ ...CAT, text: 'ねえ', offscreen: false }], onScreen: [] })))
      .toBe('h3-official-v4-dialogue')
  })
})

describe('h3-official-v4-dialogue のゴールデン', () => {
  it('映っている 1 人がしゃべる', () => {
    const spec = withDialogue({
      lines: [{ ...CAT, text: 'ねえ、ネズミくん。', offscreen: false }],
      onScreen: [{ speakerTag: 'S2', speechName: 'The cat' }],
    })
    expect(build(spec)).toBe(
      golden("The cat in a soft, sly, teasing young woman's voice (S2) says: <d>[Japanese] ねえ、ネズミくん。</d>"),
    )
  })

  it('画面外の声。映っている側は口を閉じたまま', () => {
    const spec = withDialogue({
      lines: [{ ...MOUSE, text: 'だれ？', offscreen: true }],
      onScreen: [{ speakerTag: 'S2', speechName: 'The cat' }],
    })
    expect(build(spec)).toBe(
      golden(
        "The mouse in a small, nervous boy's voice (S1) says in an off-screen voiceover: <d>[Japanese] だれ？</d> " +
          "The cat's mouth stays closed.",
      ),
    )
  })

  it('2 人以上が映るときは、行ごとにしゃべらない側の口を閉じさせる', () => {
    const spec = withDialogue({
      lines: [
        { ...CAT, text: 'ねえ、ネズミくん。', offscreen: false },
        { ...MOUSE, text: 'なに？', offscreen: false },
      ],
      onScreen: [
        { speakerTag: 'S2', speechName: 'The cat' },
        { speakerTag: 'S1', speechName: 'The mouse' },
      ],
    })
    expect(build(spec)).toBe(
      golden(
        "The cat in a soft, sly, teasing young woman's voice (S2) says: <d>[Japanese] ねえ、ネズミくん。</d> " +
          "The mouse's mouth stays closed. " +
          "The mouse in a small, nervous boy's voice (S1) says: <d>[Japanese] なに？</d> " +
          "The cat's mouth stays closed.",
      ),
    )
  })

  it('「誰も話さない」は入れない', () => {
    const spec = withDialogue({ lines: [{ ...CAT, text: 'ねえ', offscreen: false }], onScreen: [] })
    expect(build(spec)).not.toContain('Nobody speaks')
  })
})
