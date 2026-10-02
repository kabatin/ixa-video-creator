import { z } from 'zod'
import {
  CreateStoryboardDraftItemInput as CreateStoryboardDraftItemInputSchema,
  MusicSection,
  Seconds,
  ShotId,
} from '@ixa/domain'
import type { ShotId as ShotIdType } from '@ixa/domain'

/**
 * 絵コンテを一括で下書きさせる口の契約（PHASE 6.3 / P63-4）。
 *
 * **下書きは Shot を書き換えない。** ここが返すのは「別の案」であって、
 * 採否は人が Shot ごとに決める。だから 1 件ずつに `reason`（なぜこの絵か）を必須にしてある。
 * 案だけを 27 件並べても、人はどれを採るか決められない。
 *
 * **失敗は例外ではなく値で返す**（`VisionReviewer` との違いはここだけ）。
 * 呼び出し側は失敗しても `storyboard_draft_runs` に `status='failed'` と
 * `error={code,message}` を必ず書き残す必要があり、その形が
 * `StoryboardDraftRun.error` とそのまま重なる。例外にすると、
 * 呼び出し側が catch して同じ形へ組み直すだけになる。
 */

/** 下書きに渡す既存 Shot 1 件。**並びは既に決まっている**ので、作り直させない。 */
export const StoryboardDraftShot = z.object({
  id: ShotId,
  code: z.string().min(1),
  order: z.number().int(),
  startSec: Seconds,
  durationSec: Seconds,
  /** いまの説明。空文字は「まだ書いていない」。 */
  description: z.string(),
  mood: z.string().nullable(),
  /** その Shot の間に歌い出す歌詞のフレーズ（ADR-0033）。無い・まだ合わせていなければ空。 */
  lyrics: z.array(z.string()).default([]),
})
export type StoryboardDraftShot = z.infer<typeof StoryboardDraftShot>

/**
 * 下書きの依頼。
 *
 * 入力の正は **Script / MusicSection / 既存 Shot の並び**（docs/DOMAIN.md §8-9）。
 * Script も解析も無い Project はあり得るので、両方 null / 空を許す。
 * **Shot だけは 1 件以上必要**で、0 件なら下書きする対象が存在しない。
 */
export const StoryboardDraftRequest = z.object({
  /** 現在の脚本本文（Markdown）。まだ書かれていなければ null。 */
  script: z.string().nullable(),
  /** 曲の構成。解析が無ければ空配列。 */
  sections: z.array(MusicSection),
  shots: z.array(StoryboardDraftShot).min(1),
  /** 作品のルック（`Project.styleGuide`、ADR-0030）。書いていなければ空文字。 */
  look: z.string(),
  /** 作品の避けたいもの（`Project.avoid`、ADR-0030）。書いていなければ空文字。 */
  avoid: z.string(),
  /** 歌詞の全文（`Project.lyrics`、ADR-0033）。時刻をまだ合わせていない行も含む。無ければ空文字。 */
  lyrics: z.string().default(''),
})
export type StoryboardDraftRequest = z.infer<typeof StoryboardDraftRequest>

/**
 * 案 1 件。**ドメインの作成入力をそのまま契約に使う。**
 *
 * 長さの上限（`MAX_DRAFT_DESCRIPTION_LENGTH` / `MAX_DRAFT_REASON_LENGTH`）を
 * ここに書き写さない。写すと必ずズレ、アダプタを通った 401 文字が
 * `addItems` の中で初めて弾かれる。そのときには run は既に `running` になっている。
 */
export const StoryboardDraftedItem = CreateStoryboardDraftItemInputSchema
export type StoryboardDraftedItem = z.infer<typeof StoryboardDraftedItem>

/** LLM に返させる外形。**配列を裸で返させない**（前後に説明文を足されやすい）。 */
export const StoryboardDraftResponse = z.object({
  items: z.array(StoryboardDraftedItem),
})
export type StoryboardDraftResponse = z.infer<typeof StoryboardDraftResponse>

/**
 * 下書きの失敗分類。
 *
 * CLI 由来のコードは `VISION_REVIEWER_ERROR_CODES` と同じ綴りにしてある。
 * 同じ CLI を同じ叩き方で呼んでいるので、別の名前を付ける理由が無い。
 *
 * Shot の取り違えは**この口に固有**なので独立したコードを持つ。
 * 「27 件頼んだのに 18 件しか返らなかった」を成功として扱うと、
 * 残り 9 件が下書きされなかったことに誰も気付かない（lessons L-013）。
 */
