'use client'

import type {
  BrandAsset,
  BrandAssetId,
  BrandCategory,
  Character,
  CharacterId,
  CharacterLook,
  CharacterLookId,
  Location,
  LocationId,
  MusicTrack,
  MusicTrackId,
  ProjectId,
  UpdateBrandAssetPatch,
  UpdateCharacterPatch,
  UpdateCharacterLookPatch,
  UpdateLocationPatch,
  UpdateMusicTrackPatch,
  WorkspaceId,
} from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { lookKeyFromName } from '@/lib/asset-actions'
import type { LibraryImportRequest, WireLibraryImportResult } from '@/lib/library-import-api'
import { deriveTrackTitle } from '@/lib/music-upload'

/**
 * ワークベンチの素材（UI-WORKBENCH-2 §4.2 / D5 の拡張）。
 *
 * キャラクター（+ Look）・ロケーション・ブランド資産・楽曲を **1 箇所に持つ**。
 * 作る・直す・消すはここの関数経由にし、終わったら手元を差し替える。
 * ツリー・インスペクター・ビューア・Shot の選択肢が同じ値を見るので、
 * 「足したのに別の場所に出ない」が構造的に起きない（以前はツリーが開いたときに 1 回読むだけだった）。
 */

export type Loaded<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'error'; readonly message: string }

export type AssetActions = {
  readonly createCharacter: (displayName: string) => Promise<Character>
  readonly updateCharacter: (id: CharacterId, patch: UpdateCharacterPatch) => Promise<Character>
  readonly deleteCharacter: (id: CharacterId) => Promise<void>
  readonly createLook: (characterId: CharacterId, name: string) => Promise<CharacterLook>
  readonly updateLook: (
    id: CharacterLookId,
    patch: UpdateCharacterLookPatch,
  ) => Promise<CharacterLook>
  readonly deleteLook: (look: Pick<CharacterLook, 'id' | 'characterId'>) => Promise<void>
  readonly createLocation: (name: string) => Promise<Location>
  readonly updateLocation: (id: LocationId, patch: UpdateLocationPatch) => Promise<Location>
  readonly deleteLocation: (id: LocationId) => Promise<void>
  readonly createBrandAsset: (
    name: string,
    category: BrandCategory,
    value?: string | null,
  ) => Promise<BrandAsset>
  readonly updateBrandAsset: (id: BrandAssetId, patch: UpdateBrandAssetPatch) => Promise<BrandAsset>
  readonly deleteBrandAsset: (id: BrandAssetId) => Promise<void>
  /** 音声ファイルを上げて楽曲にし、解析を始める。 */
  readonly addTrackFromFile: (file: File) => Promise<MusicTrack>
  readonly updateTrack: (id: MusicTrackId, patch: UpdateMusicTrackPatch) => Promise<MusicTrack>
  readonly setMasterTrack: (id: MusicTrackId) => Promise<void>
  readonly deleteTrack: (id: MusicTrackId) => Promise<void>
  readonly analyzeTrack: (id: MusicTrackId) => Promise<void>
  /**
   * ほかのプロジェクトのものを複製して、このプロジェクトへ取り込む（ADR-0034）。取り込んだ分を一覧に足して返す。
   * Look は足したキャラクターの分を読み直す（キャラクターの並びが変わると読む）。
   */
  readonly importLibrary: (request: LibraryImportRequest) => Promise<WireLibraryImportResult>
}

export type AssetStoreValue = {
  readonly characters: Loaded<readonly Character[]>
  /** キャラクターごとの Look。読めていないキャラクターは入っていない。 */
  readonly looks: ReadonlyMap<CharacterId, readonly CharacterLook[]>
  readonly locations: Loaded<readonly Location[]>
  readonly brandAssets: Loaded<readonly BrandAsset[]>
  readonly tracks: Loaded<readonly MusicTrack[]>
  readonly actions: AssetActions
}

export const AssetStoreContext = createContext<AssetStoreValue | null>(null)

export const useAssets = (): AssetStoreValue => {
  const value = useContext(AssetStoreContext)
  if (value === null) throw new Error('素材の共有状態が AssetStoreProvider の外で使われています')
  return value
}

