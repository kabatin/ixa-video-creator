import { Location, type WorkspaceId } from '@ixa/domain'
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
  listLocations: (workspaceId: WorkspaceId) => Promise<Location[]>
}

export const createLocationApi = (requester: Requester): LocationApi => ({
  listLocations: async (workspaceId) => {
    const query = new URLSearchParams({ workspaceId })
    return requester.get(`/locations?${query.toString()}`, WireLocationList)
  },
})
