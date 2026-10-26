'use client'

import { useEffect, useId, useLayoutEffect, useState, type ReactNode } from 'react'
import { readSectionOpen, writeSectionOpen, type RememberedOpen } from '@/lib/section-open-state'

/**
 * インスペクターの畳める区切り（UI-WORKBENCH-2 §5.1 / §8、2026-10-26）。
 *
 * 制作者 2026-10-26「インスペクターが雑多になりすぎて縦長だし区切りも良く分からないし、かなり使いづらい」。
 * 小さな灰色の見出しと細い罫線だけでは、370px の幅で 2,700px 続く欄のどこが境目か分からなかった。
 * **見出しの行を太くし、押すと畳める。畳んだら 1 行の要約を出す**（「セリフ（2 行）」のように、開かなくても中身が分かる）。
 * タブにはしない（生成とレビューが隠れて見つからなかった。§5.1）。1 本のスクロールのまま。
 *
 * 開け閉めはこの端末で覚える（`lib/section-open-state`）。**覚えられなくても動く**（既定で出し、押せば開け閉めできる）。
 * 中身は畳んでも外さない（`hidden`）。読み込み途中の欄や選んだモデルが、開け閉めで消えない。
 */
export const CollapsibleSection = ({
  scope,
  id,
  title,
  summary,
  defaultOpen,
  openSignal = 0,
  action,
  sectionRef,
  children,
}: {
  /** どの種類のインスペクターか（`shot` / `character`）。覚える場所を分ける。 */
  readonly scope: string
  /** 区切りの名前（覚える鍵・目次の行き先）。画面には出さない。 */
  readonly id: string
  readonly title: string
  /** 畳んでいるときだけ見出しに添える 1 行。 */
  readonly summary?: string
  /** 覚えていないときの開け閉め。中身で変わってよい（絵は最初のフレームが無いときだけ開く）。 */
  readonly defaultOpen: boolean
  /** 増えたら開く（目次やメニューから来たとき）。0 は合図なし。 */
  readonly openSignal?: number
  /** 見出しの右に置く小さな操作（「比較を開く」など）。 */
  readonly action?: ReactNode
  /** 目次やメニューから送るときの行き先。 */
  readonly sectionRef?: (element: HTMLElement | null) => void
  readonly children: ReactNode
}) => {
  const bodyId = useId()
  /** 押した・覚えていた開け閉め。`null` は既定に従う。 */
  const [choice, setChoice] = useState<RememberedOpen>(null)
  // 覚えた値は描く前に読む（描いてから開くと、畳んだ区切りが一瞬開いて見える）。サーバ側の描画では読まない。
  useLayoutEffect(() => {
    setChoice(readSectionOpen(scope, id))
  }, [scope, id])
  useEffect(() => {
    // 合図で開いたのは覚えない（利用者が選んだ開け閉めではない）。
    if (openSignal > 0) setChoice(true)
  }, [openSignal])
  const open = choice ?? defaultOpen

  const toggle = (): void => {
    const next = !open
    setChoice(next)
    writeSectionOpen(scope, id, next)
  }

  return (
    <section ref={sectionRef} className="border-t border-line-strong first:border-t-0">
      <div className="flex min-h-8 items-center gap-2 bg-surface-2 px-1.5">
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
            className="flex w-full min-w-0 items-center gap-1.5 py-1 text-left hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span
              aria-hidden="true"
              className={`inline-block w-3 shrink-0 text-xs text-muted transition-transform ${open ? 'rotate-90' : ''}`}
            >
              ▸
            </span>
            <span className="shrink-0 text-sm font-semibold text-text">{title}</span>
            {!open && summary !== undefined && summary !== '' && (
              <span className="min-w-0 truncate text-xs font-normal text-muted">{`（${summary}）`}</span>
            )}
          </button>
        </h3>
        {action !== undefined && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </div>
      <div id={bodyId} hidden={!open} className="space-y-1.5 px-0.5 pb-3 pt-2">
        {children}
      </div>
    </section>
  )
}

/**
 * 区切りの中の、普段触らない小さなまとまり（「終わりの画像」「差し替えの指定」など）。押すと開く。
 * 区切りより一段弱い見た目にする（見出しの行と取り違えない）。
 */
export const SubPart = ({
  title,
  defaultOpen = false,
  children,
}: {
  readonly title: string
  readonly defaultOpen?: boolean
  readonly children: ReactNode
}) => (
  <details open={defaultOpen ? true : undefined} className="group text-sm">
    <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted hover:text-text">
      <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
        ▸
      </span>
      <span>{title}</span>
    </summary>
    <div className="mt-1.5 space-y-1.5">{children}</div>
  </details>
)

/** 区切りの中の小見出し（「Take を作る」「声の差し替え」）。見出しの行ではないので読み上げの見出しにしない。 */
export const SubLabel = ({ children }: { readonly children: ReactNode }) => (
  <p className="pt-1 text-xs font-semibold text-muted">{children}</p>
)

export type SectionTocItem = { readonly id: string; readonly label: string }

/**
 * 目次（2026-10-26）。区切りの名前と短い数（「セリフ 2」「Take 3本」）を並べ、押すとその区切りを開いて送る。
 * 縦に長い 1 本のスクロールでも、行きたい所へ 1 回で行ける。
 */
export const SectionToc = ({
  items,
  onJump,
}: {
  readonly items: readonly SectionTocItem[]
  readonly onJump: (id: string) => void
}) => (
  <nav aria-label="インスペクターの目次" className="flex shrink-0 flex-wrap gap-1 border-b border-line px-2 py-1">
    {items.map((item) => (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          onJump(item.id)
        }}
        className="h-5 whitespace-nowrap rounded-full border border-line px-2 text-xs text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        {item.label}
      </button>
    ))}
  </nav>
)

/**
 * 長い説明を ⓘ に畳む（2026-10-26）。**文は消さない。** 押すと吹き出しで出し、読み上げには常に渡す
 * （ボタンの説明として結ぶ）。マウスを載せたときは title でも読める。
 */
export const InfoTip = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => {
  const tipId = useId()
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`${label}の説明`}
        aria-describedby={tipId}
        aria-expanded={open}
        title={typeof children === 'string' ? children : undefined}
        onClick={() => {
          setOpen((current) => !current)
        }}
        onBlur={() => {
          setOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        className="inline-flex h-6 min-w-6 items-center justify-center rounded text-xs text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        ⓘ
      </button>
      <span
        id={tipId}
        role="note"
        hidden={!open}
        className="absolute right-0 top-full z-30 mt-1 w-64 max-w-[80vw] rounded-md border border-line bg-surface p-2 text-xs text-text shadow-xl"
      >
        {children}
      </span>
    </span>
  )
}
