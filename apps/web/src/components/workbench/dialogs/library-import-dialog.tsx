'use client'

import {
  BrandAssetId,
  CharacterId,
  LocationId,
  MusicTrackId,
  VoiceProfileId,
  type Project,
  type ProjectId,
} from '@ixa/domain'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { useAssets } from '@/components/workbench/asset-store'
import { useLoaded } from '@/components/workbench/use-loaded'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient, type ApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { LibraryImportRequest } from '@/lib/library-import-api'
import {
  LIBRARY_IMPORT_SECTIONS,
  LIBRARY_IMPORT_SECTION_LABELS,
  LIBRARY_IMPORT_SECTION_NOTES,
  sfxImportChoices,
  type LibraryImportSection,
} from '@/lib/library-import-sections'
import { VOICE_TOOL_LABELS } from '@/lib/voice-defaults'

/**
 * ほかのプロジェクトから取り込む（ADR-0034・ADR-0053。制作者 2026-10-03「全プロジェクトで共有になっている。
 * プロジェクト単位にしないと大変なことになる」、2026-10-19「素材ツリーにある各種項目の素材を他のプロジェクトから
 * 簡単にコピーできるといいなぁ。現にいま、戦子ちゃんにある声素材が欲しいと思ってしまった」）。
 *
 * 素材ツリーの段はプロジェクトごと。取り込み元を選び、段ごとの区分でチェックした分を**複製**する。
 * 画像・音のファイルは同じものを使う。複製した後は別物（元を直しても、こちらは変わらない）。
 */

export type LibraryImportSourceApi = Pick<
  ApiClient,
  | 'listProjects'
  | 'listCharacters'
  | 'listLocations'
  | 'listBrandAssets'
  | 'listVoices'
  | 'listMusicTracks'
  | 'listSfxJobs'
>

type Choice = { readonly key: string; readonly label: string; readonly badge?: string }

type SourceItems = Readonly<Record<LibraryImportSection, readonly Choice[]>> & {
  /** 効果音の行の鍵 → 取り込みで送る組（ジョブと音）。 */
  readonly sfxRefs: ReadonlyMap<string, LibraryImportRequest['sfxSounds'][number]>
}

const NO_ITEMS: SourceItems = {
  musicTracks: [],
  sfx: [],
  characters: [],
  voices: [],
  locations: [],
  brandAssets: [],
  sfxRefs: new Map(),
}

const loadSource = async (client: LibraryImportSourceApi, sourceId: ProjectId): Promise<SourceItems> => {
  const [characters, locations, brandAssets, voices, tracks, sfxJobs] = await Promise.all([
    client.listCharacters(sourceId),
    client.listLocations(sourceId),
    client.listBrandAssets(sourceId),
    client.listVoices(sourceId),
    client.listMusicTracks(sourceId),
    client.listSfxJobs(sourceId),
  ])
  const sfx = sfxImportChoices(sfxJobs)
  return {
    musicTracks: tracks.map((track) => ({ key: track.id, label: track.title, badge: track.isMaster ? 'マスター' : undefined })),
    sfx: sfx.map(({ key, label }) => ({ key, label })),
    characters: characters.map((item) => ({ key: item.id, label: item.displayName })),
    voices: voices.map((voice) => ({ key: voice.id, label: voice.name, badge: VOICE_TOOL_LABELS[voice.tool] })),
    locations: locations.map((item) => ({ key: item.id, label: item.name })),
    brandAssets: brandAssets.map((item) => ({ key: item.id, label: item.name })),
    sfxRefs: new Map(sfx.map(({ key, sfxJobId, mediaAssetId }) => [key, { sfxJobId, mediaAssetId }])),
  }
}

const toggled = (set: ReadonlySet<string>, id: string): ReadonlySet<string> =>
  set.has(id) ? new Set([...set].filter((other) => other !== id)) : new Set([...set, id])

