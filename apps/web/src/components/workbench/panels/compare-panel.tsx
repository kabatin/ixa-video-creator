'use client'

import type { TakeId } from '@ixa/domain'
import { useState } from 'react'
import { TakeComparePanel } from '@/components/take-compare-panel'
import { TakeGrid } from '@/components/take-grid'
import { useShotTakes } from '@/components/workbench/use-shot-takes'
import { useSelectedShot, useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'

/**
 * Take 比較（中央上）。選択中の Shot の A（採用）/ B（候補）を拍の上で並べる（D7: 2 枚まで）。
 * 下段は Take 一覧の横スクロール（旧 Shot 詳細の `take-grid`。UI-WORKBENCH §3.2）。
 *
 * 採用は Provider の一覧へ映す。右の一覧の状態が再読み込みなしで変わる（§10 の縦切り）。
 */
export const ComparePanel = () => {
  const workbench = useWorkbench()
  const shot = useSelectedShot()
  const { takes, error, reload } = useShotTakes(shot, workbench.posterEpoch)
  const [adopting, setAdopting] = useState(false)
  const [adoptError, setAdoptError] = useState<string | null>(null)

  if (shot === null) {
    return (
      <PanelFrame>
        <PanelEmpty
          title="Shot を選んでください"
          hint="ストーリーボードか右の一覧で選ぶと、ここに Take が並びます。"
        />
      </PanelFrame>
    )
  }

  const adopt = async (takeId: TakeId): Promise<void> => {
    setAdopting(true)
    setAdoptError(null)
    try {
      const updated = await createApiClient().selectTake(shot.id, takeId)
      workbench.replaceShots([updated])
      // 採用 Take が変わればサムネイルとタイムライン文書も変わる。サーバから読み直す。
      workbench.refresh()
    } catch (cause) {
      setAdoptError(`Take を採用できませんでした: ${describeError(cause)}`)
    } finally {
      setAdopting(false)
    }
  }

  return (
    <PanelFrame
      toolbar={
        <>
          <strong className="text-text">{shot.code}</strong>
          <ShotStatusBadge status={shot.status} />
          <span className="ml-auto" />
          <Button size="sm" onClick={reload}>
            再読み込み
          </Button>
        </>
      }
    >
      {error !== null && <PanelNotice tone="danger">{error}</PanelNotice>}
      {adoptError !== null && <PanelNotice tone="danger">{adoptError}</PanelNotice>}
      {takes === null ? (
        error === null && <p className="text-sm text-muted">Take を読み込んでいます…</p>
      ) : (
        <div
          /*
            **高さを押し付けない。** `h-full` にすると、中身（比較 2 枚 + 拍の帯 + Take 一覧で
            679px）が入れ物（341px）に収まらず、中の帯が自分の枠からはみ出して
            「Take 一覧」の見出しに重なっていた（実測）。
            並べる絵は幅から高さが決まる（`fit="width"`）ので、縦は中身なりでよい。
            入り切らないぶんはパネル本文が従来どおりスクロールで見せる。
          */
          className="flex flex-col gap-3"
        >
          <TakeComparePanel
            // Shot が変わったら A/B の選び直しをさせる（前の Shot の Take を掴んだままにしない）。
            key={shot.id}
            shotId={shot.id}
            takes={takes}
            selectedTakeId={shot.selectedTakeId}
            adopting={adopting}
            onAdopt={(takeId) => {
              void adopt(takeId)
            }}
          />
          <section aria-label="Take 一覧" className="shrink-0">
            <h3 className="mb-1 text-sm font-semibold text-muted">Take 一覧</h3>
            <TakeGrid
              takes={takes}
              selectedTakeId={shot.selectedTakeId}
              busy={adopting}
              onSelect={(takeId) => {
                void adopt(takeId)
              }}
            />
          </section>
        </div>
      )}
    </PanelFrame>
  )
}
