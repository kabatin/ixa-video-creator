import { z } from 'zod'

/**
 * 作品一覧の 1 行に添える「どこまで進んだか・最後にいつ触ったか」。**保存しない**（一覧を引くたびに数える）。
 *
 * - `lastActivityAt`: 作品の欄の直し・編集の記録・Take・書き出しのうち一番新しい時刻
 * - `shotCount`: 生きている Shot の数（消した Shot は数えない）
 * - `adoptedTakeCount`: そのうち Take を採用している Shot の数
 * - `hasRender`: 書き出しが 1 回でも最後まで終わったか
 *
 * 採用した Shot は生きている Shot の一部なので、`adoptedTakeCount` は `shotCount` を超えない（数え方がそう決まっている）。
 */
export const ProjectActivity = z
  .object({
    lastActivityAt: z.date(),
    shotCount: z.number().int().nonnegative(),
    adoptedTakeCount: z.number().int().nonnegative(),
    hasRender: z.boolean(),
  })
  .refine((activity) => activity.adoptedTakeCount <= activity.shotCount, {
    message: '採用した Shot の数が Shot の数を超えています',
    path: ['adoptedTakeCount'],
  })
export type ProjectActivity = z.infer<typeof ProjectActivity>
