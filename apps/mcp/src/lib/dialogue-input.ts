import {
  MAX_DIALOGUE_LINES,
  MAX_DIALOGUE_TEXT_LENGTH,
  MAX_DIALOGUE_TRANSLATION_LENGTH,
  MAX_SPEECH_NAME_LENGTH,
  MAX_VOICE_DESCRIPTION_LENGTH,
} from '@ixa/domain'
import { z } from 'zod'
import { Id } from '../tool-def.js'

/**
 * セリフの入力（ADR-0059）。上限は domain の値を使う（書き写すとずれて、片方だけ通る入力ができる）。
 * edit_shots・plan_shots・restructure_shots が同じ形を受ける。
 */
export const DialogueLineInput = z.object({
  speakerId: Id.describe('Character id of the speaker. Need not be in the cast (off-screen voice).'),
  text: z.string().trim().min(1).max(MAX_DIALOGUE_TEXT_LENGTH).describe('The spoken line, in Japanese.'),
  offscreen: z
    .boolean()
    .optional()
    .describe('Off-screen voiceover: the speaker is not visible; visible characters keep their mouths closed.'),
  translation: z
    .string()
    .max(MAX_DIALOGUE_TRANSLATION_LENGTH)
    .nullable()
    .optional()
    .describe(
      'English subtitle line (optional). Shown as the smaller second line of the automatic dialogue subtitle; ' +
        'editing the subtitle translation with edit_clips writes back here.',
    ),
})

export const DialogueInput = z
  .array(DialogueLineInput)
  .max(MAX_DIALOGUE_LINES)
  .describe(
    'Spoken lines in order. Replaces all lines of the shot; [] clears them. Keep to 3–4 lines per 10 s ' +
      '(5 or more returns a warning). Every speaker needs speechName and voiceDescription (edit_character) ' +
      'before generating takes.',
  )
export type DialogueInput = z.infer<typeof DialogueInput>

/** キャラクターの「セリフの声」。H3 のセリフの文に一字一句そのまま入る。 */
export const SpeechFields = {
  speechName: z
    .string()
    .trim()
    .min(1)
    .max(MAX_SPEECH_NAME_LENGTH)
    .nullable()
    .optional()
    .describe('English name used in dialogue prompts, e.g. "The cat". Identical in every shot. null clears.'),
  voiceDescription: z
    .string()
    .trim()
    .min(1)
    .max(MAX_VOICE_DESCRIPTION_LENGTH)
    .nullable()
    .optional()
    .describe('English voice description, e.g. "a calm, deep, refined elderly gentleman\'s voice". null clears.'),
}

/** API の応答に載る警告（`dialogueWarnings`）。古い API は返さないので省ける。 */
export const WireDialogueWarnings = z.array(z.object({ code: z.string(), message: z.string() })).optional()

/** セリフの話し手の ID（重ねない）。 */
export const speakerIdsOf = (lines: readonly { readonly speakerId: string }[]): readonly string[] => [
  ...new Set(lines.map((line) => line.speakerId)),
]
