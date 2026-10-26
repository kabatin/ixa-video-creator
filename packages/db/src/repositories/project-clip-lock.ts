import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import type { ProjectId, TimelineClip } from '@ixa/domain'
import type { DbExecutor } from '../client.js'
import { timelineClips } from '../schema/timeline.js'
import { createTimelineClipRepository, timelineClipRowToDomain, type TimelineClipRepository } from './timeline-clip-repository.js'

/**
 * 作品ごとに 1 本ずつ、クリップを読んで書き直す口（セリフの字幕の作り直し。ADR-0061）。
 *
 * api の口がいくつも並んで（MCP は Shot を 4 本並べて直す）作り直すと、読んだ時点で字幕が無い全員が足して重なる。
 * 読んでから書くまでに人が時刻を直すと、それも古い値で上書きする。**同じ作品の作り直しは 1 本ずつ**にし、
 * 鍵を取った後で今の字幕を読み直してから書く（`pg_advisory_xact_lock`。トランザクションが終われば外れる）。
 */
export type LockedProjectClips = Pick<TimelineClipRepository, 'findByProject' | 'create' | 'update' | 'softDelete' | 'restore'> & {
  /** 論理削除したクリップ（新しく消したものが先）。消した字幕を同じ行が戻ったときに戻す（取り消し）。 */
  findDeletedByProject(projectId: ProjectId): Promise<TimelineClip[]>
}

export type ProjectClipLock = <T>(projectId: ProjectId, fn: (clips: LockedProjectClips) => Promise<T>) => Promise<T>

/** 鍵の名前。ほかの用途の advisory lock とぶつからないよう、用途の接頭辞を付けてから hashtext で数にする。 */
const lockKey = (projectId: ProjectId): string => `dialogue-telops:${projectId}`

export const createProjectClipLock =
  (db: DbExecutor): ProjectClipLock =>
  (projectId, fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey(projectId)}))`)
      return fn({
        ...createTimelineClipRepository(tx),
        async findDeletedByProject(id) {
          const rows = await tx
            .select()
            .from(timelineClips)
            .where(and(eq(timelineClips.projectId, id), isNotNull(timelineClips.deletedAt)))
            .orderBy(desc(timelineClips.deletedAt))
          return rows.map(timelineClipRowToDomain)
        },
      })
    })
