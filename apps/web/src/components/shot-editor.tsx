'use client'

import type { Shot } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CameraFields } from '@/components/camera-fields'
import { FieldError } from '@/components/form/field-error'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import { Button, type ButtonSize } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { formatSpan } from '@/lib/format-time'
import {
  initialShotEditValues,
  isShotEditDirty,
  shotEditErrorsFromApi,
  toCameraFieldValues,
  validateShotEditForm,
  type EditableShot,
  type ShotEditFormErrors,
  type ShotEditFormValues,
} from '@/lib/shot-edit-form'
import { shotListHref } from '@/lib/shot-links'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'

/** 削除の確認文に出す対象。**コードと時間を必ず添える**（どの Shot が消えるか分からせる）。 */
export type ShotDeleteTarget = Pick<Shot, 'id' | 'projectId' | 'code' | 'startSec' | 'durationSec'>

export type ShotDeleteButtonProps = {
  readonly shot: ShotDeleteTarget
  readonly disabled?: boolean
  readonly size?: ButtonSize
  /**
   * 削除後の行き先。詳細画面は消した Shot の上に留まれないので一覧へ戻り、
   * 一覧はその場で引き直す。関数ではなく文字列で受けるのは、
   * サーバコンポーネント（`ShotRow`）からも渡せるようにするため。
   */
  readonly after?: 'list' | 'refresh'
}

const describeShot = (shot: ShotDeleteTarget): string =>
  `Shot ${shot.code} ${formatSpan(shot.startSec, shot.durationSec)}`

/**
 * Shot を消すボタン。**1 クリックでは消えない。**
 * 一覧と詳細の両方から使うため、確認文の組み立てをここ一箇所に閉じる。
 */
export const ShotDeleteButton = ({
  shot,
  disabled = false,
  size = 'md',
  after = 'refresh',
}: ShotDeleteButtonProps) => {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async (): Promise<void> => {
    setDeleting(true)
    setError(null)
    try {
      await createApiClient().deleteShot(shot.id)
      if (after === 'list') router.push(shotListHref(shot.projectId))
      // 一覧・タイムラインなど他の画面の表示も古くなるため、サーバ側の再取得を促す。
      router.refresh()
    } catch (cause) {
      setError(`Shot を削除できませんでした: ${describeError(cause)}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <ConfirmButton
        label={WORDING.delete}
        message={deleteConfirmMessage(describeShot(shot))}
        confirmLabel={deleting ? '削除中…' : WORDING.delete}
        disabled={disabled || deleting}
        size={size}
        onConfirm={() => {
          void remove()
        }}
      />
      {error !== null && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export type ShotEditorProps = {
  readonly shot: Shot
  /** 生成中など、他の操作で画面が動いている間は触らせない。 */
  readonly disabled?: boolean
}

const SAVED_NOTICE = 'Shot を保存しました。'

/**
 * Shot 詳細の編集フォーム。コード・開始秒・尺・説明・mood・カメラを後から直す。
 * 更新経路は `PATCH /shots/{id}` ひとつに揃える（ADR-0015）。
 */
export const ShotEditor = ({ shot, disabled = false }: ShotEditorProps) => {
  const router = useRouter()
  // 保存済みの値。応答で差し替えることで、差分判定が常に「サーバにある値」との比較になる。
  const [saved, setSaved] = useState<EditableShot>(() => shot)
  const [values, setValues] = useState<ShotEditFormValues>(() => initialShotEditValues(shot))
  const [errors, setErrors] = useState<ShotEditFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const busy = saving || disabled
  const dirty = isShotEditDirty(values, saved)

  const setValue = (field: keyof ShotEditFormValues, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }))
    setNotice(null)
  }

  const save = async (): Promise<void> => {
    const validation = validateShotEditForm(values)
    if (!validation.ok) {
      setErrors(validation.errors)
      setNotice(null)
      return
    }

    setErrors({})
    setNotice(null)
    setSaving(true)
    try {
      const updated = await createApiClient().updateShot(shot.id, validation.patch)
      setSaved(updated)
      // 応答を正とする。サーバが丸めた値をそのまま画面に出し、見た目と実体をずらさない。
      setValues(initialShotEditValues(updated))
      setNotice(SAVED_NOTICE)
      router.refresh()
    } catch (cause) {
      // コードの重複は 422 + fields.code で返る。欄の下に出さないと理由が分からない。
      setErrors(shotEditErrorsFromApi(cause))
    } finally {
      setSaving(false)
    }
  }

  const reset = (): void => {
    setValues(initialShotEditValues(saved))
    setErrors({})
    setNotice(null)
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-text">Shot を編集</h2>
        <ShotDeleteButton shot={shot} disabled={busy} size="sm" after="list" />
      </div>

      <form
        noValidate
        className="mt-4 space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            id="edit-code"
            label="ショットコード"
            value={values.code}
            placeholder="S01-010"
            disabled={busy}
            error={errors.code}
            onChange={(value) => {
              setValue('code', value)
            }}
          />
          <TextField
            id="edit-startSec"
            label="開始秒"
            value={values.startSec}
            placeholder="0"
            disabled={busy}
            error={errors.startSec}
            onChange={(value) => {
              setValue('startSec', value)
            }}
          />
          <TextField
            id="edit-durationSec"
            label="尺（秒）"
            value={values.durationSec}
            placeholder="4"
            disabled={busy}
            error={errors.durationSec}
            onChange={(value) => {
              setValue('durationSec', value)
            }}
          />
        </div>

        <TextareaField
          id="edit-description"
          label="説明"
          value={values.description}
          placeholder="夜のスタジアム。主人公がボールを追う。"
          disabled={busy}
          error={errors.description}
          onChange={(value) => {
            setValue('description', value)
          }}
        />

        <TextField
          id="edit-mood"
          label="mood"
          value={values.mood}
          placeholder="tense, cinematic"
          disabled={busy}
          error={errors.mood}
          onChange={(value) => {
            setValue('mood', value)
          }}
        />

        <CameraFields
          values={toCameraFieldValues(values)}
          errors={errors}
          disabled={busy}
          onChange={setValue}
        />

        <FieldError id="edit-form-error" message={errors.form} />

        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={busy || !dirty}>
            {saving ? '保存中…' : WORDING.save}
          </Button>
          <Button tone="secondary" disabled={busy || !dirty} onClick={reset}>
            変更を{WORDING.cancel}
          </Button>
          {notice !== null && (
            <p role="status" className="text-sm text-ok">
              {notice}
            </p>
          )}
        </div>
      </form>
    </section>
  )
}
