'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import { copyText } from '@/lib/copy-text'
import { promptViewCopyText, type PromptReuse, type PromptView } from '@/lib/prompt-view'

/**
 * プロンプトビューア（制作者 2026-10-25）。生成物を作ったときに AI へ送った文を、そのまま出す共通のポップアップ。
 * 開くのは `PromptButton`（どこでも同じボタン）と、素材ツリーの右クリック「プロンプトを見る」。
 * 殻はワークベンチのダイアログ（medium）。コピーはすべて `copyText` を通す。
 */

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const COPIED = 'コピーしました'

export type PromptViewerProps = {
  /** 出す中身。null なら閉じている。 */
  readonly view: PromptView | null
  readonly onClose: () => void
  /** 「これを元に作る」。渡さなければ（作業画面の外）出さない。 */
  readonly onReuse?: (reuse: PromptReuse) => void
}

export const PromptViewer = ({ view, onClose, onReuse }: PromptViewerProps) => (
  <WorkbenchDialog open={view !== null} title="プロンプト" size="medium" onClose={onClose}>
    {view !== null && <PromptViewerBody view={view} onReuse={onReuse} />}
  </WorkbenchDialog>
)

const PromptViewerBody = ({
  view,
  onReuse,
}: {
  readonly view: PromptView
  readonly onReuse: PromptViewerProps['onReuse']
}) => {
  /** 最後に押したコピーの結果（どの欄か・言うこと）。 */
  const [copied, setCopied] = useState<{ readonly key: string; readonly message: string } | null>(null)

  const copy = (key: string, text: string): void => {
    copyText(text)
      .then(() => {
        setCopied({ key, message: COPIED })
      })
      .catch((error: unknown) => {
        setCopied({ key, message: error instanceof Error ? error.message : String(error) })
      })
  }

  const meta = [
    view.tool === null ? null : `使った AI: ${view.tool}`,
    view.createdAt === null ? null : `作った日時: ${dateFormatter.format(view.createdAt)}`,
  ].filter((part): part is string => part !== null)
  const reuse = view.reuse

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-base font-semibold text-text">{view.title}</h3>
        {meta.length > 0 && <p className="text-xs text-muted">{meta.join('・')}</p>}
      </header>
      {view.note !== undefined && <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-sm text-warn">{view.note}</p>}
      {view.sections.map((section, index) => {
        const key = `section-${String(index)}`
        return (
          <section key={key} className="space-y-1" aria-label={section.label}>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-text">{section.label}</h4>
              <Button
                size="sm"
                onClick={() => {
                  copy(key, section.text)
                }}
              >
                コピー
              </Button>
              {copied?.key === key && <span role="status" className="text-xs text-muted">{copied.message}</span>}
            </div>
            <pre
              className={`relative max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-surface-2 p-2 text-sm text-text ${
                section.mono ? 'font-mono' : ''
              }`}
            >
              {section.text}
            </pre>
          </section>
        )
      })}
      {view.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {view.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-muted">{fact.label}</dt>
              <dd className="text-text">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <footer className="flex flex-wrap items-center justify-end gap-2">
        {copied?.key === 'all' && <span role="status" className="text-xs text-muted">{copied.message}</span>}
        {view.sections.length > 0 && (
          <Button
            size="sm"
            onClick={() => {
              copy('all', promptViewCopyText(view))
            }}
          >
            全部コピー
          </Button>
        )}
        {reuse !== undefined && onReuse !== undefined && (
          <Button
            size="sm"
            tone="primary"
            onClick={() => {
              onReuse(reuse)
            }}
          >
            これを元に作る
          </Button>
        )}
      </footer>
    </div>
  )
}
