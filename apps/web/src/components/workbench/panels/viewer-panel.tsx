'use client'

import type {
  BrandAsset,
  CharacterId,
  CharacterLookId,
  CharacterLookImage,
  Location,
  MediaAssetId,
  MusicTrackId,
} from '@ixa/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { MediaImage } from '@/components/media-image'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { useAssets } from '@/components/workbench/asset-store'
import { acceptsImages, useImageAttach } from '@/components/workbench/use-image-attach'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty, PanelFrame, PanelNotice } from '@/components/workbench/panels/panel-frame'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { droppedFileKind } from '@/lib/asset-actions'
import { identityRoleLabel } from '@/lib/identity-images'
import { lookRoleLabel } from '@/lib/look-images'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { fetchWaveformPeaks, type WaveformPeaksResult } from '@/lib/waveform-api'
import { sectionBoundaries } from '@/lib/waveform-draw'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'
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
          <div className="px-1.5 py-1 text-xs text-muted">
            <span className="block truncate">{item.caption}</span>
            {/* 確認は同じカードの中に開く。押した画像と確認文が離れると、別の画像を消す。 */}
            {item.actions !== undefined && (
              <div className="mt-1 flex flex-wrap items-center gap-1">{item.actions}</div>
            )}
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

type ActionStatus = { readonly tone: 'info' | 'danger'; readonly text: string }

/**
 * 画像に対する操作の進み具合と失敗を出す。**`ImageDrop` の `status` と同じ作法**で、
 * 新しい仕組みは作らない。
 *
 * 大事なのは失敗したときで、**一覧には何もしない**（読み直しは成功したときだけ）。
 * 以前は `.catch` が無く、通信が落ちると unhandled rejection になって画面は無反応だった。
 * 利用者は消えたのか分からず押し直し、実は成功していた場合に 2 枚目を消していた。
 * 文面は `describeForPerson` を通す（`describeError` は URL とレスポンス本文をそのまま出す）。
 */
const useActionStatus = () => {
  const [status, setStatus] = useState<ActionStatus | null>(null)
  const run = useCallback(
    (
      labels: { readonly pending: string; readonly failed: string },
      action: () => Promise<unknown>,
      onDone: () => void,
    ): void => {
      setStatus({ tone: 'info', text: labels.pending })
      action()
        .then(() => {
          setStatus(null)
          onDone()
        })
        .catch((cause: unknown) => {
          setStatus({ tone: 'danger', text: `${labels.failed}: ${describeForPerson(cause)}` })
        })
    },
    [],
  )
  return { status, run }
}

const ActionNotice = ({ status }: { readonly status: ActionStatus | null }) =>
  status === null ? null : <PanelNotice tone={status.tone}>{status.text}</PanelNotice>

const CharacterView = ({ characterId }: { readonly characterId: CharacterId }) => {
  const api = useMemo(() => createApiClient(), [])
  const { looks, characters } = useAssets()
  const character = (characters.state === 'ready' ? characters.value : []).find(
    (c) => c.id === characterId,
  )
  const images = useReloadable(() => api.listIdentityImages(characterId), characterId)
  const action = useActionStatus()

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
        <ActionNotice status={action.status} />
        <Gallery
          items={(images.data ?? []).map((image) => {
            // 文面は旧画面（`identity-image-grid.tsx`）と同じにする。
            // 主画像を消すとその role の参照が無くなるので、そこまで書く。
            const roleLabel = identityRoleLabel(image.role)
            const target = image.isPrimary ? `${roleLabel} の主画像` : `${roleLabel} の画像`
            return {
              key: image.id,
              mediaAssetId: image.mediaAssetId,
              caption: `${roleLabel}${image.isPrimary ? '・主' : ''}`,
              marked: image.isPrimary,
              actions: (
                <>
                  {!image.isPrimary && (
                    <button
                      type="button"
                      className="underline hover:text-text"
                      onClick={() => {
                        action.run(
                          { pending: '主にしています…', failed: '主にできませんでした' },
                          () => api.setPrimaryIdentityImage(image.id),
                          images.reload,
                        )
                      }}
                    >
                      主にする
                    </button>
                  )}
                  <ConfirmButton
                    size="sm"
                    label={`${WORDING.delete}（${roleLabel}）`}
                    message={deleteConfirmMessage(target)}
                    onConfirm={() => {
                      action.run(
                        {
                          pending: `${target}を削除しています…`,
                          failed: `${target}を削除できませんでした`,
                        },
                        () => api.removeIdentityImage(image.id),
                        images.reload,
                      )
                    }}
                  />
                </>
              ),
            }
          })}
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
  const action = useActionStatus()
  return (
    <>
      {images.error !== null && (
        <PanelNotice tone="danger">{`Look の画像を読めません: ${images.error}`}</PanelNotice>
      )}
      <ActionNotice status={action.status} />
      <Gallery
        items={(images.data ?? []).map((image) => {
          // 文面は旧画面（`look-image-grid.tsx`）と同じ。
          // canonical frame かどうかはここでは分からないので、それを名乗らない。
          const roleLabel = lookRoleLabel(image.role)
          const target = `${roleLabel} の画像`
          return {
            key: image.id,
            mediaAssetId: image.mediaAssetId,
            caption: roleLabel,
            marked: image.isPrimary,
            actions: (
              <ConfirmButton
                size="sm"
                label={`${WORDING.delete}（${roleLabel}）`}
                message={deleteConfirmMessage(target)}
                onConfirm={() => {
                  action.run(
                    {
                      pending: `${target}を削除しています…`,
                      failed: `${target}を削除できませんでした`,
                    },
                    () => api.removeLookImage(image.id),
                    images.reload,
                  )
                }}
              />
            ),
          }
        })}
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
  const action = useActionStatus()
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
        <ActionNotice status={action.status} />
        <Gallery
          items={location.referenceAssetIds.map((assetId, index) => {
            /**
             * ここだけは実体が**解除**。`referenceAssetIds` から 1 件抜くだけで、
             * MediaAsset も他のロケーションからの参照も残る
             * （`packages/domain/src/asset/library.ts` の `Location`）。
             * だから「削除」とも「元に戻せません」とも言わない。
             */
            const target = `参照 ${String(index + 1)}`
            return {
              key: `${assetId}-${String(index)}`,
              mediaAssetId: assetId,
              caption: target,
              actions: (
                <ConfirmButton
                  size="sm"
                  label={`${WORDING.unlink}（${target}）`}
                  message={`${target}をこのロケーションから${WORDING.unlink}します。画像そのものは消えません。`}
                  confirmLabel={WORDING.unlink}
                  onConfirm={() => {
                    action.run(
                      {
                        pending: `${target}を${WORDING.unlink}しています…`,
                        failed: `${target}を${WORDING.unlink}できませんでした`,
                      },
                      () =>
                        actions.updateLocation(location.id, {
                          referenceAssetIds: location.referenceAssetIds.filter(
                            (_, i) => i !== index,
                          ),
                        }),
                      () => undefined,
                    )
                  }}
                />
              ),
            }
          })}
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