/** 読めた値だけ。読めていなければ空（**画面の分岐には使わない**。表示は Loaded で分ける）。 */
export const readyOr = <T,>(loaded: Loaded<readonly T[]>): readonly T[] =>
  loaded.state === 'ready' ? loaded.value : []

const mapReady = <T,>(
  loaded: Loaded<readonly T[]>,
  change: (items: readonly T[]) => readonly T[],
): Loaded<readonly T[]> =>
  loaded.state === 'ready' ? { state: 'ready', value: change(loaded.value) } : loaded

const replaceIn = <T extends { readonly id: string }>(
  items: readonly T[],
  next: T,
): readonly T[] =>
  items.some((item) => item.id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next]

/** 何を読むかは `key` で決める。`load` は描画ごとに作り直されるので、最新を控えて呼ぶ。 */
const useLoadedList = <T,>(label: string, load: () => Promise<readonly T[]>, key: string) => {
  const [state, setState] = useState<Loaded<readonly T[]>>({ state: 'loading' })
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    let cancelled = false
    loadRef
      .current()
      .then((value) => {
        if (!cancelled) setState({ state: 'ready', value })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setState({
            state: 'error',
            message: `${label}を読み込めませんでした: ${describeForPerson(cause)}`,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [label, key])
  return [state, setState] as const
}

export type AssetStoreProviderProps = {
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly children: ReactNode
}

export const AssetStoreProvider = ({
  workspaceId,
  projectId,
  children,
}: AssetStoreProviderProps) => {
  const router = useRouter()
  const api = useMemo(() => createApiClient(), [])
  // キャラクター・ロケーション・ブランド資産はプロジェクトごと（ADR-0034。楽曲と同じ）。
  const [characters, setCharacters] = useLoadedList(
    'キャラクター',
    () => api.listCharacters(projectId),
    projectId,
  )
  const [locations, setLocations] = useLoadedList(
    'ロケーション',
    () => api.listLocations(projectId),
    projectId,
  )
  const [brandAssets, setBrandAssets] = useLoadedList(
    'ブランド資産',
    () => api.listBrandAssets(projectId),
    projectId,
  )
  const [tracks, setTracks] = useLoadedList('楽曲', () => api.listMusicTracks(projectId), projectId)
  const [looks, setLooks] = useState<ReadonlyMap<CharacterId, readonly CharacterLook[]>>(new Map())

  /** Look はキャラクターが読めたら一緒に読む（ツリーで子として並べるため）。 */
  const readyCharacters = characters.state === 'ready' ? characters.value : null
  const characterKey = readyCharacters?.map((c) => c.id).join(',') ?? null
  const charactersRef = useRef(readyCharacters)
  charactersRef.current = readyCharacters
  useEffect(() => {
    const list = charactersRef.current
    if (list === null) return undefined
    let cancelled = false
    Promise.all(
      list.map(async (character) => [character.id, await api.listLooks(character.id)] as const),
    )
      .then((entries) => {
        if (!cancelled) setLooks(new Map(entries))
      })
      .catch(() => {
        // Look が読めなくてもツリーは出す。Look の行が出ないだけ（ビューアで読み直せる）。
        if (!cancelled) setLooks(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [api, characterKey])

  const setLooksOf = useCallback(
    (
      characterId: CharacterId,
      change: (items: readonly CharacterLook[]) => readonly CharacterLook[],
    ) => {
      setLooks((current) =>
        new Map(current).set(characterId, change(current.get(characterId) ?? [])),
      )
    },
    [],
  )

  const actions = useMemo<AssetActions>(
    () => ({
      createCharacter: async (displayName) => {
        const created = await api.createCharacter(projectId, { name: displayName, displayName })
        setCharacters((current) => mapReady(current, (items) => [...items, created]))
        return created
      },
      updateCharacter: async (id, patch) => {
        const updated = await api.updateCharacter(id, patch)
        setCharacters((current) => mapReady(current, (items) => replaceIn(items, updated)))
        return updated
      },
      deleteCharacter: async (id) => {
        await api.deleteCharacter(id)
        setCharacters((current) =>
          mapReady(current, (items) => items.filter((item) => item.id !== id)),
        )
      },
      createLook: async (characterId, name) => {
        const existing = (looks.get(characterId) ?? []).map((look) => look.key)
        const created = await api.createLook(characterId, {
          key: lookKeyFromName(name, existing),
          name,
          isDefault: existing.length === 0,
        })
        setLooksOf(characterId, (items) => [...items, created])
        return created
      },
      updateLook: async (id, patch) => {
        const updated = await api.updateLook(id, patch)
        // 既定の Look は 1 つだけ。サーバが他を降格するので、同じキャラクターの Look を読み直す。
        const fresh = await api.listLooks(updated.characterId)
        setLooksOf(updated.characterId, () => fresh)
        return updated
      },
      deleteLook: async (look) => {
        await api.deleteLook(look.id)
        setLooksOf(look.characterId, (items) => items.filter((item) => item.id !== look.id))
      },
      createLocation: async (name) => {
        const created = await api.createLocation(projectId, {
          name,
          description: '',
          referenceAssetIds: [],
        })
        setLocations((current) => mapReady(current, (items) => [...items, created]))
        return created
      },
      updateLocation: async (id, patch) => {
        const updated = await api.updateLocation(id, patch)
        setLocations((current) => mapReady(current, (items) => replaceIn(items, updated)))
        return updated
      },
      deleteLocation: async (id) => {
        await api.deleteLocation(id)
        setLocations((current) =>
          mapReady(current, (items) => items.filter((item) => item.id !== id)),
        )
      },
      createBrandAsset: async (name, category, value = null) => {
        // 色は値が必須（API が 422 を返す）。作るときに一緒に送る。
        const created = await api.createBrandAsset(projectId, {
          name,
          category,
          value,
          usageRule: '',
        })
        setBrandAssets((current) => mapReady(current, (items) => [...items, created]))
        return created
      },
      updateBrandAsset: async (id, patch) => {
        const updated = await api.updateBrandAsset(id, patch)
        setBrandAssets((current) => mapReady(current, (items) => replaceIn(items, updated)))
        return updated
      },
      deleteBrandAsset: async (id) => {
        await api.deleteBrandAsset(id)
        setBrandAssets((current) =>
          mapReady(current, (items) => items.filter((item) => item.id !== id)),
        )
      },
      addTrackFromFile: async (file) => {
        const asset = await api.uploadMedia(file, { workspaceId, projectId, kind: 'audio' })
        const created = await api.createMusicTrack(projectId, {
          mediaAssetId: asset.id,
          title: deriveTrackTitle(file.name),
          isMaster: false,
          offsetSec: 0,
          volume: 1,
        })
        await api.requestAnalysis(created.id)
        // 最初の 1 曲はサーバがマスターにする。一覧ごと読み直して合わせる。
        const fresh = await api.listMusicTracks(projectId)
        setTracks({ state: 'ready', value: fresh })
        router.refresh()
        return created
      },
      updateTrack: async (id, patch) => {
        const updated = await api.updateMusicTrack(id, patch)
        setTracks((current) => mapReady(current, (items) => replaceIn(items, updated)))
        router.refresh()
        return updated
      },
      setMasterTrack: async (id) => {
        const all = await api.setMasterTrack(id)
        setTracks({ state: 'ready', value: all })
        // マスターが変わると拍・尺・吸着の基準が変わる。サーバの材料を読み直す。
        router.refresh()
      },
      deleteTrack: async (id) => {
        await api.deleteMusicTrack(id)
        const fresh = await api.listMusicTracks(projectId)
        setTracks({ state: 'ready', value: fresh })
        router.refresh()
      },
      importLibrary: async (request) => {
        const imported = await api.importLibrary(projectId, request)
        setCharacters((current) => mapReady(current, (items) => [...items, ...imported.characters]))
        setLocations((current) => mapReady(current, (items) => [...items, ...imported.locations]))
        setBrandAssets((current) => mapReady(current, (items) => [...items, ...imported.brandAssets]))
        return imported
      },
      analyzeTrack: async (id) => {
        await api.requestAnalysis(id)
      },
    }),
    [
      api,
      looks,
      projectId,
      router,
      setBrandAssets,
      setCharacters,
      setLocations,
      setLooksOf,
      setTracks,
      workspaceId,
    ],
  )

  const value = useMemo<AssetStoreValue>(
    () => ({ characters, looks, locations, brandAssets, tracks, actions }),
    [characters, looks, locations, brandAssets, tracks, actions],
  )

  return <AssetStoreContext.Provider value={value}>{children}</AssetStoreContext.Provider>
}
