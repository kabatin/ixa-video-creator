'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { PromptViewer } from '@/components/prompt/prompt-viewer'
import type { PromptReuse, PromptView } from '@/lib/prompt-view'

/**
 * プロンプトビューアを 1 つだけ置き、どこからでも `usePromptViewer().open(view)` で開けるようにする。
 * ボタンの無い入口（素材ツリーの右クリック）もこれで開く。
 * Provider の外では null を返す。`PromptButton` はそのとき自分でビューアを持つ（作業画面の外でも開ける）。
 */

export type PromptViewerApi = { readonly open: (view: PromptView) => void }

const PromptViewerContext = createContext<PromptViewerApi | null>(null)

export const usePromptViewer = (): PromptViewerApi | null => useContext(PromptViewerContext)

export const PromptViewerProvider = ({
  onReuse,
  children,
}: {
  /** 「これを元に作る」で作成画面を開く口。渡さなければ出さない。押したらビューアは閉じる。 */
  readonly onReuse?: (reuse: PromptReuse) => void
  readonly children: ReactNode
}) => {
  const [view, setView] = useState<PromptView | null>(null)
  const api = useMemo<PromptViewerApi>(() => ({ open: setView }), [])
  const close = useCallback(() => {
    setView(null)
  }, [])
  const reuse = useMemo(
    () =>
      onReuse === undefined
        ? undefined
        : (next: PromptReuse) => {
            setView(null)
            onReuse(next)
          },
    [onReuse],
  )
  return (
    <PromptViewerContext.Provider value={api}>
      {children}
      <PromptViewer view={view} onClose={close} {...(reuse === undefined ? {} : { onReuse: reuse })} />
    </PromptViewerContext.Provider>
  )
}
