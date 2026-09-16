'use client'

import type { Location, LocationId, MediaAssetId, WorkspaceId } from '@ixa/domain'
import { useState } from 'react'
import { describeViewState } from '@/components/empty-state'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import { ImageUploader } from '@/components/image-uploader'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createLibraryClient, fieldErrorsOf } from '@/lib/library-api'
import { LOCATION_REFERENCE_NOTICE } from '@/lib/location-options'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'

/**
 * ロケーションの管理（P55-9）。
 *
 * 以前は `GET /locations` だけが画面に繋がっていて、**既存の 1 件は API か SQL で
 * 入れたもの**だった。画面から増やせないので、Shot のプルダウンは事実上固定だった。
 *
 * 名前と説明は「保存」で確定し、**参照画像の追加と取り外しはその場で保存する**。
 * 画像は消しても MediaAsset 自体は残るので、取り違えても失われるものが無い。
 */

export type LocationManagerProps = {
  readonly workspaceId: WorkspaceId
  readonly initialLocations: readonly Location[]
  /** 一覧そのものが読めなかったときの説明。0 件と読めなかったを畳まない（lessons L-015）。 */
  readonly loadError?: string
}

const SUBJECT = 'ロケーション'

const client = () => createLibraryClient(resolveApiBaseUrl())

/**
 * 失敗の説明。サーバがフィールド単位の理由を返したならそれを見せる。
 * **規則を画面側へ書き写さない**（lessons L-016）。
 */
const describeFailure = (error: unknown): string => {
  const fields = fieldErrorsOf(error)
  if (fields === null) return describeError(error)
  return Object.entries(fields)
    .map(([field, message]) => `${field}: ${message}`)
    .join(' / ')
}

type NoticeProps = {
  readonly kind: 'empty' | 'unreadable'
  readonly detail?: string
}

/** 「0 件」と「読めなかった」を同じ見た目にしない（lessons L-015）。語彙は `empty-state` に合わせる。 */
const Notice = ({ kind, detail }: NoticeProps) => {
  const state = describeViewState(kind, SUBJECT)
  const tone =
    kind === 'unreadable'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-dashed border-slate-300 bg-white text-slate-600'
  return (
    <p role={state.role} className={`rounded-md border p-4 text-sm ${tone}`}>
      {state.title}
      {detail === undefined ? '' : `: ${detail}`}
    </p>
  )
}

type ReferenceGridProps = {
  readonly assetIds: readonly MediaAssetId[]
  readonly busy: boolean
  readonly onRemove: (assetId: MediaAssetId) => void
}

const ReferenceGrid = ({ assetIds, busy, onRemove }: ReferenceGridProps) =>
  assetIds.length === 0 ? (
    <p className="text-sm text-slate-600">
      参照画像がありません。登録すると、この場所を選んだ Shot の生成に自動で渡ります。
    </p>
  ) : (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {assetIds.map((assetId) => (
        <li key={assetId} className="space-y-2">
          <MediaImage mediaAssetId={assetId} alt="ロケーションの参照画像" />
          {/*
            **確認を挟まない。** 外れるのは関連づけだけで、画像そのものは残り、
            同じ画像をすぐ付け直せる。取り消せる操作に danger の見た目を使わない
            （`components/ui/button` の tone の選び方）。
          */}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              onRemove(assetId)
            }}
          >
            {WORDING.unlink}
          </Button>
        </li>
      ))}
    </ul>
  )

type LocationCardProps = {
  readonly location: Location
  readonly workspaceId: WorkspaceId
  readonly onChanged: (location: Location) => void
  readonly onRemoved: (id: LocationId) => void
}

