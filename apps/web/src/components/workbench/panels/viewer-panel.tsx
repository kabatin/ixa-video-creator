'use client'

import type {
  BrandAsset,
  CharacterId,
  CharacterIdentityImage,
  CharacterLookId,
  CharacterLookImage,
  Location,
  MediaAssetId,
  MusicTrackId,
} from '@ixa/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { MediaImage } from '@/components/media-image'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { useAssets } from '@/components/workbench/asset-store'
import { acceptsImages, useImageAttach } from '@/components/workbench/use-image-attach'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { droppedFileKind } from '@/lib/asset-actions'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { fetchWaveformPeaks, type WaveformPeaksResult } from '@/lib/waveform-api'
import { sectionBoundaries } from '@/lib/waveform-draw'
import { INSPECTED_LABELS, isAssetSelection } from '@/lib/workbench-selection'

/**
 * 素材ビューア（中央上。UI-WORKBENCH-2 §4.3）。**見る場所。フォームを置かない。**
 * 直すのは右のインスペクター。旧ページを箱に入れた素材ごとのタブをやめて、この 1 枚にした。
 * 画像はここへ落として足す（その素材に入る）。
 */
export const ViewerPanel = () => {
  const { inspected } = useWorkbench()
  if (!isAssetSelection(inspected)) {
    return (
      <PanelFrame>
        <PanelEmpty
          title="素材を選ぶと、ここに大きく出ます"
          hint="左の素材ツリーで押すと選び、2 回押すとここに出ます。画像はここへ落とすと、その素材に入ります。"
        />
      </PanelFrame>
    )
  }
  return (
    <PanelFrame toolbar={<span className="text-muted">{INSPECTED_LABELS[inspected.kind]}</span>}>
      {inspected.kind === 'character' && <CharacterView characterId={inspected.id} />}
      {inspected.kind === 'look' && <LookView lookId={inspected.id} />}
      {inspected.kind === 'location' && <LocationView id={inspected.id} />}
      {inspected.kind === 'brand-asset' && <BrandAssetView id={inspected.id} />}
      {inspected.kind === 'track' && <TrackView id={inspected.id} />}
    </PanelFrame>
  )
}

/** 画像を落として足せる区画。落としたらこの素材に入れ、呼び出し側に読み直させる。 */
const ImageDrop = ({
  onAdded,
  children,
}: {
  readonly onAdded: () => void
  readonly children: ReactNode
}) => {
  const { inspected } = useWorkbench()
  const attach = useImageAttach()
  const [over, setOver] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    setOver(false)
    const images = [...event.dataTransfer.files].filter((file) => droppedFileKind(file) === 'image')
    if (images.length === 0 || !acceptsImages(inspected)) return
    // ここで受けたら、画面全体の取り込み（行き先を聞く）へは流さない。
    event.preventDefault()
    setStatus(`${String(images.length)} 枚を取り込んでいます…`)
    attach(inspected, images)
      .then(() => {
        setStatus(null)
        onAdded()
      })
      .catch((cause: unknown) => {
        setStatus(`取り込めませんでした: ${describeForPerson(cause)}`)
      })
  }

  return (
    <div
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => {
        setOver(false)
      }}
      onDrop={onDrop}
      className={`rounded-md border-2 border-dashed p-2 ${over ? 'border-accent bg-accent/5' : 'border-transparent'}`}
    >
      {status !== null && (
        <PanelNotice tone={status.startsWith('取り込めません') ? 'danger' : 'info'}>
          {status}
        </PanelNotice>
      )}
      {children}
      <p className="mt-2 text-xs text-muted">画像をここへ落とすと、この素材に入ります。</p>
    </div>
  )
}

const Gallery = ({
  items,
}: {
  readonly items: readonly {
    readonly key: string
    readonly mediaAssetId: MediaAssetId
    readonly caption: string
    readonly marked?: boolean
    readonly actions?: ReactNode
  }[]
}) =>
  items.length === 0 ? (
    <p className="py-6 text-center text-sm text-muted">画像はまだありません。</p>
  ) : (
    <ul
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))' }}
    >
      {items.map((item) => (
        <li
          key={item.key}
          className={`overflow-hidden rounded-md border ${item.marked === true ? 'border-accent' : 'border-line'}`}
        >
          <MediaImage
            mediaAssetId={item.mediaAssetId}
            alt={item.caption}
            className="aspect-square w-full object-cover"
          />
          <div className="flex items-center gap-1 px-1.5 py-1 text-xs text-muted">
            <span className="min-w-0 flex-1 truncate">{item.caption}</span>
            {item.actions}
          </div>
        </li>
      ))}
    </ul>
  )

