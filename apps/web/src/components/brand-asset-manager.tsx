'use client'

import { useRouter } from 'next/navigation'

import { BrandCategory, type BrandAsset, type WorkspaceId } from '@ixa/domain'
import { useState } from 'react'
import { describeViewState } from '@/components/empty-state'
import { FieldError } from '@/components/form/field-error'
import { SelectField, type SelectOption } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import { ImageUploader } from '@/components/image-uploader'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import {
  EMPTY_BRAND_ASSET_VALUES,
  brandAssetValuesOf,
  createLibraryClient,
  fieldErrorsOf,
  toBrandAssetInput,
  type BrandAssetValues,
} from '@/lib/library-api'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'

/**
 * ブランド資産の管理（P55-9）。
 *
 * **ここが空だと brand レビュアが何も判定できない。** `apps/worker/src/review-wiring.ts` は
 * `category='color'` の資産からブランド色を読む。登録する画面が無かったため、
 * brand レビュアは常に skip していた。
 *
 * **組み合わせの規則（どの種類で値が要るか・画像が要るか、色の形式）を
 * ここへ書き写さないこと**（lessons L-016）。正は `apps/api/src/routes/assets.ts` の
 * `brandAssetFieldErrors` で、違反は 422 の `fields` として返る。画面はそれを出すだけ。
 */

export type BrandAssetManagerProps = {
  readonly workspaceId: WorkspaceId
  readonly initialAssets: readonly BrandAsset[]
  /** 一覧そのものが読めなかったときの説明。0 件と読めなかったを畳まない（lessons L-015）。 */
  readonly loadError?: string
}

const SUBJECT = 'ブランド資産'

const CATEGORY_LABELS: Readonly<Record<BrandCategory, string>> = Object.freeze({
  logo: 'ロゴ',
  color: '色',
  font: 'フォント',
  uniform: 'ユニフォーム',
  typography: 'タイポグラフィ',
  texture: 'テクスチャ',
  other: 'その他',
})

const CATEGORY_OPTIONS: readonly SelectOption[] = BrandCategory.options.map((category) => ({
  value: category,
  label: CATEGORY_LABELS[category],
}))

type BrandField = 'category' | 'name' | 'value' | 'mediaAssetId' | 'usageRule' | 'form'

type BrandErrors = Readonly<Partial<Record<BrandField, string>>>

/** サーバが返す列名 → この画面のフィールド。知らない列は form へ落とす。 */
const FIELD_BY_COLUMN: Readonly<Record<string, BrandField>> = Object.freeze({
  category: 'category',
  name: 'name',
  value: 'value',
  mediaAssetId: 'mediaAssetId',
  usageRule: 'usageRule',
})

/** サーバの判定結果をフィールド単位のエラーへ戻す。規則そのものは持たない。 */
const errorsFromServer = (error: unknown, action: string): BrandErrors => {
  const fields = fieldErrorsOf(error)
  if (fields === null) return { form: `${action}できませんでした: ${describeError(error)}` }

  return Object.entries(fields).reduce<BrandErrors>((acc, [column, message]) => {
    const field = FIELD_BY_COLUMN[column] ?? 'form'
    return field in acc ? acc : { ...acc, [field]: message }
  }, {})
}

const client = () => createLibraryClient(resolveApiBaseUrl())

/**
 * 色見本の既定値。
 *
 * **これは検証ではない。** `<input type="color">` は `#rrggbb` 以外を表示できないため、
 * 読めない文字列のときに見本へ渡す値を決めているだけ。受理・却下はサーバが決める。
 */
const swatchValue = (raw: string): string =>
  /^#[0-9A-Fa-f]{6}$/u.test(raw.trim()) ? raw.trim() : '#000000'

type FieldsProps = {
  readonly idPrefix: string
  readonly values: BrandAssetValues
  readonly errors: BrandErrors
  readonly workspaceId: WorkspaceId
  readonly busy: boolean
  readonly onChange: (patch: Partial<BrandAssetValues>) => void
}

