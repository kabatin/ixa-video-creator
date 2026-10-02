'use client'

import type { Take, TakeId } from '@ixa/domain'
import { useState } from 'react'
import { TakeComparePanel } from '@/components/take-compare-panel'
import { TakeGrid } from '@/components/take-grid'
import { useShotTakes } from '@/components/workbench/use-shot-takes'
import { useSelectedShot, useTransportState, useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { ShotStatusBadge } from '@/components/shot-status-badge'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { unselectAdoptedTake } from '@/components/workbench/shot-edit-actions'
import { useContextMenuHost, type ContextMenuItem } from '@/components/workbench/ui/context-menu'
import { useContextMenuTrigger } from '@/components/workbench/use-context-menu'
import { toMenuItems } from '@/components/workbench/use-shot-menu'
import { takeMenuEntries, type TakeMenuAction } from '@/lib/context-menus'

/**
 * Take 比較（中央上）。選択中の Shot の A（採用）/ B（候補）を拍の上で並べる（D7: 2 枚まで）。
 * 下段は Take 一覧の横スクロール（旧 Shot 詳細の `take-grid`。UI-WORKBENCH §3.2）。
 *
 * 採用は Provider の一覧へ映す。右の一覧の状態が再読み込みなしで変わる（§10 の縦切り）。
 */
export const ComparePanel = () => {
  const workbench = useWorkbench()
  const transport = useTransportState()
  const shot = useSelectedShot()
  const { takes, error, reload } = useShotTakes(shot, workbench.posterEpoch)
  const [adopting, setAdopting] = useState(false)
  const [adoptError, setAdoptError] = useState<string | null>(null)
  // Take の右クリック（長押し・Shift+F10）とカードの「…」のメニュー: 採用する / 採用を外す / 消す。
  const host = useContextMenuHost()
  const takeMenuItems = (take: Take): readonly ContextMenuItem[] => {
    if (shot === null) return []
    const run: Record<TakeMenuAction, () => void | Promise<void>> = {
      adopt: () => {
        void adopt(take.id)
      },
      unadopt: () => {
        unselectAdoptedTake(workbench, shot, workbench.notify)
      },
      // 失敗は投げる（確認の殻が理由を出す）。消したら一覧を読み直し、Shot の状態を映す。
      hide: async () => {
        const updated = await createApiClient().hideTake(take)
        workbench.replaceShots([updated])
        reload()
        workbench.notify(`${shot.code} の Take ${String(take.index)} を消しました。`)
      },
    }
    return toMenuItems(
      takeMenuEntries({ adopted: shot.selectedTakeId === take.id, index: take.index }),
      run,
    )
  }
  const takeMenu = useContextMenuTrigger<Take>((take, at, origin) => {
    host.open({ label: `Take ${String(take.index)} の操作`, items: takeMenuItems(take), at, origin })
  })

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

  async function adopt(takeId: TakeId): Promise<void> {
    if (shot === null) return
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
            // 同時に鳴らない。聴きながら切ると一緒に鳴ると、曲がずれて二重に聞こえる。
            exclusive={{
              othersPlaying:
                transport.playing && transport.owner !== 'compare',
              onPlayingChange: (playing) => {
                if (playing) workbench.transportControls.play('compare')
                else if (transport.owner === 'compare')
                  workbench.transportControls.pause()
              },
              // 画面の ⏸ や Space で止められたら、ここも止まる。
              commandPlaying:
                transport.owner === 'compare' ? transport.playing : null,
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
              takeContextMenu={takeMenu}
              takeMenuItems={takeMenuItems}
            />
          </section>
        </div>
      )}
    </PanelFrame>
  )
}