/** 読み直しの合図を持つ読み込み。 */
const useReloadable = <T,>(load: () => Promise<T>, key: string) => {
  const [value, setValue] = useState<{ readonly data: T | null; readonly error: string | null }>({
    data: null,
    error: null,
  })
  const [epoch, setEpoch] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    let cancelled = false
    loadRef
      .current()
      .then((data) => {
        if (!cancelled) setValue({ data, error: null })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setValue({ data: null, error: describeForPerson(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [key, epoch])
  const reload = useCallback(() => {
    setEpoch((current) => current + 1)
  }, [])
  return { ...value, reload }
}

const IDENTITY_ROLE_LABELS: Readonly<Record<CharacterIdentityImage['role'], string>> = {
  four_view: '四面図',
  face_front: '顔（正面）',
  face_side: '顔（横）',
  face_three_quarter: '顔（斜め）',
  full_body: '全身',
  profile: 'プロフィール',
}

const CharacterView = ({ characterId }: { readonly characterId: CharacterId }) => {
  const api = useMemo(() => createApiClient(), [])
  const { looks, characters } = useAssets()
  const character = (characters.state === 'ready' ? characters.value : []).find(
    (c) => c.id === characterId,
  )
  const images = useReloadable(() => api.listIdentityImages(characterId), characterId)

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-text">
        {character?.displayName ?? 'キャラクター'}
      </h2>
      <ImageDrop onAdded={images.reload}>
        <h3 className="mb-1 text-xs font-semibold text-muted">識別画像（同一性）</h3>
        {images.error !== null && (
          <PanelNotice tone="danger">{`識別画像を読めません: ${images.error}`}</PanelNotice>
        )}
        <Gallery
          items={(images.data ?? []).map((image) => ({
            key: image.id,
            mediaAssetId: image.mediaAssetId,
            caption: `${IDENTITY_ROLE_LABELS[image.role]}${image.isPrimary ? '・主' : ''}`,
            marked: image.isPrimary,
            actions: (
              <>
                {!image.isPrimary && (
                  <button
                    type="button"
                    className="underline hover:text-text"
                    onClick={() => {
                      void api.setPrimaryIdentityImage(image.id).then(images.reload)
                    }}
                  >
                    主にする
                  </button>
                )}
                <button
                  type="button"
                  aria-label="この画像を外す"
                  className="hover:text-danger"
                  onClick={() => {
                    void api.removeIdentityImage(image.id).then(images.reload)
                  }}
                >
                  ✕
                </button>
              </>
            ),
          }))}
        />
      </ImageDrop>
      {(looks.get(characterId) ?? []).map((look) => (
        <section key={look.id}>
          <h3 className="mb-1 text-xs font-semibold text-muted">
            Look: {look.name}
            {look.isDefault ? '（既定）' : ''}
          </h3>
          <LookImages lookId={look.id} />
        </section>
      ))}
    </div>
  )
}

const LookImages = ({ lookId }: { readonly lookId: CharacterLookId }) => {
  const api = useMemo(() => createApiClient(), [])
  const images = useReloadable<readonly CharacterLookImage[]>(
    () => api.listLookImages(lookId),
    lookId,
  )
  return (
    <>
      {images.error !== null && (
        <PanelNotice tone="danger">{`Look の画像を読めません: ${images.error}`}</PanelNotice>
      )}
      <Gallery
        items={(images.data ?? []).map((image) => ({
          key: image.id,
          mediaAssetId: image.mediaAssetId,
          caption: image.role,
          marked: image.isPrimary,
          actions: (
            <button
              type="button"
              aria-label="この画像を外す"
              className="hover:text-danger"
              onClick={() => {
                void api.removeLookImage(image.id).then(images.reload)
              }}
            >
              ✕
            </button>
          ),
        }))}
      />
    </>
  )
}

const LookView = ({ lookId }: { readonly lookId: CharacterLookId }) => {
  const [epoch, setEpoch] = useState(0)
  return (
    <ImageDrop
      onAdded={() => {
        setEpoch((current) => current + 1)
      }}
    >
      <LookImages key={epoch} lookId={lookId} />
    </ImageDrop>
  )
}

const LocationView = ({ id }: { readonly id: Location['id'] }) => {
  const { locations, actions } = useAssets()
  const location = (locations.state === 'ready' ? locations.value : []).find(
    (item) => item.id === id,
  )
  if (location === undefined) return <PanelEmpty title="このロケーションは見つかりません" />
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-text">{location.name}</h2>
      {location.description !== '' && <p className="text-sm text-muted">{location.description}</p>}
      <ImageDrop onAdded={() => undefined}>
        <h3 className="mb-1 text-xs font-semibold text-muted">参照画像（Shot の生成に渡る）</h3>
        <Gallery
          items={location.referenceAssetIds.map((assetId, index) => ({
            key: `${assetId}-${String(index)}`,
            mediaAssetId: assetId,
            caption: `参照 ${String(index + 1)}`,
            actions: (
              <button
                type="button"
                aria-label="この画像を外す"
                className="hover:text-danger"
                onClick={() => {
                  void actions.updateLocation(location.id, {
                    referenceAssetIds: location.referenceAssetIds.filter((_, i) => i !== index),
                  })
                }}
              >
                ✕
              </button>
            ),
          }))}
        />
      </ImageDrop>
    </div>
  )
}

/** 色の見本。白地と黒地の両方で文字が読めるかを添える（ブランドの色は両方に置かれる）。 */
const contrastWith = (hex: string, against: 'white' | 'black'): number => {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const n = Number.parseInt(hex.slice(1), 16)
  const lum =
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  const other = against === 'white' ? 1 : 0
  return (Math.max(lum, other) + 0.05) / (Math.min(lum, other) + 0.05)
}

const BrandAssetView = ({ id }: { readonly id: BrandAsset['id'] }) => {
  const { brandAssets } = useAssets()
  const asset = (brandAssets.state === 'ready' ? brandAssets.value : []).find(
    (item) => item.id === id,
  )
  if (asset === undefined) return <PanelEmpty title="このブランド資産は見つかりません" />
  const isHex = asset.value !== null && /^#[0-9a-f]{6}$/i.test(asset.value)
  return (
    <ImageDrop onAdded={() => undefined}>
      <h2 className="text-lg font-semibold text-text">{asset.name}</h2>
      {asset.category === 'color' && isHex && asset.value !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <div
            className="h-40 w-64 rounded-md border border-line"
            style={{ background: asset.value }}
          />
          <dl className="text-sm text-text">
            <dt className="text-xs text-muted">値</dt>
            <dd className="font-mono">{asset.value}</dd>
            <dt className="mt-2 text-xs text-muted">白地との比 / 黒地との比</dt>
            <dd className="tabular-nums">
              {contrastWith(asset.value, 'white').toFixed(2)} : 1 /{' '}
              {contrastWith(asset.value, 'black').toFixed(2)} : 1
            </dd>
          </dl>
        </div>
      )}
      {asset.mediaAssetId !== null && (
        <div className="mt-2 max-w-md">
          <MediaImage
            mediaAssetId={asset.mediaAssetId}
            alt={asset.name}
            className="w-full rounded-md object-contain"
          />
        </div>
      )}
      {asset.mediaAssetId === null && !(asset.category === 'color' && isHex) && (
        <p className="py-6 text-center text-sm text-muted">画像も色の値もまだありません。</p>
      )}
      {asset.usageRule !== '' && (
        <p className="mt-2 text-sm text-muted">使い方: {asset.usageRule}</p>
      )}
    </ImageDrop>
  )
}

const TrackView = ({ id }: { readonly id: MusicTrackId }) => {
  const api = useMemo(() => createApiClient(), [])
  const { tracks } = useAssets()
  const track = (tracks.state === 'ready' ? tracks.value : []).find((item) => item.id === id)
  const [analysis, setAnalysis] = useState<WireMusicAnalysis | null | 'loading'>('loading')
  const [peaks, setPeaks] = useState<WaveformPeaksResult>({ status: 'empty' })

  useEffect(() => {
    let cancelled = false
    setAnalysis('loading')
    api
      .getAnalysis(id)
      .then(async (loaded) => {
        if (cancelled) return
        setAnalysis(loaded)
        if (loaded !== null) {
          const result = await fetchWaveformPeaks(loaded.waveformPeaksUrl)
          if (!cancelled) setPeaks(result)
        }
      })
      .catch(() => {
        if (!cancelled) setAnalysis(null)
      })
    return () => {
      cancelled = true
    }
  }, [api, id])

  if (track === undefined) return <PanelEmpty title="この楽曲は見つかりません" />
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-text">
        {track.title}
        {track.isMaster && <span className="ml-2 text-xs text-muted">マスター</span>}
      </h2>
      {analysis === 'loading' && <p className="text-sm text-muted">解析を読み込んでいます…</p>}
      {analysis === null && (
        <p className="text-sm text-muted">
          まだ解析されていません。右のインスペクターから解析できます。
        </p>
      )}
      {analysis !== null && analysis !== 'loading' && (
        <>
          <WaveformCanvas
            peaks={peaks}
            durationSec={analysis.durationSec}
            beats={analysis.beats}
            downbeats={analysis.downbeats}
            drops={analysis.drops}
            sectionBoundarySec={sectionBoundaries(analysis.sections)}
            heightPx={120}
          />
          <p className="text-sm text-muted">
            {`BPM ${analysis.bpm.toFixed(1)}（信頼度 ${analysis.bpmConfidence.toFixed(2)}）・拍 ${String(analysis.beats.length)}・小節 ${String(analysis.downbeats.length)}・セクション ${String(analysis.sections.length)}・ドロップ ${String(analysis.drops.length)}`}
          </p>
        </>
      )}
    </div>
  )
}
