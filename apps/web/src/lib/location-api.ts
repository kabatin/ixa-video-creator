import { Location, type ProjectId } from '@ixa/domain'
import { z } from 'zod'
import type { Requester } from '@/lib/requester'

/**
 * Asset Library のロケーション（DOMAIN.md §6）の呼び出し口。
 * Shot に結び付けるための一覧取得だけを持つ。CRUD は API 側の画面が未着手のため足さない。
 */

/** Location には日時列が無いので、ドメインのスキーマをそのまま検証に使う。 */
export const WireLocation = Location
export type WireLocation = z.infer<typeof WireLocation>

export const WireLocationList = z.array(WireLocation)

export type LocationApi = {
  /** プロジェクトのロケーション（ADR-0034）。 */
  listLocations: (projectId: ProjectId) => Promise<Location[]>
}

export const createLocationApi = (requester: Requester): LocationApi => ({
  listLocations: async (projectId) =>
    requester.get(`/projects/${encodeURIComponent(projectId)}/locations`, WireLocationList),
})
