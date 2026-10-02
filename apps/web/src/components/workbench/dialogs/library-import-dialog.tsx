'use client'

import type { BrandAsset, Character, Location, Project, ProjectId } from '@ixa/domain'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAssets } from '@/components/workbench/asset-store'
import { useLoaded } from '@/components/workbench/use-loaded'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'

/**
 * ほかのプロジェクトから取り込む（ADR-0034。制作者 2026-10-03「全プロジェクトで共有になっている。プロジェクト単位に
 * しないと大変なことになる」）。
 *
 * キャラクター・ロケーション・ブランド資産はプロジェクトごと。別のプロジェクトのものを使うときは、ここで選んで**複製**する。
 * キャラクターは Look・画像ごと。複製した後は別物（元を直しても、こちらは変わらない）。
 */

export type LibraryImportSourceApi = Pick<
  ApiClient,
  'listProjects' | 'listCharacters' | 'listLocations' | 'listBrandAssets'
>

type SourceItems = {
  readonly characters: readonly Character[]
  readonly locations: readonly Location[]
  readonly brandAssets: readonly BrandAsset[]
}

const NO_ITEMS: SourceItems = { characters: [], locations: [], brandAssets: [] }

const toggled = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export const LibraryImportDialogBody = ({ api }: { readonly api?: LibraryImportSourceApi }) => {
  const workbench = useWorkbench()
  const { actions } = useAssets()
  const client = useMemo<LibraryImportSourceApi>(() => api ?? createApiClient(), [api])
  const { workspaceId } = workbench.project

  const projects = useLoaded(
    'プロジェクト',
    async (): Promise<readonly Project[]> =>
      (await client.listProjects(workspaceId)).filter((project) => project.id !== workbench.projectId),
    `${workspaceId}:${workbench.projectId}`,
  )
  const candidates = projects.state === 'ready' ? projects.value : []
  const [picked, setPicked] = useState<ProjectId | null>(null)
  const sourceId = picked ?? candidates[0]?.id ?? null

  const items = useLoaded(
    '取り込み元の素材',
    async (): Promise<SourceItems> => {
      if (sourceId === null) return NO_ITEMS
      const [characters, locations, brandAssets] = await Promise.all([
        client.listCharacters(sourceId),
        client.listLocations(sourceId),
        client.listBrandAssets(sourceId),
      ])
      return { characters, locations, brandAssets }
    },
    sourceId ?? 'none',
  )
  const source = items.state === 'ready' ? items.value : NO_ITEMS

  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pick = (id: string): void => {
    setChosen((current) => toggled(current, id))
  }

  const characterIds = source.characters.filter((item) => chosen.has(item.id)).map((item) => item.id)
  const locationIds = source.locations.filter((item) => chosen.has(item.id)).map((item) => item.id)
  const brandAssetIds = source.brandAssets.filter((item) => chosen.has(item.id)).map((item) => item.id)
  const count = characterIds.length + locationIds.length + brandAssetIds.length

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await actions.importLibrary({ characterIds, locationIds, brandAssetIds })
      workbench.notify(`${String(count)} 件を取り込みました（複製なので、元のプロジェクトのものとは別物です）。`)
      workbench.closeDialog()
    } catch (cause) {
      setError(`取り込めませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  if (projects.state === 'loading') return <p className="text-sm text-muted">読み込んでいます…</p>
  if (projects.state === 'error') return <p role="alert" className="text-sm text-danger">{projects.message}</p>
  if (candidates.length === 0) {
    return <p className="text-sm text-muted">取り込めるほかのプロジェクトがありません。</p>
  }

  const group = (label: string, list: readonly { readonly id: string; readonly name: string }[]) => (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-muted">{label}</legend>
      {list.length === 0 ? (
        <p className="text-xs text-muted">ありません</p>
      ) : (
        list.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={chosen.has(item.id)} disabled={busy} onChange={() => pick(item.id)} />
            {item.name}
          </label>
        ))
      )}
    </fieldset>
  )

  return (
    <div className="flex max-h-[70vh] flex-col gap-3 text-sm">
      <p className="text-muted">
        キャラクター・ロケーション・ブランド資産はプロジェクトごとです。チェックしたものを、このプロジェクトへ複製します。
        キャラクターは Look と画像ごと複製します。
      </p>
      <label className="flex items-center gap-2">
        <span className="text-muted">取り込み元</span>
        <select
          aria-label="取り込み元のプロジェクト"
          value={sourceId ?? ''}
          disabled={busy}
          onChange={(event) => {
            setPicked(event.target.value as ProjectId)
            setChosen(new Set())
          }}
          className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm"
        >
          {candidates.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      {items.state === 'loading' && <p className="text-muted">読み込んでいます…</p>}
      {items.state === 'error' && <p role="alert" className="text-danger">{items.message}</p>}
      {items.state === 'ready' && (
        <div className="relative min-h-0 flex-1 space-y-3 overflow-auto rounded border border-line p-3">
          {group('キャラクター', source.characters.map((item) => ({ id: item.id, name: item.displayName })))}
          {group('ロケーション', source.locations)}
          {group('ブランド資産', source.brandAssets)}
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={workbench.closeDialog} disabled={busy}>
          やめる
        </Button>
        <Button size="sm" tone="primary" disabled={busy || count === 0} onClick={() => void run()}>
          {count === 0 ? '取り込む' : `${String(count)} 件を取り込む`}
        </Button>
      </div>
    </div>
  )
}
