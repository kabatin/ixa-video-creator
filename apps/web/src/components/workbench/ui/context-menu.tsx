'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { placeContextMenu } from '@/lib/context-menus'
import { Button } from '@/components/ui/button'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import { describeForPerson } from '@/lib/api-error'

/** メニューの 1 行。実行は `run`（右クリックした物に結び付けて作る）。 */
export type ContextMenuItem =
  | {
      readonly kind: 'item'
      readonly id: string
      readonly label: string
      readonly shortcut?: string
      /** 押せない理由。押せるなら null。 */
      readonly disabledReason: string | null
      /** 取り消せない操作。確認の文を渡すと、押したあとに確認を挟む（`window.confirm` を使わない）。 */
      readonly confirm?: string
      /** 確認で「しない」側の言葉。既定は「やめる」（`context-menus.ts` の同名の項目）。 */
      readonly keepLabel?: string
      readonly run: () => void | Promise<void>
    }
  | { readonly kind: 'separator' }

export type ContextMenuRequest = {
  /** 読み上げの名前（「Shot CUT-01 の操作」）。 */
  readonly label: string
  readonly items: readonly ContextMenuItem[]
  /** 画面上の開く位置（押した所）。 */
  readonly at: { readonly x: number; readonly y: number }
  /** 閉じたら焦点を戻す先（右クリックした物）。 */
  readonly origin: HTMLElement | null
}

type Host = {
  readonly open: (request: ContextMenuRequest) => void
  /**
   * メニューを開かずに 1 つの操作を実行する（カードや欄のボタンから）。
   * 確認・失敗の理由の出し方を右クリックのメニューと同じにする。
   */
  readonly perform: (item: Extract<ContextMenuItem, { kind: 'item' }>) => void
}

const ContextMenuContext = createContext<Host | null>(null)

/** 置き場の外（ワークベンチの外で単独に描く部品）では null。そこではメニューを出さない。 */
export const useOptionalContextMenuHost = (): Host | null => useContext(ContextMenuContext)

/** 開いているメニューは 1 つだけ。開く口を配る。 */
export const useContextMenuHost = (): Host => {
  const host = useContext(ContextMenuContext)
  if (host === null) throw new Error('ContextMenuHost の外で右クリックのメニューを開こうとしました')
  return host
}

type Enabled = Extract<ContextMenuItem, { kind: 'item' }>

/** 焦点を当てられる行（区切り線を除く。押せない行も理由を読めるよう焦点は当てる）。 */
const actionableIndexes = (items: readonly ContextMenuItem[]): readonly number[] =>
  items.flatMap((item, index) => (item.kind === 'item' ? [index] : []))

