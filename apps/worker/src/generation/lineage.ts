import type { TakeRepository } from '@ixa/db'
import { TakeId as TakeIdSchema, type ShotId, type TakeId } from '@ixa/domain'
import { z } from 'zod'

/**
 * Take の系譜（DOMAIN.md §10）。
 *
 * 再生成で作られた Take は「何の作り直しなのか」を持つ。
 * 記録できるのは生成ジョブを処理するこの経路だけなので、ここで取りこぼすと
 * 後から埋めることができない。Take は Immutable（ADR-0003）で、
 * 作成後に parent_take_id を UPDATE して後付けすることは許されていない。
 *
 * そのため **運ばれてきたものだけを書き、無ければ推測しない**。
 * 中途半端な形（親だけ / 理由だけ / 空の理由）は受け付けずに落とす。
 * 黙って null を書くと「最初の生成」と「系譜を失った再生成」が区別できなくなる（L-015）。
 */

/** regenerationReason は DB では text 列だが、無制限に長い文字列を積まない。 */
export const MAX_REGENERATION_REASON_LENGTH = 400

/**
 * 生成ジョブのデータに乗せる系譜。
 * 親と理由は必ず対で運ぶ。片方だけのデータは zod が弾く。
 */
export const TakeLineage = z.object({
  parentTakeId: TakeIdSchema,
  regenerationReason: z.string().min(1).max(MAX_REGENERATION_REASON_LENGTH),
})
export type TakeLineage = z.infer<typeof TakeLineage>

/** Take に実際に書く 2 列。通常の生成では両方 null。 */
export type TakeLineageFields = {
  readonly parentTakeId: TakeId | null
  readonly regenerationReason: string | null
}

/**
 * 再生成ではないことを表す値。
 * `recordTake` の入力で系譜を必須にしているため、通常の生成でもこれを明示して渡す。
 * 省略を許すと「書き忘れ」と「再生成でない」が型の上で同じになる。
 */
export const NO_LINEAGE: TakeLineageFields = Object.freeze({
  parentTakeId: null,
  regenerationReason: null,
})

/** 系譜の検査結果。運ばれてこなかった（absent）と、壊れていたは別物として扱う。 */
export type LineageCheck =
  | { readonly state: 'absent' }
  | { readonly state: 'intact'; readonly lineage: TakeLineage }
  | { readonly state: 'parent_missing'; readonly lineage: TakeLineage }
  | {
      readonly state: 'shot_mismatch'
      readonly lineage: TakeLineage
      readonly parentShotId: ShotId
    }

/** 系譜が壊れているときの理由。ジョブを failed にするための code と message。 */
export type LineageFailure = {
  readonly code: string
  readonly message: string
}

/**
 * 運ばれてきた系譜が実在の Take を指しているかを調べる。
 *
 * 別の Shot の Take を親にすると系譜の木が Shot をまたいで壊れるため、
 * 存在するだけでは足りず、同じ Shot のものであることまで確認する。
 */
export const checkLineage = async (
  takes: Pick<TakeRepository, 'findById'>,
  shotId: ShotId,
  lineage: TakeLineage | undefined,
): Promise<LineageCheck> => {
  if (lineage === undefined) return { state: 'absent' }

  const parent = await takes.findById(lineage.parentTakeId)
  if (parent === null) return { state: 'parent_missing', lineage }
  if (parent.shotId !== shotId) {
    return { state: 'shot_mismatch', lineage, parentShotId: parent.shotId }
  }
  return { state: 'intact', lineage }
}

/**
 * 検査結果を Take に書く 2 列へ畳む。
 *
 * 親を辿れないときも **理由は残す**。DB の `parent_take_id` は
 * `ON DELETE SET NULL`（packages/db/src/schema/generation.ts）なので、
 * 親を消した Take は「理由はあるが親が無い」形になる。
 * 親を失った再生成をこれと同じ形に揃えることで、読む側の解釈が 1 つで済む。
 *
 * ここで理由まで null にすると、再生成だったという事実そのものが消える。
 */
export const lineageFieldsOf = (check: LineageCheck): TakeLineageFields => {
  switch (check.state) {
    case 'absent':
      return NO_LINEAGE
    case 'intact':
      return {
        parentTakeId: check.lineage.parentTakeId,
        regenerationReason: check.lineage.regenerationReason,
      }
    case 'parent_missing':
    case 'shot_mismatch':
      return { parentTakeId: null, regenerationReason: check.lineage.regenerationReason }
  }
}

/** 壊れた系譜なら理由を返す。正常（absent / intact）なら null。 */
export const lineageFailureOf = (check: LineageCheck): LineageFailure | null => {
  switch (check.state) {
    case 'absent':
    case 'intact':
      return null
    case 'parent_missing':
      return {
        code: 'parent_take_missing',
        message: `再生成元の Take がありません: ${check.lineage.parentTakeId}`,
      }
    case 'shot_mismatch':
      return {
        code: 'parent_take_shot_mismatch',
        message:
          `再生成元の Take が別の Shot のものです: ` +
          `parent=${check.lineage.parentTakeId} parentShot=${check.parentShotId}`,
      }
  }
}
