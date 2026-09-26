'use client'

import { useEffect, useRef } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { CUT_EDITOR_SELECTOR } from '@/lib/playback-state'
import { neighborShotId, resolveWorkbenchKey } from '@/lib/workbench-keys'

export type WorkbenchKeysOptions = {
  readonly undo: () => void
}

/**
 * ワークベンチの打鍵を 1 箇所で受ける（UI-WORKBENCH 7.2）。判定は `workbench-keys.ts`。
 * **ダイアログを開いている間は受けない。** 裏の画面を打鍵で動かさない。
 *
 * 「聴きながら切る」へ譲るかは**フォーカスの居場所だけ**で決める。
 * 見えているかで決めていた頃は、既定の配置で常に見えているため Space と ← → が
 * 一度も効かず、狭い画面では逆に 1 打で両方が動いた。`closest` を引くのはここで、
 * `resolveWorkbenchKey` には真偽値だけを渡す（`lib` に DOM を持ち込まない）。
 */
export const useWorkbenchKeys = (options: WorkbenchKeysOptions): void => {
  const workbench = useWorkbench()
  const latest = useRef({ workbench, options })
  latest.current = { workbench, options }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const { workbench: current, options: opts } = latest.current
      if (current.dialog !== null) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const command = resolveWorkbenchKey({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target:
          target === null
            ? null
            : {
                tagName: target.tagName,
                isContentEditable: target.isContentEditable,
                role: target.getAttribute('role'),
              },
        insideCutEditor: target?.closest(CUT_EDITOR_SELECTOR) != null,
      })
      if (command === null) return
      event.preventDefault()
      switch (command) {
        case 'undo':
          opts.undo()
          return
        case 'redo':
          // やり直しはまだ無い。ブラウザの既定の動きもさせない。
          return
        case 'history':
          current.openDialog('history')
          return
        case 'preferences':
          current.openDialog('preferences')
          return
        case 'toggle-play':
          // **鳴っていれば持ち主が誰でも止める。** `toggle('monitor')` だと、裏で
          // カッターが鳴っているときに「止める」ではなく「プレビューを鳴らし始める」に
          // なる。まだ誰も鳴っていないときの持ち主だけを渡す。
          current.transportControls.togglePlayback('monitor')
          return
        case 'delete-shots':
          // すぐには消さない。何を消すかは確認のダイアログが言う（取り消しが無いため）。
          if (current.checked.size > 0 || current.selectedShotId !== null) {
            current.openDialog('delete-shots')
          }
          return
        case 'previous-shot':
        case 'next-shot': {
          const next = neighborShotId(
            current.shots ?? [],
            current.selectedShotId,
            command === 'previous-shot' ? -1 : 1,
          )
          if (next !== null) current.selectShot(next)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}
