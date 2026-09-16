import { Sequence, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * Sequence（Aメロ / サビ といった楽曲構成のまとまり。DOMAIN.md §8）の呼び出し口。
 * ストーリーボードで Shot の所属先を選ばせるための一覧取得だけを持つ。
 */

/** Sequence には日時列が無いので、ドメインのスキーマをそのまま検証に使う。 */
export const WireSequence = Sequence
export const WireSequenceList = z.array(WireSequence)

export type SequenceApi = {
  listSequences: (projectId: ProjectId) => Promise<Sequence[]>
}

export const createSequenceApi = (requester: Requester): SequenceApi => ({
  listSequences: async (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/sequences`, WireSequenceList),
})
