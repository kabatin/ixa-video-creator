import type { TakeRepository } from '@ixa/db'
import type { GenerationJob, ShotId, TakeId } from '@ixa/domain'

/**
 * Take の系譜（DOMAIN.md §10）。
 *
 * 再生成で作られた Take は「何の作り直しなのか」を持つ。
 * Take は Immutable（ADR-0003）で、作成後に `parent_take_id` を UPDATE して
 * 後付けすることは許されていない。つまり **Take を作る瞬間に系譜が手元に無ければ、
 * その Take は永久に系譜を持たない。**
 *
 * **系譜の正は `generation_jobs` の行である。**
 * 以前はキューのジョブペイロードにしか無く、行を作る処理とペイロードを積む処理が
 * 別々だったため、その隙間で落とすと親も理由も持たない Take が静かに確定していた。
 * 行に持たせることで、系譜を書く機会が `generationJobs.create` の 1 回だけになる。
 *
 * ここがするのは、行に載っている系譜が**実在の Take を指しているか**の検査だけ。
 * 無ければ推測しない。
 */

/** 行に載っている系譜の 2 列。`GenerationJob` からそのまま渡せる形にしておく。 */
export type RecordedLineage = Pick<GenerationJob, 'parentTakeId' | 'regenerationReason'>

/** 親と理由が揃っている系譜。 */
export type TakeLineage = {
  readonly parentTakeId: TakeId
  readonly regenerationReason: string
}

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

/**
 * 系譜の検査結果。
 * 「載っていない（absent）」「親が消えた（detached）」「壊れている」を別物として扱う。
 */
export type LineageCheck =
  | { readonly state: 'absent' }
  | { readonly state: 'intact'; readonly lineage: TakeLineage }
  /** 親を消したあとの形。理由だけが残る。異常ではない（ON DELETE SET NULL）。 */
  | { readonly state: 'detached'; readonly regenerationReason: string }
  | { readonly state: 'parent_missing'; readonly lineage: TakeLineage }
  | {
      readonly state: 'shot_mismatch'
      readonly lineage: TakeLineage
      readonly parentShotId: ShotId
    }
  /** 親はあるのに理由が無い。系譜を積む側の書き忘れでしか生まれない。 */
  | { readonly state: 'reason_missing'; readonly parentTakeId: TakeId }

/** 系譜が壊れているときの理由。ジョブを failed にするための code と message。 */
export type LineageFailure = {
  readonly code: string
  readonly message: string
}

/**
 * 行に載っている系譜が実在の Take を指しているかを調べる。
 *
 * 別の Shot の Take を親にすると系譜の木が Shot をまたいで壊れるため、
 * 存在するだけでは足りず、同じ Shot のものであることまで確認する。
 */
export const checkLineage = async (
  takes: Pick<TakeRepository, 'findById'>,
  shotId: ShotId,
  recorded: RecordedLineage,
): Promise<LineageCheck> => {
  const { parentTakeId, regenerationReason } = recorded

  if (parentTakeId === null) {
    return regenerationReason === null
      ? { state: 'absent' }
      : { state: 'detached', regenerationReason }
  }
  /**
   * ドメインの `GenerationJob` が親と理由の対を検証しているので、
   * 正しく行を作っていればここには来ない。**来たら積み忘れである。**
   * 型の上では起きうる形なので、握り潰さず状態として返す。
   */
  if (regenerationReason === null) return { state: 'reason_missing', parentTakeId }

  const lineage: TakeLineage = { parentTakeId, regenerationReason }
  const parent = await takes.findById(parentTakeId)
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
    case 'detached':
      return { parentTakeId: null, regenerationReason: check.regenerationReason }
    case 'parent_missing':
    case 'shot_mismatch':
      return { parentTakeId: null, regenerationReason: check.lineage.regenerationReason }
    /**
     * 理由が失われている以上、作り直しても復元できない。
     * せめて親は残す。ここで NO_LINEAGE に畳むと、再生成だったことまで消える。
     */
    case 'reason_missing':
      return { parentTakeId: check.parentTakeId, regenerationReason: null }
  }
}

/** 壊れた系譜なら理由を返す。正常（absent / intact / detached）なら null。 */
export const lineageFailureOf = (check: LineageCheck): LineageFailure | null => {
  switch (check.state) {
    case 'absent':
    case 'intact':
    case 'detached':
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
    case 'reason_missing':
      return {
        code: 'regeneration_reason_missing',
        message:
          `GenerationJob が親だけを持ち regenerationReason がありません: ` +
          `parent=${check.parentTakeId}。系譜は generation_jobs の行に対で積んでください`,
      }
  }
}
