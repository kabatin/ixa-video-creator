'use client'

import type { ShotId, Take, TakeId } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { TakeCompare } from '@/components/take-compare'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WireShotCompare } from '@/lib/take-compare'

/**
 * A/B にどの Take を並べるかを決め、比較の材料を取ってくる殻（P61-2 の配線）。
 *
 * **絵と拍の描画は `TakeCompare` が持つ。** ここは「どれとどれを比べるか」と
 * 「取ってくる」だけを持つ。分けてあるのは、選び方を変えても描画に触らずに済むようにするため。
 *
 * 返る `document` には**署名付き URL が入っている**ので、保存も持ち回しもしない（規約 7）。
 * Take が増えたら取り直す（生成直後に比べたいのが普通なので）。
 */

/** 比較しないことを表す選択肢の値。空文字にすると「未選択」と見分けが付かない。 */
const NO_COMPARISON = 'none'

export type TakeComparePanelProps = {
  readonly shotId: ShotId
  readonly takes: readonly Take[]
  /** 採用中の Take。A の既定値になる。 */
  readonly selectedTakeId: TakeId | null
  /**
   * 並べた Take をその場で採用する口（PHASE 7.1 ワークベンチ）。
   * 渡さなければ採用ボタンを出さない（比較だけの画面）。
   */
  readonly onAdopt?: (takeId: TakeId) => void
  /** 採用の送信中。ボタンを押せなくする。 */
  readonly adopting?: boolean
}

const takeLabel = (take: Take): string => `Take ${String(take.index)}`

export const TakeComparePanel = ({
  shotId,
  takes,
  selectedTakeId,
  onAdopt,
  adopting = false,
}: TakeComparePanelProps) => {
  /**
   * A の既定は採用中の Take。まだ無ければ先頭。
   *
   * **`takes` が変わったら選び直す。** 生成で Take が増えたとき、消えた ID を
   * 掴んだままだとサーバが「見つからない」を返し、原因の分からない失敗に見える。
   */
  const fallbackA = selectedTakeId ?? takes[0]?.id ?? null
  const [takeAId, setTakeAId] = useState<TakeId | null>(fallbackA)
  const [takeBId, setTakeBId] = useState<TakeId | null>(null)
  const [compare, setCompare] = useState<WireShotCompare | null>(null)
  const [error, setError] = useState<string | null>(null)

  const known = (id: TakeId | null): TakeId | null =>
    id !== null && takes.some((take) => take.id === id) ? id : null

  const resolvedA = known(takeAId) ?? fallbackA
  const resolvedB = known(takeBId)

  useEffect(() => {
    if (resolvedA === null) return undefined

    let cancelled = false
    setError(null)

    createApiClient()
      .compareTakes(shotId, resolvedA, resolvedB)
      .then((next) => {
        if (cancelled) return
        setCompare(next)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // 材料が無い状態で古い絵を残すと、直ったのか壊れたのかが分からない。
        setCompare(null)
        setError(`比較の材料を取得できませんでした: ${describeError(cause)}`)
      })

    return () => {
      cancelled = true
    }
  }, [shotId, resolvedA, resolvedB])

  if (takes.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text">
          <span className="text-muted">採用候補 A</span>
          <select
            value={resolvedA ?? ''}
            onChange={(event) => {
              setTakeAId(event.target.value as TakeId)
            }}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-text"
          >
            {takes.map((take) => (
              <option key={take.id} value={take.id}>
                {takeLabel(take)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-text">
          <span className="text-muted">比較 B</span>
          <select
            value={resolvedB ?? NO_COMPARISON}
            onChange={(event) => {
              const next = event.target.value
              setTakeBId(next === NO_COMPARISON ? null : (next as TakeId))
            }}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-text"
          >
            <option value={NO_COMPARISON}>並べない</option>
            {takes
              .filter((take) => take.id !== resolvedA)
              .map((take) => (
                <option key={take.id} value={take.id}>
                  {takeLabel(take)}
                </option>
              ))}
          </select>
        </label>
      </div>

      <TakeCompare compare={compare} error={error} />

      {onAdopt !== undefined && (
        <div className="flex flex-wrap items-center gap-2">
          {[
            { side: 'A', id: resolvedA },
            { side: 'B', id: resolvedB },
          ].map(({ side, id }) =>
            id === null ? null : (
              <Button
                key={side}
                size="sm"
                tone={side === 'B' ? 'primary' : 'secondary'}
                // 採用中の Take をもう一度採用しても何も変わらない。押せるように見せない。
                disabled={adopting || id === selectedTakeId}
                onClick={() => {
                  onAdopt(id)
                }}
              >
                {id === selectedTakeId ? `${side} は採用中` : `${side} を採用`}
              </Button>
            ),
          )}
        </div>
      )}
    </section>
  )
}