/** チェックした鍵を、送る形にする（その区分の一覧にある順）。 */
const requestOf = (source: SourceItems, chosen: ReadonlySet<string>): LibraryImportRequest => {
  const picked = (section: LibraryImportSection): string[] =>
    source[section].filter((item) => chosen.has(item.key)).map((item) => item.key)
  return {
    // 鍵は読み込みの境界で検証した ID そのもの。型を付け直すために通し直す。
    characterIds: z.array(CharacterId).parse(picked('characters')),
    locationIds: z.array(LocationId).parse(picked('locations')),
    brandAssetIds: z.array(BrandAssetId).parse(picked('brandAssets')),
    voiceIds: z.array(VoiceProfileId).parse(picked('voices')),
    musicTrackIds: z.array(MusicTrackId).parse(picked('musicTracks')),
    sfxSounds: picked('sfx').flatMap((key) => {
      const ref = source.sfxRefs.get(key)
      return ref === undefined ? [] : [ref]
    }),
  }
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
    async (): Promise<SourceItems> => (sourceId === null ? NO_ITEMS : loadSource(client, sourceId)),
    sourceId ?? 'none',
  )
  const source = items.state === 'ready' ? items.value : NO_ITEMS

  const [section, setSection] = useState<LibraryImportSection>(workbench.dialogImportSection ?? 'characters')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosenIn = (target: LibraryImportSection): number => source[target].filter((item) => chosen.has(item.key)).length
  const count = LIBRARY_IMPORT_SECTIONS.reduce((sum, target) => sum + chosenIn(target), 0)

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const request = requestOf(source, chosen)
      await actions.importLibrary(request)
      if (request.sfxSounds.length > 0) workbench.bumpSfx()
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

  const list = source[section]
  return (
    <div className="flex max-h-[70vh] flex-col gap-3 text-sm">
      <p className="text-muted">
        素材はプロジェクトごとです。チェックしたものを、このプロジェクトへ複製します（区分をまたいで選べます）。
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
      <div role="tablist" aria-label="取り込む素材の区分" className="flex flex-wrap gap-1 border-b border-line">
        {LIBRARY_IMPORT_SECTIONS.map((target) => {
          const selectedCount = chosenIn(target)
          return (
            <button
              key={target}
              type="button"
              role="tab"
              aria-selected={target === section}
              onClick={() => {
                setSection(target)
              }}
              className={`rounded-t px-2 py-1 text-sm ${
                target === section ? 'border border-b-0 border-line bg-surface font-semibold text-text' : 'text-muted hover:text-text'
              }`}
            >
              {LIBRARY_IMPORT_SECTION_LABELS[target]}
              {selectedCount > 0 && <span className="ml-1 text-xs text-accent">{`✓${String(selectedCount)}`}</span>}
            </button>
          )
        })}
      </div>
      {items.state === 'loading' && <p className="text-muted">読み込んでいます…</p>}
      {items.state === 'error' && <p role="alert" className="text-danger">{items.message}</p>}
      {items.state === 'ready' && (
        <div role="tabpanel" aria-label={LIBRARY_IMPORT_SECTION_LABELS[section]} className="relative min-h-0 flex-1 space-y-2 overflow-auto rounded border border-line p-3">
          <p className="text-xs text-muted">{LIBRARY_IMPORT_SECTION_NOTES[section]}</p>
          <fieldset className="space-y-1">
            <legend className="sr-only">{LIBRARY_IMPORT_SECTION_LABELS[section]}</legend>
            {list.length === 0 ? (
              <p className="text-xs text-muted">ありません</p>
            ) : (
              list.map((item) => (
                <label key={item.key} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={chosen.has(item.key)}
                    disabled={busy}
                    onChange={() => {
                      setChosen((current) => toggled(current, item.key))
                    }}
                  />
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.badge !== undefined && <span className="text-xs text-muted">{item.badge}</span>}
                </label>
              ))
            )}
          </fieldset>
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
