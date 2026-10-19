'use client'

import { useState } from 'react'
import { HistoryDialogBody } from '@/components/workbench/dialogs/history-dialog'
import { PanelFrame } from '@/components/workbench/panels/panel-frame'
import { useWorkbench } from '@/components/workbench/workbench-context'

/**
 * 変更履歴（下の区画）。中身は ⌘Y のダイアログと同じ部品（ダイアログも残す）。
 *
 * **表に出ているときだけ取り直す**（レビュー 2026-10-19）。裏のタブも mount されたままなので、
 * 作品を読み直すたびに見えない一覧が履歴を取りに行っていた。
 * 裏にいる間に読み直しがあったら、表に出たときに取り直す。⌘Z やダイアログで戻したあと、
 * このタブだけ古い一覧のまま「戻す」を押せる状態にしない。
 */
export const HistoryPanel = ({ visible }: { readonly visible: boolean }) => {
  const { serverEpoch } = useWorkbench()
  /** 最後に表で見た読み直しの番号。一度も表に出ていなければ null（まだ取らない）。 */
  const [shownEpoch, setShownEpoch] = useState<number | null>(visible ? serverEpoch : null)
  // 描くときに合わせる（effect で写すと、表に出た直後に古い一覧を 1 度取ってしまう）。
  if (visible && shownEpoch !== serverEpoch) setShownEpoch(serverEpoch)

  return (
    <PanelFrame>
      {shownEpoch !== null && <HistoryDialogBody key={shownEpoch} onUndone={() => undefined} />}
    </PanelFrame>
  )
}