const BrandAssetFields = ({ idPrefix, values, errors, workspaceId, busy, onChange }: FieldsProps) => (
  <>
    <div className="grid gap-5 sm:grid-cols-2">
      <SelectField
        id={`${idPrefix}-category`}
        label="種類"
        value={values.category}
        options={CATEGORY_OPTIONS}
        disabled={busy}
        error={errors.category}
        onChange={(category) => {
          onChange({ category })
        }}
      />
      <TextField
        id={`${idPrefix}-name`}
        label="名前"
        value={values.name}
        placeholder="iXA Yellow"
        disabled={busy}
        error={errors.name}
        onChange={(name) => {
          onChange({ name })
        }}
      />
    </div>

    <div className="flex items-end gap-3">
      <div className="flex-1">
        <TextField
          id={`${idPrefix}-value`}
          label="値（色は #FFD200 の形式）"
          value={values.value}
          placeholder="#FFD200"
          disabled={busy}
          error={errors.value}
          onChange={(value) => {
            onChange({ value })
          }}
        />
      </div>
      <input
        type="color"
        aria-label="色を選ぶ"
        value={swatchValue(values.value)}
        disabled={busy}
        onChange={(event) => {
          onChange({ value: event.target.value })
        }}
        className="mb-1 h-10 w-12 cursor-pointer rounded-md border border-line-strong bg-surface p-1 disabled:cursor-not-allowed"
      />
    </div>

    <div className="space-y-2">
      <span className="block text-sm font-medium text-text">画像</span>
      {values.mediaAssetId === null ? (
        <p className="text-sm text-muted">画像は未設定です。</p>
      ) : (
        <div className="flex items-end gap-3">
          <div className="w-32">
            <MediaImage mediaAssetId={values.mediaAssetId} alt={`${SUBJECT}の画像`} />
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              onChange({ mediaAssetId: null })
            }}
          >
            画像を{WORDING.unlink}
          </Button>
        </div>
      )}
      <ImageUploader
        id={`${idPrefix}-upload`}
        workspaceId={workspaceId}
        submitLabel="画像を設定"
        disabled={busy}
        onUploaded={(mediaAssetId) => {
          onChange({ mediaAssetId })
          return Promise.resolve()
        }}
      />
      <FieldError id={`${idPrefix}-media-error`} message={errors.mediaAssetId} />
      <p className="text-xs text-muted">
        値と画像のどちらが要るかは種類によって変わります。足りなければ保存時に理由が出ます。
      </p>
    </div>

    <TextareaField
      id={`${idPrefix}-usage-rule`}
      label="使い方の規則（レビューがそのまま読みます）"
      value={values.usageRule}
      rows={2}
      placeholder="ロゴは左上、最小マージン 40px"
      disabled={busy}
      error={errors.usageRule}
      onChange={(usageRule) => {
        onChange({ usageRule })
      }}
    />
  </>
)

type BrandAssetFormProps = {
  readonly idPrefix: string
  readonly initial: BrandAssetValues
  readonly workspaceId: WorkspaceId
  readonly submitLabel: string
  readonly actionName: string
  /** 成功したら、そのあとフォームに残す値を返す。 */
  readonly onSubmit: (values: BrandAssetValues) => Promise<BrandAssetValues>
  /** 削除できるものだけが渡す。作成フォームには無い。 */
  readonly deletion?: { readonly name: string; readonly run: () => Promise<void> }
}

/**
 * 作成と編集で同じ入力欄・同じ失敗の出し方を使う。
 * 2 つに分けると、片方だけ検証結果の出し方が古くなる。
 */
