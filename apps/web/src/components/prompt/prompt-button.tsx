'use client'

import { useState } from 'react'
import { PromptViewer } from '@/components/prompt/prompt-viewer'
import { usePromptViewer } from '@/components/prompt/prompt-viewer-provider'
import type { PromptView } from '@/lib/prompt-view'

/**
 * 「プロンプト」ボタン（制作者 2026-10-25）。**プロンプトで作ったものの横に置くボタンはこれだけ。**
 * 見た目と文字はここでだけ決める（どこでも同じ形にして、プロンプトがある場所にすぐ気づけるように）。
 * 記録が無いもの（`view` が null）には何も描かない。
 */

const PromptIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M3 2.5h7l3 3v8H3z" strokeLinejoin="round" />
    <path d="M5.5 7.5h5M5.5 10h5" strokeLinecap="round" />
  </svg>
)

export const PROMPT_BUTTON_LABEL = 'プロンプト'

export const PromptButton = ({ view }: { readonly view: PromptView | null }) => {
  const shared = usePromptViewer()
  // 共通のビューアが無い所（作業画面の外）では、自分で 1 つ持つ。
  const [ownView, setOwnView] = useState<PromptView | null>(null)
  if (view === null) return null
  return (
    <>
      <button
        type="button"
        title={`${view.title}のプロンプトを見る`}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-line px-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        onClick={(event) => {
          // カードを押したこと（選ぶ・拡大する）にしない。
          event.stopPropagation()
          if (shared === null) setOwnView(view)
          else shared.open(view)
        }}
      >
        <PromptIcon />
        {PROMPT_BUTTON_LABEL}
      </button>
      {shared === null && (
        <PromptViewer
          view={ownView}
          onClose={() => {
            setOwnView(null)
          }}
        />
      )}
    </>
  )
}
