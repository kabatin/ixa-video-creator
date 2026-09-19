'use client'

import { BrandCategory } from '@ixa/domain'
import { useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { useAssets, type Loaded } from '@/components/workbench/asset-store'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { describeForPerson } from '@/lib/api-error'
import { ASSET_DRAG_TYPE, encodeAssetDrag, type AssetDragPayload } from '@/lib/asset-actions'
import { matchesAssetQuery } from '@/lib/asset-tree'
import { sameSelection, type Inspected } from '@/lib/workbench-selection'

const ITEM =
  'flex h-6 w-full min-w-0 items-center gap-1.5 rounded px-1 text-left text-sm text-text ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus'

/**
 * 素材ツリー（左。UI-WORKBENCH-2 §4.1）。**実物が 1 件ずつ並ぶ。**
 *
 * - 1 回押す = 選ぶ（右のインスペクターが切り替わる）。2 回 / Enter = 中央の素材ビューアで見る
 * - 各グループの ＋ で、その場に名前の欄が出る → Enter で作成 → 作った物を選ぶ
 * - キャラクターとロケーションはストーリーボードのカードや Shot 一覧の行へドラッグで割り当てられる
 * - 値は素材の共有状態（`asset-store`）から読む。どこで足しても消しても、ここにすぐ出る
 */
export const AssetTree = () => {
  const workbench = useWorkbench()
  const { characters, looks, locations, brandAssets, tracks, actions } = useAssets()
  const [query, setQuery] = useState('')
  const audioInput = useRef<HTMLInputElement>(null)
  const [trackError, setTrackError] = useState<string | null>(null)
  const show = (...labels: readonly string[]): boolean =>
    labels.some((label) => matchesAssetQuery(label, query))

  const select = (selection: Inspected): void => {
    workbench.inspect(selection)
  }
  const open = (selection: Inspected): void => {
    workbench.inspect(selection)
    workbench.openViewer()
  }
  const rowProps = (selection: Inspected, drag?: AssetDragPayload) => ({
    selected: sameSelection(workbench.inspected, selection),
    onSelect: () => {
      select(selection)
    },
    onOpen: () => {
      open(selection)
    },
    drag,
  })

  return (
    <div className="flex h-full flex-col gap-2">
      <input
        type="search"
        value={query}
        placeholder="素材を検索"
        aria-label="素材を検索"
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        className="h-7 w-full rounded border border-line-strong bg-bg px-2 text-sm text-text"
      />

      <nav aria-label="素材" className="min-h-0 flex-1 space-y-1 overflow-auto">
        <Group
          label="楽曲"
          count={tracks}
          addLabel="楽曲を追加"
          onAdd={() => {
            audioInput.current?.click()
          }}
        >
          {trackError !== null && <Note tone="danger">{trackError}</Note>}
          {(tracks.state === 'ready' ? tracks.value : [])
            .filter((track) => show(track.title))
            .map((track) => (
              <Row
                key={track.id}
                icon="♪"
                label={track.title}
                badge={track.isMaster ? 'マスター' : undefined}
                {...rowProps({ kind: 'track', id: track.id })}
              />
            ))}
        </Group>

        <Group
          label="キャラクター"
          count={characters}
          addLabel="キャラクターを追加"
          create={async (name) => {
            const created = await actions.createCharacter(name)
            select({ kind: 'character', id: created.id })
          }}
        >
          {(characters.state === 'ready' ? characters.value : [])
            .filter((character) =>
              show(
                character.displayName,
                character.name,
                ...(looks.get(character.id) ?? []).map((l) => l.name),
              ),
            )
            .map((character) => (
              <div key={character.id}>
                <Row
                  icon="◐"
                  label={character.displayName}
                  {...rowProps(
                    { kind: 'character', id: character.id },
                    { kind: 'character', id: character.id },
                  )}
                />
                <div className="pl-4">
                  {(looks.get(character.id) ?? []).map((look) => (
                    <Row
                      key={look.id}
                      icon="└"
                      label={look.name}
                      badge={look.isDefault ? '既定' : undefined}
                      {...rowProps({ kind: 'look', id: look.id, characterId: character.id })}
                    />
                  ))}
                  <InlineCreate
                    label="Look を追加"
                    create={async (name) => {
                      const created = await actions.createLook(character.id, name)
                      select({ kind: 'look', id: created.id, characterId: character.id })
                    }}
                  />
                </div>
              </div>
            ))}
        </Group>

        <Group
          label="ロケーション"
          count={locations}
          addLabel="ロケーションを追加"
          create={async (name) => {
            const created = await actions.createLocation(name)
            select({ kind: 'location', id: created.id })
          }}
        >
          {(locations.state === 'ready' ? locations.value : [])
            .filter((location) => show(location.name, location.description))
            .map((location) => (
              <Row
                key={location.id}
                icon="⌂"
                label={location.name}
                badge={
                  location.referenceAssetIds.length > 0
                    ? `${String(location.referenceAssetIds.length)} 枚`
                    : undefined
                }
                {...rowProps(
                  { kind: 'location', id: location.id },
                  { kind: 'location', id: location.id },
                )}
              />
            ))}
        </Group>

        <Group
          label="ブランド資産"
          count={brandAssets}
          addLabel="ブランド資産を追加"
          create={async (name) => {
            // 名前が色の値（#RRGGBB）なら色として作る。それ以外はロゴとして作り、種類は右で直す。
            const isColor = /^#[0-9a-f]{6}$/i.test(name.trim())
            const created = isColor
              ? await actions.createBrandAsset(
                  name.trim().toUpperCase(),
                  BrandCategory.enum.color,
                  name.trim().toUpperCase(),
                )
              : await actions.createBrandAsset(name, BrandCategory.enum.logo)
            select({ kind: 'brand-asset', id: created.id })
          }}
        >
          {(brandAssets.state === 'ready' ? brandAssets.value : [])
            .filter((asset) => show(asset.name, asset.value ?? '', asset.usageRule))
            .map((asset) => (
              <Row
                key={asset.id}
                icon={
                  asset.category === 'color' && asset.value !== null ? (
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 rounded-sm border border-line"
                      style={{ background: asset.value }}
                    />
                  ) : (
                    '■'
                  )
                }
                label={asset.name}
                badge={asset.value ?? undefined}
                {...rowProps({ kind: 'brand-asset', id: asset.id })}
              />
            ))}
        </Group>
      </nav>

      <input
        ref={audioInput}
        type="file"
        accept="audio/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file === undefined) return
          setTrackError(null)
          actions
            .addTrackFromFile(file)
            .then((track) => {
              select({ kind: 'track', id: track.id })
            })
            .catch((cause: unknown) => {
              setTrackError(`楽曲を登録できませんでした: ${describeForPerson(cause)}`)
            })
        }}
      />
    </div>
  )
}