const BrandAssetForm = ({
  idPrefix,
  initial,
  workspaceId,
  submitLabel,
  actionName,
  onSubmit,
  deletion,
}: BrandAssetFormProps) => {
  const router = useRouter()
  const [values, setValues] = useState<BrandAssetValues>(initial)
  const [errors, setErrors] = useState<BrandErrors>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  /** 保存も削除も同じ経路を通す。失敗を握り潰さず、必ずどちらかの表示に落とす。 */
  const act = async (label: string, task: () => Promise<void>): Promise<void> => {
    setErrors({})
    setBusy(true)
    setNotice(null)
    try {
      await task()
      setNotice(`${label}しました`)
      // 他の画面の先読み内容を捨てる（music-panel.tsx の説明を参照）。
      // ブランド色はレビューの色判定が読むので、登録したら他の画面にも効かせる。
      router.refresh()
    } catch (error) {
      setErrors(errorsFromServer(error, label))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void act(actionName, async () => {
          setValues(await onSubmit(values))
        })
      }}
    >
      <BrandAssetFields
        idPrefix={idPrefix}
        values={values}
        errors={errors}
        workspaceId={workspaceId}
        busy={busy}
        onChange={(patch) => {
          setValues((current) => ({ ...current, ...patch }))
        }}
      />

      <FieldError id={`${idPrefix}-error`} message={errors.form} />

      <div className="flex flex-wrap items-center gap-3">
        <Button tone="primary" size="sm" type="submit" disabled={busy || values.name.trim() === ''}>
          {busy ? `${actionName}中…` : submitLabel}
        </Button>
        {deletion !== undefined && (
          <ConfirmButton
            size="sm"
            label={`${WORDING.delete}（${SUBJECT}）`}
            message={deleteConfirmMessage(`${SUBJECT}「${deletion.name}」`)}
            disabled={busy}
            onConfirm={() => {
              void act(WORDING.delete, deletion.run)
            }}
          >
            <p className="mt-2 text-sm text-danger">
              レビューがこの資産を参照しなくなります。画像そのものは残ります。
            </p>
          </ConfirmButton>
        )}
        {notice !== null && (
          <span role="status" className="text-sm text-ok">
            {notice}
          </span>
        )}
      </div>
    </form>
  )
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
      ? 'border-danger/40 bg-danger/10 text-danger'
      : 'border-dashed border-line-strong bg-surface text-muted'
  return (
    <p role={state.role} className={`rounded-md border p-4 text-sm ${tone}`}>
      {state.title}
      {detail === undefined ? '' : `: ${detail}`}
    </p>
  )
}

export const BrandAssetManager = ({
  workspaceId,
  initialAssets,
  loadError,
}: BrandAssetManagerProps) => {
  const [assets, setAssets] = useState<readonly BrandAsset[]>(initialAssets)

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text">{SUBJECT}</h2>
        <p className="mt-1 text-sm text-muted">
          レビューがここを読みます。色を 1 件も登録していないと、ブランドの検査は判定できません。
        </p>
      </div>

      {loadError !== undefined && <Notice kind="unreadable" detail={loadError} />}
      {loadError === undefined && assets.length === 0 && <Notice kind="empty" />}

      {assets.length > 0 && (
        <ul className="space-y-4">
          {assets.map((asset) => (
            <li key={asset.id} className="rounded-lg border border-line bg-surface p-6 shadow-sm">
              <BrandAssetForm
                idPrefix={`brand-${asset.id}`}
                initial={brandAssetValuesOf(asset)}
                workspaceId={workspaceId}
                submitLabel={WORDING.save}
                actionName={WORDING.save}
                onSubmit={async (values) => {
                  const updated = await client().updateBrandAsset(asset.id, toBrandAssetInput(values))
                  setAssets((current) =>
                    current.map((item) => (item.id === updated.id ? updated : item)),
                  )
                  return brandAssetValuesOf(updated)
                }}
                deletion={{
                  name: asset.name,
                  run: async () => {
                    await client().deleteBrandAsset(asset.id)
                    setAssets((current) => current.filter((item) => item.id !== asset.id))
                  },
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-line-strong bg-surface p-6">
        <h3 className="mb-4 text-sm font-semibold text-text">{SUBJECT}を追加</h3>
        <BrandAssetForm
          idPrefix="new-brand"
          initial={EMPTY_BRAND_ASSET_VALUES}
          workspaceId={workspaceId}
          submitLabel="追加"
          actionName="作成"
          onSubmit={async (values) => {
            const created = await client().createBrandAsset({
              workspaceId,
              ...toBrandAssetInput(values),
            })
            setAssets((current) => [...current, created])
            return EMPTY_BRAND_ASSET_VALUES
          }}
        />
      </div>
    </section>
  )
}