const LocationCard = ({ location, workspaceId, onChanged, onRemoved }: LocationCardProps) => {
  const [name, setName] = useState(location.name)
  const [description, setDescription] = useState(location.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const run = async (label: string, task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await task()
      setNotice(`${label}しました`)
    } catch (cause) {
      setError(`${label}できませんでした: ${describeFailure(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const saveText = (): void => {
    void run(WORDING.save, async () => {
      onChanged(await client().updateLocation(location.id, { name: name.trim(), description }))
    })
  }

  const saveReferences = (assetIds: readonly MediaAssetId[], label: string): Promise<void> =>
    run(label, async () => {
      onChanged(
        await client().updateLocation(location.id, { referenceAssetIds: [...assetIds] }),
      )
    })

  const unchanged = name === location.name && description === location.description

  return (
    <li className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <TextField
        id={`location-name-${location.id}`}
        label="名前"
        value={name}
        disabled={busy}
        onChange={setName}
      />
      <TextareaField
        id={`location-description-${location.id}`}
        label="説明"
        value={description}
        rows={2}
        placeholder="ナイター照明、観客席は空"
        disabled={busy}
        onChange={setDescription}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button tone="primary" size="sm" disabled={busy || unchanged} onClick={saveText}>
          {busy ? '保存中…' : WORDING.save}
        </Button>
        <ConfirmButton
          size="sm"
          label={`${WORDING.delete}（ロケーション）`}
          message={deleteConfirmMessage(`ロケーション「${location.name}」`)}
          disabled={busy}
          onConfirm={() => {
            void run(WORDING.delete, async () => {
              await client().deleteLocation(location.id)
              onRemoved(location.id)
            })
          }}
        >
          <p className="mt-2 text-sm text-rose-900">
            この場所を選んでいる Shot からは外れます。参照画像そのものは残ります。
          </p>
        </ConfirmButton>
      </div>

      <div className="space-y-3 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">参照画像</h3>
        <ReferenceGrid
          assetIds={location.referenceAssetIds}
          busy={busy}
          onRemove={(assetId) => {
            void saveReferences(
              location.referenceAssetIds.filter((id) => id !== assetId),
              WORDING.unlink,
            )
          }}
        />
        <ImageUploader
          id={`location-upload-${location.id}`}
          workspaceId={workspaceId}
          submitLabel="参照画像を追加"
          disabled={busy}
          onUploaded={async (assetId) => {
            await saveReferences([...location.referenceAssetIds, assetId], '追加')
          }}
        />
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {error === null && notice !== null && (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      )}
    </li>
  )
}

type CreateFormProps = {
  readonly workspaceId: WorkspaceId
  readonly onCreated: (location: Location) => void
}

const CreateForm = ({ workspaceId, onCreated }: CreateFormProps) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const created = await client().createLocation({
        workspaceId,
        name: name.trim(),
        description,
        referenceAssetIds: [],
      })
      onCreated(created)
      setName('')
      setDescription('')
    } catch (cause) {
      setError(`作成できませんでした: ${describeFailure(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      className="space-y-4 rounded-lg border border-dashed border-slate-300 bg-white p-6"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h3 className="text-sm font-semibold text-slate-900">ロケーションを追加</h3>
      <TextField
        id="new-location-name"
        label="名前"
        value={name}
        placeholder="iXA CUP 会場"
        disabled={busy}
        onChange={setName}
      />
      <TextareaField
        id="new-location-description"
        label="説明"
        value={description}
        rows={2}
        disabled={busy}
        onChange={setDescription}
      />
      <p className="text-xs text-slate-600">参照画像は作成したあとで追加します。</p>
      {error !== null && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      <Button tone="primary" type="submit" disabled={busy || name.trim() === ''}>
        {busy ? '作成中…' : '追加'}
      </Button>
    </form>
  )
}

export const LocationManager = ({
  workspaceId,
  initialLocations,
  loadError,
}: LocationManagerProps) => {
  const [locations, setLocations] = useState<readonly Location[]>(initialLocations)

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{SUBJECT}</h2>
        <p className="mt-1 text-sm text-slate-600">{LOCATION_REFERENCE_NOTICE}</p>
      </div>

      {loadError !== undefined && <Notice kind="unreadable" detail={loadError} />}
      {loadError === undefined && locations.length === 0 && <Notice kind="empty" />}

      {locations.length > 0 && (
        <ul className="space-y-4">
          {locations.map((location) => (
            <LocationCard
              key={location.id}
              location={location}
              workspaceId={workspaceId}
              onChanged={(updated) => {
                setLocations((current) =>
                  current.map((item) => (item.id === updated.id ? updated : item)),
                )
              }}
              onRemoved={(id) => {
                setLocations((current) => current.filter((item) => item.id !== id))
              }}
            />
          ))}
        </ul>
      )}

      <CreateForm
        workspaceId={workspaceId}
        onCreated={(created) => {
          setLocations((current) => [...current, created])
        }}
      />
    </section>
  )
}
