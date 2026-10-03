import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * 書き出す前の確認（タイムラインの検査）を **1 行で**出す。明細は「詳しく見る」で開く。
 *
 * 以前は警告だけ（書き出せる）でも赤い枠で「タイムラインに指摘があります」と出て、書き出せるのかが分からなかった。
 * 状態は 4 つで、混ぜない（L-015）。**未確認を「問題なし」に見せない。**
 */

export type RenderCheck = {
  /** 書き出しを止める指摘の件数。null は確認できていない。 */
  readonly errors: number | null
  /** 警告（書き出せる）の件数。null は確認できていない。 */
  readonly warnings: number | null
}

type CheckState = 'unchecked' | 'blocked' | 'warned' | 'clean'

const stateOf = ({ errors, warnings }: RenderCheck): CheckState =>
  errors === null || warnings === null ? 'unchecked' : errors > 0 ? 'blocked' : warnings > 0 ? 'warned' : 'clean'

const VIEW: Readonly<Record<CheckState, { readonly mark: string; readonly tone: string }>> = {
  clean: { mark: '✓', tone: 'border-ok/40 bg-ok/10 text-ok' },
  warned: { mark: '!', tone: 'border-warn/40 bg-warn/10 text-warn' },
  blocked: { mark: '✕', tone: 'border-danger/40 bg-danger/10 text-danger' },
  unchecked: { mark: '?', tone: 'border-warn/40 bg-warn/10 text-warn' },
}

const messageOf = (state: CheckState, check: RenderCheck): string => {
  switch (state) {
    case 'clean':
      return '問題はありません'
    case 'warned':
      return `警告 ${String(check.warnings ?? 0)} 件。書き出せますが、絵が欠けるかもしれません`
    case 'blocked':
      return `書き出せない指摘が ${String(check.errors ?? 0)} 件あります。タイムラインで直してください`
    case 'unchecked':
      return '確認できていません。書き出すときにもう一度確かめます'
  }
}

export const RenderCheckSummary = ({
  check,
  details,
  onFixTimeline,
}: {
  readonly check: RenderCheck
  /** 指摘の明細（「詳しく見る」で開く）。 */
  readonly details: ReactNode
  /** 「タイムラインで直す」。無ければボタンを出さない。 */
  readonly onFixTimeline?: () => void
}) => {
  const state = stateOf(check)
  const view = VIEW[state]
  return (
    <section aria-label="書き出す前の確認" className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted">書き出す前の確認</h3>
      <p
        role={state === 'blocked' ? 'alert' : 'status'}
        className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${view.tone}`}
      >
        <span aria-hidden="true" className="font-semibold">
          {view.mark}
        </span>
        <span>{messageOf(state, check)}</span>
      </p>
      {state !== 'clean' && (
        <div className="flex flex-wrap items-start gap-2">
          <details className="min-w-0 flex-1 text-sm">
            <summary className="cursor-pointer py-1.5 text-xs text-muted hover:text-text">詳しく見る</summary>
            <div className="mt-2">{details}</div>
          </details>
          {onFixTimeline !== undefined && state !== 'unchecked' && (
            <Button size="sm" onClick={onFixTimeline}>
              タイムラインで直す
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
