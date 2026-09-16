import { GenerationJobId as GenerationJobIdSchema } from '@ixa/domain'
import { z } from 'zod'

/**
 * generation キューのジョブデータ。
 *
 * **ID だけを運ぶ。系譜は載せない。**
 * 系譜の正は `generation_jobs` の行である（packages/db/src/schema/generation.ts）。
 * 以前はここに載せていたが、行を作る処理とペイロードを積む処理が別だったため、
 * その隙間で落とすと親も理由も持たない Take が静かに確定していた。
 * Take は Immutable（ADR-0003）なので後から埋められない。
 *
 * **知らないキーを黙って捨てない（`.strict()`）。**
 * 既定の zod は未知のキーを落とすため、系譜をここへ積むと何事も無く通ってしまう。
 * 積み方の間違いはここで気付く必要がある。
 */
export const GenerationJobData = z
  .object({ generationJobId: GenerationJobIdSchema })
  .strict()
export type GenerationJobData = z.infer<typeof GenerationJobData>

const hasKey = (data: unknown, key: string): boolean =>
  typeof data === 'object' && data !== null && key in data

/**
 * 再生成の要求（`RegenerationRequest`）をそのまま generation キューへ積むと、
 * GenerationJob が作られていないのでここで詰まる。
 * 「generationJobId が必要」という汎用の zod エラーだけでは配線の直し方が分からないため、
 * その形を見つけたら何をすべきかまで書いたエラーにする。
 */
const looksLikeRawRegenerationRequest = (data: unknown): boolean => hasKey(data, 'regeneration')

/** 系譜をペイロードへ積んだ形。旧形式のジョブと、配線の書き間違いの両方がこれになる。 */
const LINEAGE_IN_PAYLOAD_KEYS = ['lineage', 'parentTakeId', 'regenerationReason'] as const

const carriesLineage = (data: unknown): boolean =>
  LINEAGE_IN_PAYLOAD_KEYS.some((key) => hasKey(data, key))

export const parseGenerationJobData = (data: unknown): GenerationJobData => {
  const parsed = GenerationJobData.safeParse(data)
  if (parsed.success) return parsed.data
  if (looksLikeRawRegenerationRequest(data)) {
    throw new Error(
      '再生成の要求がそのまま generation キューへ積まれています。' +
        'GenerationJob を系譜つきで作ったうえで ' +
        '{ generationJobId } の形で積んでください',
    )
  }
  /**
   * **黙って捨てない。**
   * 捨てて通すと、系譜を持っているつもりのジョブが親も理由も無い Take を作って終わる。
   * 旧形式のジョブが Redis に残っている場合もここで落ちるが、
   * 落ちるのは Provider へ投入する前なので課金は発生しない。積み直せばよい。
   */
  if (carriesLineage(data)) {
    throw new Error(
      '系譜がジョブデータに積まれています。系譜の正は generation_jobs の行です。' +
        'generationJobs.create に parentTakeId / regenerationReason を渡し、' +
        'ジョブデータは { generationJobId } だけにしてください',
    )
  }
  throw parsed.error
}
