import type { ReactNode } from 'react'

export type PanelFrameProps = {
  /** パネル内ツールバー（既定 2rem、入り切らなければ折り返して伸びる）。無ければ出さない。 */
  readonly toolbar?: ReactNode
  /** 本文の余白を持たない（表や帯のように端まで使うもの）。 */
  readonly flush?: boolean
  readonly children: ReactNode
}

/**
 * ワークベンチのパネルの殻（UI-WORKBENCH §5.2）。
 * 本文の余白は `.workbench-panel-body` が環境設定の「画面の密度」で決める（p-2 / p-3）。
 * 本文は自前でスクロールする。ドックの区画からははみ出さない。
 *
 * ツールバーは**横スクロールさせない**。以前は `h-8` 固定 + `overflow-x-auto` だったので、
 * 絞り込みが増えたパネル（Shot 一覧）では帯の中に横スクロールバーが出ていた。
 * 帯の中のスクロールは見つけにくく、狭いほど押す的も小さくなる。
 * 入り切らなければ折り返して、帯のほうが伸びる。
 */
export const PanelFrame = ({ toolbar, flush = false, children }: PanelFrameProps) => (
  <div className="flex h-full flex-col bg-bg text-text">
    {toolbar !== undefined && (
      <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-2 py-1 text-sm">
        {toolbar}
      </div>
    )}
    <div
      // 中の部品が「このパネルにどれだけ高さがあるか」を測る足がかり（`cut-editor` の波形）。
      data-panel-body=""
      className={`min-h-0 flex-1 overflow-auto ${flush ? '' : 'workbench-panel-body'}`}
    >
      {children}
    </div>
  </div>
)

export type PanelNoticeProps = {
  readonly tone: 'info' | 'warn' | 'danger'
  readonly children: ReactNode
}

const NOTICE_TONES: Readonly<Record<PanelNoticeProps['tone'], string>> = {
  info: 'border-info/40 bg-info/10 text-info',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  danger: 'border-danger/40 bg-danger/10 text-danger',
}

/** パネルの中の知らせ。危ないもの（danger / warn）は alert にする。 */
export const PanelNotice = ({ tone, children }: PanelNoticeProps) => (
  <div
    role={tone === 'info' ? 'status' : 'alert'}
    className={`mb-2 flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-sm ${NOTICE_TONES[tone]}`}
  >
    {children}
  </div>
)

export type PanelEmptyProps = {
  readonly title: string
  readonly hint?: string
  readonly children?: ReactNode
}

/**
 * 空状態の案内（UI-WORKBENCH 7.4）。**ページを占有せず、パネルの中で次の一手を出す。**
 * 以前は `ErrorPanel` / `AnalysisStarter` がページ全体を塞いでいた。
 */
export const PanelEmpty = ({ title, hint, children }: PanelEmptyProps) => (
  <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 p-4 text-center">
    <p className="text-base font-semibold text-text">{title}</p>
    {hint !== undefined && <p className="max-w-md text-sm text-muted">{hint}</p>}
    {children}
  </div>
)
