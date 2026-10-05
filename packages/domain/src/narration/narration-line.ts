import { z } from 'zod'
import { NarrationLineId, NarrationTakeId, ProjectId, VoiceProfileId } from '../common/ids.js'
import { Seconds } from '../common/time.js'
import { applyReadings, type AppliedReading, type ReadingEntry } from './reading.js'

/**
 * ナレーション・セリフの原稿の 1 行（ADR-0038）。1 行 = 1 フレーズ = 1 回の声の生成。
 *
 * - **表示**はテロップに出す字、**読み**は声の AI に渡す字（空なら読み辞書から作る）
 * - 行が自分の位置（秒）を持つ。タイムラインのナレーションのレーンは行の投影
 * - 選んだ Take（声）を指す。Take は追記のみ
 */

/** 1 行の表示の上限。テロップは句読点で分けて出すので、テロップ 1 枚の上限より長くてよい。 */
export const NARRATION_TEXT_MAX = 200
export const NARRATION_READING_MAX = 400
export const NARRATION_DIRECTION_MAX = 200

const fields = {
  projectId: ProjectId,
  /** 並び順（0 から）。 */
  order: z.number().int().nonnegative(),
  /** 表示（テロップに出す字）。 */
  text: z.string().trim().min(1).max(NARRATION_TEXT_MAX),
  /** 読み（声の AI に渡す字）。null なら読み辞書から作る。 */
  reading: z.string().trim().min(1).max(NARRATION_READING_MAX).nullable(),
  /** 話す声。null はまだ決めていない。 */
  voiceProfileId: VoiceProfileId.nullable(),
  /** この行だけの演出（例: 囁くように）。 */
  direction: z.string().max(NARRATION_DIRECTION_MAX),
  /** タイムラインでの位置（秒）。null はまだ置いていない。 */
  startSec: Seconds.nullable(),
  /** テロップを付けるか。手でテロップを消した行は false にして、付け直さない。 */
  telop: z.boolean(),
}

export const NarrationLine = z.object({
  id: NarrationLineId,
  ...fields,
  selectedTakeId: NarrationTakeId.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type NarrationLine = z.infer<typeof NarrationLine>

export const CreateNarrationLineInput = z.object({
  ...fields,
  reading: fields.reading.default(null),
  voiceProfileId: fields.voiceProfileId.default(null),
  direction: fields.direction.default(''),
  startSec: fields.startSec.default(null),
  telop: fields.telop.default(true),
})
export type CreateNarrationLineInput = z.input<typeof CreateNarrationLineInput>

export const UpdateNarrationLinePatch = z
  .object({ ...fields, selectedTakeId: NarrationTakeId.nullable() })
  .omit({ projectId: true })
  .partial()
export type UpdateNarrationLinePatch = z.infer<typeof UpdateNarrationLinePatch>

/**
 * 行の読み。手で入れた読みがあればそれを使う（行全体を 1 つの置き換えとして持つ。字の時刻は行全体で按分する）。
 * 無ければ読み辞書から作る。
 */
export const lineReading = (
  line: Pick<NarrationLine, 'text' | 'reading'>,
  dictionary: readonly ReadingEntry[],
): AppliedReading => {
  if (line.reading === null) return applyReadings(line.text, dictionary)
  return {
    display: line.text,
    reading: line.reading,
    spans: [
      {
        display: { start: 0, end: [...line.text].length },
        reading: { start: 0, end: [...line.reading].length },
        replaced: true,
      },
    ],
  }
}