const ContextMenu = ({
  request,
  onClose,
  onChoose,
}: {
  readonly request: ContextMenuRequest
  readonly onClose: () => void
  /** 選ばれた項目（確認が要れば置き場が確認を挟む）。 */
  readonly onChoose: (item: Enabled) => void
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: request.at.x,
    top: request.at.y,
  })
  const actionable = actionableIndexes(request.items)

  // 大きさが分かってから、はみ出さない位置へ置き直し、最初の項目に焦点を当てる（開いたときに 1 回）。
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (menu === null) return
    const box = menu.getBoundingClientRect()
    setPosition(
      placeContextMenu(
        request.at,
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
    const first = actionableIndexes(request.items)[0]
    if (first !== undefined) itemRefs.current[first]?.focus()
  }, [request])

  // 外を押したら閉じる（メニューの中は除く）。
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target) === true) return
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  const close = (): void => {
    onClose()
    request.origin?.focus()
  }

  const activate = (item: Enabled): void => {
    if (item.disabledReason !== null) return
    close()
    onChoose(item)
  }

  const move = (from: number, step: 1 | -1): void => {
    const position = actionable.indexOf(from)
    const next = actionable[(position + step + actionable.length) % actionable.length]
    if (next !== undefined) itemRefs.current[next]?.focus()
  }

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    item: Enabled,
  ): void => {
    // ワークベンチのショートカット（Delete・矢印など）へ漏らさない。
    event.stopPropagation()
    const first = actionable[0]
    const last = actionable.at(-1)
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(index, 1)
        return
      case 'ArrowUp':
        event.preventDefault()
        move(index, -1)
        return
      case 'Home':
        event.preventDefault()
        if (first !== undefined) itemRefs.current[first]?.focus()
        return
      case 'End':
        event.preventDefault()
        if (last !== undefined) itemRefs.current[last]?.focus()
        return
      case 'Escape':
      case 'Tab':
        event.preventDefault()
        close()
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        activate(item)
        return
      default:
    }
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={request.label}
      style={{ position: 'fixed', left: position.left, top: position.top }}
      className="z-[60] min-w-56 max-w-80 rounded-md border border-line bg-surface py-1 text-sm shadow-xl"
      onContextMenu={(event) => {
        // メニューの上での右クリックは、ブラウザのメニューを出さない。
        event.preventDefault()
      }}
    >
      {request.items.map((item, index) =>
        item.kind === 'separator' ? (
          <div
            key={`separator-${String(index)}`}
            role="separator"
            className="my-1 border-t border-line"
          />
        ) : (
          <button
            key={item.id}
            ref={(element) => {
              itemRefs.current[index] = element
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabledReason !== null}
            title={item.disabledReason ?? undefined}
            onClick={() => {
              activate(item)
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index, item)
            }}
            className={`flex w-full items-start gap-6 px-3 py-1 text-left ${
              item.disabledReason !== null
                ? 'cursor-default text-muted'
                : item.confirm === undefined
                  ? 'text-text hover:bg-surface-2'
                  : 'text-danger hover:bg-surface-2'
            } focus:bg-surface-2 focus:outline-none`}
          >
            <span className="flex-1">
              {item.label}
              {item.disabledReason !== null && (
                <span className="block text-xs">{item.disabledReason}</span>
              )}
            </span>
            {item.shortcut !== undefined && (
              <span className="text-xs text-muted">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}

/**
 * 右クリック（長押し・Shift+F10）のメニューの置き場（制作者 2026-09-30「全画面に右クリックのメニューを」）。
 * 開いているのは 1 つだけ。画面全体に浮かせ、はみ出さない位置に置く。
 */
export const ContextMenuHost = ({ children }: { readonly children: ReactNode }) => {
  const [request, setRequest] = useState<ContextMenuRequest | null>(null)
  /** 確認を待っている項目（失敗したときは理由を出すためにも使う）。 */
  const [pending, setPending] = useState<Enabled | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = useMemo(
    () => () => {
      setRequest(null)
    },
    [],
  )

  /** 使うのは状態の setter だけなので、一度作れば足りる（`host` を描き直さない）。 */
  const run = useCallback(async (item: Enabled): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await item.run()
      setPending(null)
    } catch (cause) {
      // 握り潰さない。確認の中なら確認の中に、そうでなければ同じ殻で理由を出す。
      setPending(item)
      setError(describeForPerson(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const choose = useCallback(
    (item: Enabled): void => {
      if (item.confirm === undefined) void run(item)
      else setPending(item)
    },
    [run],
  )

  const host = useMemo<Host>(() => ({ open: setRequest, perform: choose }), [choose])

  const dismiss = (): void => {
    setPending(null)
    setError(null)
  }

  return (
    <ContextMenuContext.Provider value={host}>
      {children}
      {request !== null && (
        <ContextMenu
          key={`${String(request.at.x)}:${String(request.at.y)}:${request.label}`}
          request={request}
          onClose={close}
          onChoose={choose}
        />
      )}
      <WorkbenchDialog open={pending !== null} title={pending?.label ?? ''} size="medium" onClose={dismiss}>
        {pending?.confirm !== undefined && <p className="text-sm text-text">{pending.confirm}</p>}
        {error !== null && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" onClick={dismiss}>
            {pending?.confirm === undefined ? '閉じる' : (pending.keepLabel ?? 'やめる')}
          </Button>
          {pending?.confirm !== undefined && (
            <Button
              size="sm"
              tone="danger"
              disabled={busy}
              onClick={() => {
                void run(pending)
              }}
            >
              {busy ? '実行中…' : pending.label}
            </Button>
          )}
        </div>
      </WorkbenchDialog>
    </ContextMenuContext.Provider>
  )
}
