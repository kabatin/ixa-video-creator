import { z } from 'zod'
import {
  ProjectId,
  ShotId,
  StoryboardDraftItemId,
  StoryboardDraftRunId,
} from '../common/ids.js'

/**
 * 絵コンテの下書き（PHASE 6.3）。
 *
 * **下書きは Shot ではない。** 本制作の 68 Shot のうち 28 件は既に Take を採用済みで、
 * 説明が黙って書き換わると、生成済みの Take と食い違ったまま誰も気付かない。
 * 下書きは**別の案として保存し、人が Shot ごとに採否を決める**（制作者の判断 2026-09-18）。
 *
 * 形は `ReviewRun` / `ReviewFinding` に合わせてある。
 * 「1 回の実行」と「対象ごとの結果」という構造が同じなので、別の形にする理由が無い。
 */

export const StoryboardDraftStatus = z.enum(['queued', 'running', 'done', 'failed'])
export type StoryboardDraftStatus = z.infer<typeof StoryboardDraftStatus>

/**
 * 下書きの実行 1 回分。
 *
 * `drafter` は使った口の名前（`claude-cli` / `stub` など）。
 * **どの口で作った案かが分からないと、質の違いを後から切り分けられない。**
 * 費用メーター（P63-2）が出どころを分けるのと同じ理由。
 */
export const StoryboardDraftRun = z.object({
  id: StoryboardDraftRunId,
  projectId: ProjectId,
  drafter: z.string().min(1),
  status: StoryboardDraftStatus,
  costUsd: z.number().nonnegative().default(0),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
  createdAt: z.date(),
})
export type StoryboardDraftRun = z.infer<typeof StoryboardDraftRun>

export const CreateStoryboardDraftRunInput = StoryboardDraftRun.omit({
  id: true,
  createdAt: true,
}).extend({
  status: StoryboardDraftStatus.default('queued'),
  costUsd: z.number().nonnegative().default(0),
  error: StoryboardDraftRun.shape.error.default(null),
})
export type CreateStoryboardDraftRunInput = z.input<typeof CreateStoryboardDraftRunInput>

export const MAX_DRAFT_DESCRIPTION_LENGTH = 400
export const MAX_DRAFT_REASON_LENGTH = 400

/**
 * Shot 1 件ぶんの案。
 *
 * **`reason`（なぜこの絵か）は必須。** 68 件の採否を人が判断するには、
 * 案そのものだけでは足りない。理由の無い案は、読んでも採否を決められない。
 *
 * **案の中身は追記のみ。** 採否は `adoptedAt` に時刻を書くことで記録し、
 * `description` / `mood` / `reason` は作成後に変えない。
 * 書き換えられると「人が見て採用したもの」と「後から変わったもの」の区別が消える
 * （Take と同じ考え方。ADR-0003）。
 */
export const StoryboardDraftItem = z.object({
  id: StoryboardDraftItemId,
  runId: StoryboardDraftRunId,
  shotId: ShotId,
  description: z.string().trim().min(1).max(MAX_DRAFT_DESCRIPTION_LENGTH),
  mood: z.string().trim().min(1).nullable(),
  reason: z.string().trim().min(1).max(MAX_DRAFT_REASON_LENGTH),
  /** 採用した時刻。**`null` は「まだ決めていない」**（「不採用」ではない）。 */
  adoptedAt: z.date().nullable(),
  createdAt: z.date(),
})
export type StoryboardDraftItem = z.infer<typeof StoryboardDraftItem>

export const CreateStoryboardDraftItemInput = StoryboardDraftItem.omit({
  id: true,
  runId: true,
  adoptedAt: true,
  createdAt: true,
})
export type CreateStoryboardDraftItemInput = z.input<typeof CreateStoryboardDraftItemInput>

/**
 * 案のうち作成後に変えてよい列。**`adoptedAt` だけ。**
 * リポジトリ実装はこれを守ること（`TAKE_MUTABLE_FIELDS` と同じ約束）。
 */
export const STORYBOARD_DRAFT_ITEM_MUTABLE_FIELDS = Object.freeze(['adoptedAt'] as const)

/**
 * 採用済みかどうか。
 *
 * **時刻の有無で判断し、真偽値の列を別に持たない。** 2 つ持つと必ずズレ、
 * 「採用済みだが時刻が無い」行が生まれる。
 */
export const isAdopted = (item: StoryboardDraftItem): boolean => item.adoptedAt !== null