/** 件数の見出し。読めていないときは件数を出さない（0 件と言わない。L-015）。 */
const countLabel = (loaded: Loaded<readonly unknown[]>): string =>
  loaded.state === 'ready'
    ? `(${String(loaded.value.length)})`
    : loaded.state === 'loading'
      ? '…'
      : '!'

const Group = ({
  label,
  count,
  addLabel,
  onAdd,
  create,
  children,
}: {
  readonly label: string
  readonly count: Loaded<readonly unknown[]>
  readonly addLabel: string
  /** 押したらすぐ何かを始める（ファイル選択など）。 */
  readonly onAdd?: () => void
  /** 名前の欄を出して作る。 */
  readonly create?: (name: string) => Promise<void>
  readonly children: ReactNode
}) => {
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState(false)
  return (
    <div>
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((current) => !current)
          }}
          className={`${ITEM} flex-1 font-semibold text-muted hover:bg-surface-2`}
        >
          <span aria-hidden className="w-3 text-xs">
            {open ? '▾' : '▸'}
          </span>
          {label}
          <span className="text-xs font-normal">{countLabel(count)}</span>
        </button>
        <button
          type="button"
          aria-label={addLabel}
          title={addLabel}
          onClick={() => {
            setOpen(true)
            if (onAdd !== undefined) onAdd()
            else setAdding(true)
          }}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-text"
        >
          ＋
        </button>
      </div>
      {open && (
        <div className="pl-3">
          {count.state === 'error' && <Note tone="danger">{count.message}</Note>}
          {count.state === 'ready' && count.value.length === 0 && !adding && (
            <Note>まだありません</Note>
          )}
          {children}
          {adding && create !== undefined && (
            <InlineCreate
              label={addLabel}
              autoOpen
              onDone={() => {
                setAdding(false)
              }}
              create={create}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** その場で名前を打って作る欄。Enter で作成、Esc でやめる。 */
const InlineCreate = ({
  label,
  create,
  autoOpen = false,
  onDone,
}: {
  readonly label: string
  readonly create: (name: string) => Promise<void>
  readonly autoOpen?: boolean
  readonly onDone?: () => void
}) => {
  const [editing, setEditing] = useState(autoOpen)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (): void => {
    setEditing(false)
    setName('')
    setError(null)
    onDone?.()
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`${ITEM} text-xs text-muted hover:bg-surface-2`}
      >
        ＋ {label}
      </button>
    )
  }
  return (
    <div>
      <input
        autoFocus
        value={name}
        disabled={busy}
        aria-label={`${label}（名前）`}
        placeholder="名前を入れて Enter"
        onChange={(event) => {
          setName(event.target.value)
        }}
        onBlur={() => {
          if (name.trim() === '' && !busy) close()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close()
          if (event.key !== 'Enter' || name.trim() === '') return
          event.preventDefault()
          setBusy(true)
          setError(null)
          create(name.trim())
            .then(close)
            .catch((cause: unknown) => {
              setError(`作れませんでした: ${describeForPerson(cause)}`)
            })
            .finally(() => {
              setBusy(false)
            })
        }}
        className="h-6 w-full rounded border border-accent bg-bg px-1.5 text-sm text-text"
      />
      {error !== null && <Note tone="danger">{error}</Note>}
    </div>
  )
}

const Row = ({
  icon,
  label,
  badge,
  selected,
  onSelect,
  onOpen,
  drag,
}: {
  readonly icon: ReactNode
  readonly label: string
  readonly badge?: string
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onOpen: () => void
  /** ドラッグで Shot に割り当てられる素材なら、その中身。 */
  readonly drag?: AssetDragPayload
}) => (
  <button
    type="button"
    aria-current={selected ? 'true' : undefined}
    draggable={drag !== undefined}
    onDragStart={(event: DragEvent<HTMLButtonElement>) => {
      if (drag === undefined) return
      event.dataTransfer.setData(ASSET_DRAG_TYPE, encodeAssetDrag(drag))
      event.dataTransfer.effectAllowed = 'link'
    }}
    onClick={onSelect}
    onDoubleClick={onOpen}
    onKeyDown={(event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      onOpen()
    }}
    title={
      drag === undefined ? undefined : 'Shot のカードや一覧の行へドラッグすると割り当てられます'
    }
    className={`${ITEM} ${selected ? 'bg-accent/15' : 'hover:bg-surface-2'}`}
  >
    <span aria-hidden className="flex w-3 shrink-0 justify-center text-xs text-muted">
      {icon}
    </span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {badge !== undefined && <span className="shrink-0 text-xs text-muted">{badge}</span>}
  </button>
)

const Note = ({
  tone = 'muted',
  children,
}: {
  readonly tone?: 'muted' | 'danger'
  readonly children: ReactNode
}) => (
  <p
    role={tone === 'danger' ? 'alert' : undefined}
    className={`px-1 text-xs ${tone === 'danger' ? 'text-danger' : 'text-muted'}`}
  >
    {children}
  </p>
)
