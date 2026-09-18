import type { ShotId, TakeId } from '@ixa/domain'
import type { Requester } from '@/lib/requester'
import { WireShotCompare } from '@/lib/take-compare'

/**
 * Take の A/B 比較を引く呼び出し口（P61-2）。
 *
 * 返る `document` には**署名付き URL が入っている**ので、state の外へ出さない
 * （規約 7。`localStorage` にも入れない）。期限が切れたら引き直す。
 */

export type ShotCompareApi = {
  /** `b` を省くと A だけが返る。理由は `reason` に符号で入る。 */
  compareTakes: (shotId: ShotId, a: TakeId, b?: TakeId | null) => Promise<WireShotCompare>
}

export const createShotCompareApi = (requester: Requester): ShotCompareApi => ({
  compareTakes: async (shotId, a, b) => {
    const query = new URLSearchParams({ a })
    // **`b` が無いことと、`b` が空文字であることを混ぜない。** 空を送るとサーバ側で
    // 「見つからない Take」に化け、「選んでいない」という正常な状態が失敗に見える（L-015）。
    if (b !== undefined && b !== null) query.set('b', b)
    return requester.get(
      `/shots/${encodeURIComponent(shotId)}/compare?${query.toString()}`,
      WireShotCompare,
    )
  },
})
