import { countActiveJobs, type ActiveJobCounts, type ActiveJobs } from '@ixa/db'
import { dbErrorReason, isUnreachable } from '../lib/db-error.js'
import { isBlank, type EnvValues } from '../lib/env-file.js'
import type { System } from '../system.js'
import type { StepResult } from '../types.js'
import { staleJobsNotice } from './decide.js'

/**
 * 動いているジョブを数えた結果（ADR-0063）。**数えられなかったときに黙って 0 件にしない。**
 * 0 件とみなすのは「DB が動いていない（つながらない・時間切れ）」ときだけ（worker も動けない）。
 */
export type JobsCheck =
  | { readonly kind: 'counted'; readonly jobs: ActiveJobs }
  | { readonly kind: 'not-running'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string }

export const checkActiveJobs = async (system: System, env: EnvValues): Promise<JobsCheck> => {
  if (isBlank(env, 'DATABASE_URL')) return { kind: 'not-running', reason: '.env に DATABASE_URL がありません' }
  try {
    return { kind: 'counted', jobs: await system.withDb(env['DATABASE_URL'] ?? '', (db) => countActiveJobs(db)) }
  } catch (error) {
    return isUnreachable(error)
      ? { kind: 'not-running', reason: 'DB につながりません（動いていないので worker も動けない）' }
      : { kind: 'error', reason: dbErrorReason(error) }
  }
}

export type JobsGuard = {
  /** 止める条件に渡す件数。数えていなければ null。 */
  readonly counts: ActiveJobCounts | null
  /** 数えなかった理由（JSON の activeJobsReason）。 */
  readonly reason: string | null
  /** 知らせる手順（取り残し・数えなかった）と、止める手順（数えられなかった）。 */
  readonly steps: readonly StepResult[]
}

/** 数えた結果を、止める条件と知らせる手順にする（純粋）。`--force` はジョブの確認を丸ごと外す。 */
export const jobsGuard = (check: JobsCheck, force: boolean): JobsGuard => {
  switch (check.kind) {
    case 'counted': {
      const stale = staleJobsNotice(check.jobs.stale)
      return { counts: check.jobs.counts, reason: null, steps: stale === null ? [] : [stale] }
    }
    case 'not-running':
      return {
        counts: null,
        reason: check.reason,
        steps: [{ id: 'update.active-jobs', status: 'notice', message: `動いているジョブは無いとみなします（${check.reason}）` }],
      }
    case 'error':
      return {
        counts: null,
        reason: check.reason,
        steps: [
          force
            ? { id: 'update.active-jobs', status: 'notice', message: `動いているジョブを数えられませんでした（${check.reason}）。--force なので確かめずに進めます` }
            : {
                id: 'update.active-jobs',
                status: 'failed',
                message: `動いているジョブを数えられません（${check.reason}）。数えずに更新すると、作っている途中のものが止まるかもしれません`,
                fix: {
                  hint: 'DB の状態を doctor で見る。確かめずに進めてよければ --force（制作者に確かめる）',
                  command: 'pnpm -s ixa doctor',
                  needsHuman: true,
                },
                docs: 'INSTALL.md#更新',
              },
        ],
      }
  }
}
