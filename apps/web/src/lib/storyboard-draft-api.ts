import { ShotCamera, ShotId, StoryboardDraftCamera, StoryboardDraftItemId, StoryboardDraftRunId, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * 絵コンテ下書きの呼び出し口（P63-4）。
 *
 * ```
 * GET  /projects/{projectId}/storyboard/drafts                  最新の下書きを読む
 * POST /projects/{projectId}/storyboard/drafts                  案を作る（Shot は変わらない）
 * POST /projects/{projectId}/storyboard/drafts/{runId}/adopt    採用する Shot を列挙して渡す
 * ```
 *
 * **作るのと採用するのは別の操作。** 作っただけでは Shot は 1 件も変わらない。
 */

export const StoryboardDraftStatus = z.enum(['queued', 'running', 'done', 'failed'])
export type StoryboardDraftStatus = z.infer<typeof StoryboardDraftStatus>

export const WireStoryboardDraftRun = z.object({
  id: StoryboardDraftRunId,
  projectId: z.string().min(1),
  /** どの口で作った案か（`claude-cli-storyboard-drafter` / `stub-storyboard-drafter`）。 */
  drafter: z.string().min(1),
  status: StoryboardDraftStatus,
  costUsd: z.number().nonnegative(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.string().datetime(),
})
export type WireStoryboardDraftRun = z.infer<typeof WireStoryboardDraftRun>

export const WireStoryboardDraftItem = z.object({
  id: StoryboardDraftItemId,
  runId: StoryboardDraftRunId,
  shotId: ShotId,
  description: z.string().min(1),
  mood: z.string().nullable(),
  /** なぜこの絵か。**必須。** これが無いと採否を決められない。 */
  reason: z.string().min(1),
  /**
   * カメラの案（ADR-0043）。**null は「カメラの提案なし」**（採用してもカメラは変わらない）。
   * 値の一覧は domain が持つので、ここで書き写さない。
   */
  camera: StoryboardDraftCamera.nullable().default(null),
  /** **null は「まだ決めていない」。「不採用」ではない**（lessons L-021）。 */
  adoptedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})
export type WireStoryboardDraftItem = z.infer<typeof WireStoryboardDraftItem>

/**
 * 最新の下書き。**`run` の null は「まだ一度も下書きしていない」。**
 * 「案が 0 件」とは違う。混ぜると、押していないのに失敗したように見える。
 */
export const WireStoryboardDraftLatest = z.object({
  run: WireStoryboardDraftRun.nullable(),
  /** `run` が `done` 以外なら空。`run.status` を見ずに「案なし」と読まない。 */
  items: z.array(WireStoryboardDraftItem),
})
export type WireStoryboardDraftLatest = z.infer<typeof WireStoryboardDraftLatest>

export const WireStoryboardDraftResult = z.object({
  run: WireStoryboardDraftRun,
  /** 失敗した run では空。`run.status` を見ずに「案 0 件」と読まない。 */
  items: z.array(WireStoryboardDraftItem),
})
export type WireStoryboardDraftResult = z.infer<typeof WireStoryboardDraftResult>

/** 採用後の Shot。画面が「いまの説明」を描き直すのに必要な分だけ受け取る。 */
export const WireAdoptedShot = z.object({
  id: ShotId,
  code: z.string().min(1),
  description: z.string(),
  mood: z.string().nullable(),
  /**
   * 採用で入ったカメラ（ADR-0043）。**ここで受け取らないと画面に出ない。**
   * 読み込み直せば出るが、押した直後に反映されないと「入っていない」と見える。
   */
  camera: ShotCamera,
})
export type WireAdoptedShot = z.infer<typeof WireAdoptedShot>

export const WireStoryboardAdoptResult = z.object({
  adopted: z.array(WireStoryboardDraftItem),
  shots: z.array(WireAdoptedShot),
})
export type WireStoryboardAdoptResult = z.infer<typeof WireStoryboardAdoptResult>

export type StoryboardDraftApi = {
  /** 最新の下書きを読む。**画面を開き直しても案が残るための口。** */
  getLatestDraft: (projectId: ProjectId) => Promise<WireStoryboardDraftLatest>
  /** 案を作る。**Shot は 1 件も変わらない。** */
  createDraft: (projectId: ProjectId) => Promise<WireStoryboardDraftResult>
  /** 列挙した Shot だけを書き換える。 */
  adopt: (
    projectId: ProjectId,
    runId: WireStoryboardDraftRun['id'],
    shotIds: readonly WireStoryboardDraftItem['shotId'][],
  ) => Promise<WireStoryboardAdoptResult>
}

const draftsPath = (projectId: ProjectId): string =>
  `/projects/${encodeURIComponent(projectId)}/storyboard/drafts`

export const createStoryboardDraftApi = (requester: Requester): StoryboardDraftApi => ({
  getLatestDraft: async (projectId) =>
    requester.get(draftsPath(projectId), WireStoryboardDraftLatest),

  createDraft: async (projectId) =>
    // 本文を取らない POST。`undefined` を渡すと body を送らない（requester の約束）。
    requester.post(draftsPath(projectId), undefined, WireStoryboardDraftResult),

  adopt: async (projectId, runId, shotIds) =>
    requester.post(
      `${draftsPath(projectId)}/${encodeURIComponent(runId)}/adopt`,
      { shotIds: [...shotIds] },
      WireStoryboardAdoptResult,
    ),
})