export const STORYBOARD_DRAFTER_ERROR_CODES = [
  'cli_not_found',
  'cli_spawn_failed',
  'cli_timeout',
  'cli_exit_failed',
  'response_not_json',
  'response_schema_violation',
  /** 依頼していない Shot の案が混ざっていた。 */
  'unknown_shot_id',
  /** 依頼した Shot の案が足りない。 */
  'missing_shot_id',
  /** 同じ Shot に 2 つの案。DB の一意制約に当たる前に止める。 */
  'duplicate_shot_id',
] as const
export type StoryboardDrafterErrorCode = (typeof STORYBOARD_DRAFTER_ERROR_CODES)[number]

/** `StoryboardDraftRun.error` と同じ形。そのまま保存できるようにしてある。 */
export type StoryboardDraftError = {
  readonly code: StoryboardDrafterErrorCode
  readonly message: string
}

export type StoryboardDraftOutcome =
  | {
      readonly ok: true
      readonly items: readonly StoryboardDraftedItem[]
      /** 実際に支払った額。測れないなら 0（推測値を入れない）。 */
      readonly costUsd: number
    }
  | {
      readonly ok: false
      /**
       * **失敗しても、実際に払った額は連れて来る。**
       * 応答の形が崩れていても CLI は走っており課金は起きている。
       * ここを常に 0 にすると、費用メーター（P63-2）が「何も使っていない」と読める嘘になる。
       * CLI を起動できなかった場合だけが本当の 0。
       */
      readonly costUsd: number
      readonly error: StoryboardDraftError
    }

/**
 * 絵コンテ下書きのアダプタ。実装は `@ixa/provider-llm` 内に閉じる。
 * `name` は `StoryboardDraftRun.drafter` に保存され、**どの口で作った案か**を後から分ける。
 */
export type StoryboardDrafter = {
  readonly name: string
  draft(request: StoryboardDraftRequest): Promise<StoryboardDraftOutcome>
}

/** 一覧をメッセージに出すときの上限。全件並べるとログが読めなくなる。 */
export const MAX_LISTED_SHOT_IDS = 10

const listShotIds = (ids: readonly ShotIdType[]): string =>
  ids.length <= MAX_LISTED_SHOT_IDS
    ? ids.join(', ')
    : `${ids.slice(0, MAX_LISTED_SHOT_IDS).join(', ')} ほか ${String(ids.length - MAX_LISTED_SHOT_IDS)} 件`

/**
 * 返ってきた案が、依頼した Shot と**過不足なく一致する**かを確かめる。
 *
 * 落ちた案を黙って捨てない。捨てると「27 件頼んだのに 18 件しか出ない」が
 * 失敗と区別できなくなる。実装 3 つ（CLI / スタブ / テスト）で同じ判定を使えるよう、
 * 純粋関数としてここに 1 つだけ置く。
 *
 * @returns 問題が無ければ null。
 */
export const checkDraftedShotIds = (
  requested: readonly ShotIdType[],
  drafted: readonly ShotIdType[],
): StoryboardDraftError | null => {
  const seen = new Set<ShotIdType>()
  const duplicated = drafted.filter((id) => {
    if (seen.has(id)) return true
    seen.add(id)
    return false
  })
  if (duplicated.length > 0) {
    return {
      code: 'duplicate_shot_id',
      message: `同じ Shot に 2 つ以上の案が返りました: ${listShotIds(duplicated)}`,
    }
  }

  const requestedSet = new Set<ShotIdType>(requested)
  const unknown = drafted.filter((id) => !requestedSet.has(id))
  if (unknown.length > 0) {
    return {
      code: 'unknown_shot_id',
      message: `依頼していない Shot の案が返りました: ${listShotIds(unknown)}`,
    }
  }

  const missing = requested.filter((id) => !seen.has(id))
  if (missing.length > 0) {
    return {
      code: 'missing_shot_id',
      message: `${String(requested.length)} 件のうち ${String(missing.length)} 件の案が返りませんでした: ${listShotIds(missing)}`,
    }
  }

  return null
}
