'use client'

import { useEffect, useRef } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { neighborShotId, resolveWorkbenchKey } from '@/lib/workbench-keys'

export type WorkbenchKeysOptions = {
  readonly undo: () => void
  /** 聴きながら切るが見えているか。見えている間は Space と ← → をそちらに任せる。 */
  readonly cutterActive: () => boolean
}

/**
 * ワークベンチの打鍵を 1 箇所で受ける（UI-WORKBENCH 7.2）。判定は `workbench-keys.ts`。
 * **ダイアログを開いている間は受けない。** 裏の画面を打鍵で動かさない。
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
        cutterActive: opts.cutterActive(),
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
          current.transportControls.toggle('monitor')
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
