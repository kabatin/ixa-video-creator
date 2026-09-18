'use client'

import type { Character, CharacterId, CharacterIdentityImage } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { MediaImage } from '@/components/media-image'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { matchesAssetQuery } from '@/lib/asset-tree'

/** サムネイルは 4×2 まで（UI-WORKBENCH §9 7.3）。 */
const THUMBNAIL_LIMIT = 8

type Loaded<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'error'; readonly message: string }

const ITEM =
  'flex h-6 w-full items-center gap-1 rounded px-1 text-left text-sm text-text hover:bg-surface-2 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus'

/**
 * 素材ツリー（左。UI-WORKBENCH §3 / 7.3）。
 *
 * - プロジェクト: 楽曲・解析 / 絵コンテ案 / 書き出し履歴（ダイアログかタブを開く）
 * - 共有素材: キャラクター / ロケーション / ブランド資産（中央上のタブとして開く）
 * - 下: 選んだキャラクターの識別画像 4×2
 *
 * 共有素材は Workspace のもの。**同じものを 2 箇所で編集できるようにしない**ため、
 * 編集は開いたタブ（既存の `character-workbench` 等）だけが持つ。
 */
export const AssetTree = () => {
  const workbench = useWorkbench()
  const [query, setQuery] = useState('')
  const characters = useCharacters(workbench.project.workspaceId)
  const [characterId, setCharacterId] = useState<CharacterId | null>(null)

  const show = (label: string): boolean => matchesAssetQuery(label, query)
  const visibleCharacters =
    characters.state === 'ready'
      ? characters.value.filter((character) => show(character.displayName))
      : []

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
      <Button
        size="sm"
        onClick={() => {
          workbench.openDialog('import')
        }}
      >
        + インポート
      </Button>

      <nav aria-label="素材" className="min-h-0 flex-1 overflow-auto">
        <Group label="プロジェクト">
          {show('楽曲・解析') && (
            <Item
              label="楽曲・解析"
              onOpen={() => {
                workbench.openDialog('music')
              }}
            />
          )}
          {show('絵コンテ案') && (
            <Item
              label="絵コンテ案"
              onOpen={() => {
                workbench.focusPanel('draft')
              }}
            />
          )}
          {show('書き出し履歴') && (
            <Item
              label="書き出し履歴"
              onOpen={() => {
                workbench.openDialog('render')
              }}
            />
          )}
        </Group>

        <Group label="共有素材">
          <Group label="キャラクター" nested>
            {characters.state === 'loading' && <Note>読み込んでいます…</Note>}
            {characters.state === 'error' && <Note tone="danger">{characters.message}</Note>}
            {characters.state === 'ready' && characters.value.length === 0 && (
              <Note>まだ登録されていません</Note>
            )}
            {visibleCharacters.map((character) => (
              <Item
                key={character.id}
                label={character.displayName}
                selected={character.id === characterId}
                onOpen={() => {
                  setCharacterId(character.id)
                  workbench.openAsset({
                    kind: 'character',
                    id: character.id,
                    label: character.displayName,
                  })
                }}
              />
            ))}
          </Group>
          {show('ロケーション') && (
            <Item
              label="ロケーション"
              onOpen={() => {
                workbench.openAsset({ kind: 'locations' })
              }}
            />
          )}
          {show('ブランド資産') && (
            <Item
              label="ブランド資産"
              onOpen={() => {
                workbench.openAsset({ kind: 'brand-assets' })
              }}
            />
          )}
        </Group>
      </nav>

      {characterId !== null && <IdentityThumbnails characterId={characterId} />}
    </div>
  )
}

const Group = ({
  label,
  nested = false,
  children,
}: {
  readonly label: string
  readonly nested?: boolean
  readonly children: ReactNode
}) => {
  const [open, setOpen] = useState(true)
  return (
    <div className={nested ? 'pl-2' : ''}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current)
        }}
        className={`${ITEM} font-semibold text-muted`}
      >
        <span aria-hidden className="w-3 text-xs">
          {open ? '▾' : '▸'}
        </span>
        {label}
      </button>
      {open && <div className="pl-3">{children}</div>}
    </div>
  )
}

const Item = ({
  label,
  selected = false,
  onOpen,
}: {
  readonly label: string
  readonly selected?: boolean
  readonly onOpen: () => void
}) => (
  <button
    type="button"
    aria-current={selected ? 'true' : undefined}
    onClick={onOpen}
    className={`${ITEM} ${selected ? 'bg-accent/15' : ''}`}
  >
    <span className="truncate">{label}</span>
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

/** 選んだキャラクターの識別画像。多いときは先頭 8 枚だけ（全部はタブで見る）。 */
const IdentityThumbnails = ({ characterId }: { readonly characterId: CharacterId }) => {
  const [images, setImages] = useState<Loaded<readonly CharacterIdentityImage[]>>({
    state: 'loading',
  })

  useEffect(() => {
    let cancelled = false
    setImages({ state: 'loading' })
    createApiClient()
      .listIdentityImages(characterId)
      .then((value) => {
        if (!cancelled) setImages({ state: 'ready', value })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setImages({ state: 'error', message: `識別画像を読み込めませんでした: ${describeError(cause)}` })
        }
      })
    return () => {
      cancelled = true
    }
  }, [characterId])

  if (images.state === 'loading') return <Note>識別画像を読み込んでいます…</Note>
  if (images.state === 'error') return <Note tone="danger">{images.message}</Note>
  if (images.value.length === 0) return <Note>識別画像はまだありません</Note>

  return (
    <ul aria-label="識別画像" className="grid shrink-0 grid-cols-4 gap-1">
      {images.value.slice(0, THUMBNAIL_LIMIT).map((image) => (
        <li key={image.id} className="aspect-square overflow-hidden rounded border border-line">
          <MediaImage
            mediaAssetId={image.mediaAssetId}
            alt={`識別画像（${image.role}）`}
            className="h-full w-full object-cover"
          />
        </li>
      ))}
    </ul>
  )
}

/** Workspace のキャラクター一覧。開いたときに 1 回だけ引く。 */
const useCharacters = (workspaceId: Character['workspaceId']): Loaded<readonly Character[]> => {
  const [state, setState] = useState<Loaded<readonly Character[]>>({ state: 'loading' })
  const api = useMemo(() => createApiClient(), [])
  useEffect(() => {
    let cancelled = false
    api
      .listCharacters(workspaceId)
      .then((value) => {
        if (!cancelled) setState({ state: 'ready', value })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({ state: 'error', message: `キャラクターを読み込めませんでした: ${describeError(cause)}` })
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, workspaceId])
  return state
}
