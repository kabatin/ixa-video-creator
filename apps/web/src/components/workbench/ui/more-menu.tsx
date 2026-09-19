'use client'

import { useEffect, useRef, useState } from 'react'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'

export type MoreMenuItem = {
  readonly label: string
  readonly run: () => Promise<void> | void
  /** 取り消せない操作。確認の文を渡すと、押したあとに確認を挟む。 */
  readonly confirm?: string
  readonly disabled?: boolean
}

/**
 * `⋯` メニュー（UI-WORKBENCH-2 §8）。**取り消せない操作は入力欄の横に置かず、ここに入れる。**
 * 確認はワークベンチのダイアログの殻で出す（`window.confirm` を使わない）。
 */
export const MoreMenu = ({
  label,
  items,
}: {
  /** 読み上げ用の名前（「CUT-04 のその他の操作」など）。 */
  readonly label: string
  readonly items: readonly MoreMenuItem[]
}) => {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<MoreMenuItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || ref.current?.contains(event.target) !== true)
        setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const run = async (entry: MoreMenuItem): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await entry.run()
      setPending(null)
    } catch (cause) {
      setError(describeForPerson(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current)
        }}
        className="inline-flex h-6 min-w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-text"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-40 mt-1 min-w-40 rounded-md border border-line bg-surface py-1 shadow-xl"
        >
          {items.map((entry) => (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              disabled={entry.disabled === true}
              onClick={() => {
                setOpen(false)
                if (entry.confirm === undefined) void run(entry)
                else setPending(entry)
              }}
              className={`block h-7 w-full px-3 text-left text-sm hover:bg-surface-2 disabled:text-muted ${
                entry.confirm === undefined ? 'text-text' : 'text-danger'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
      {error !== null && pending === null && (
        <p
          role="alert"
          className="absolute right-0 top-full mt-1 w-56 rounded bg-danger/10 p-1 text-xs text-danger"
        >
          {error}
        </p>
      )}
      <WorkbenchDialog
        open={pending !== null}
        title={pending?.label ?? ''}
        size="medium"
        onClose={() => {
          setPending(null)
          setError(null)
        }}
      >
        <p className="text-sm text-text">{pending?.confirm}</p>
        {error !== null && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            size="sm"
            onClick={() => {
              setPending(null)
              setError(null)
            }}
          >
            やめる
          </Button>
          <Button
            size="sm"
            tone="danger"
            disabled={busy}
            onClick={() => {
              if (pending !== null) void run(pending)
            }}
          >
            {busy ? '実行中…' : pending?.label}
          </Button>
        </div>
      </WorkbenchDialog>
    </div>
  )
}
