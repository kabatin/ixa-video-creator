'use client'

import type { Location, ProjectId, Shot } from '@ixa/domain'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CameraFields } from '@/components/camera-fields'
import { FieldError } from '@/components/form/field-error'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import { LocationField } from '@/components/location-field'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import {
  initialShotFormValues,
  validateShotForm,
  type ShotFormErrors,
  type ShotFormValues,
} from '@/lib/shot-form'
import { shotListHref } from '@/lib/shot-links'

export type ShotFormProps = {
  readonly projectId: ProjectId
  /** 末尾へ追加するための order。一覧の最後の Shot から算出して渡す。 */
  readonly nextOrder: number
  readonly defaultStartSec: number
  /** 空配列は「未登録」。取得自体に失敗したときは `locationsError` で区別する。 */
  readonly locations: readonly Location[]
  readonly locationsError?: string
  /**
   * 作ったあとの行き先（PHASE 7.1 ワークベンチ）。渡せばそれを呼び、一覧へは移らない。
   * 渡さなければ従来どおり Shot 一覧へ戻る。
   */
  readonly onCreated?: (shot: Shot) => void
}

export const ShotForm = ({
  projectId,
  nextOrder,
  defaultStartSec,
  locations,
  locationsError,
  onCreated,
}: ShotFormProps) => {
  const router = useRouter()
  const [values, setValues] = useState<ShotFormValues>(() => initialShotFormValues(defaultStartSec))
  const [errors, setErrors] = useState<ShotFormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  const setValue = (field: keyof ShotFormValues, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const submit = async (): Promise<void> => {
    const validation = validateShotForm({ values, order: nextOrder })
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      const created = await createApiClient().createShot(projectId, validation.input)
      if (onCreated === undefined) router.push(shotListHref(projectId))
      else onCreated(created)
      router.refresh()
    } catch (error) {
      setErrors({ form: `Shot を作成できませんでした: ${describeError(error)}` })
      setSubmitting(false)
    }
  }

  return (
    <form
      noValidate
      className="space-y-5 rounded-lg border border-line bg-surface p-6 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          id="code"
          label="ショットコード"
          value={values.code}
          placeholder="S01-010"
          disabled={submitting}
          error={errors.code}
          onChange={(value) => {
            setValue('code', value)
          }}
        />
        <TextField
          id="startSec"
          label="開始秒"
          value={values.startSec}
          placeholder="0"
          disabled={submitting}
          error={errors.startSec}
          onChange={(value) => {
            setValue('startSec', value)
          }}
        />
        <TextField
          id="durationSec"
          label="尺（秒）"
          value={values.durationSec}
          placeholder="4"
          disabled={submitting}
          error={errors.durationSec}
          onChange={(value) => {
            setValue('durationSec', value)
          }}
        />
      </div>

      <TextareaField
        id="description"
        label="説明"
        value={values.description}
        placeholder="夜のスタジアム。主人公がボールを追う。"
        disabled={submitting}
        error={errors.description}
        onChange={(value) => {
          setValue('description', value)
        }}
      />

      <TextField
        id="mood"
        label="mood"
        value={values.mood}
        placeholder="tense, cinematic"
        disabled={submitting}
        error={errors.mood}
        onChange={(value) => {
          setValue('mood', value)
        }}
      />

      <LocationField
        locations={locations}
        value={values.locationId}
        disabled={submitting}
        error={errors.locationId}
        loadError={locationsError}
        onChange={(value) => {
          setValue('locationId', value)
        }}
      />

      <CameraFields values={values} errors={errors} disabled={submitting} onChange={setValue} />

      <FieldError id="form-error" message={errors.form} />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
        >
          {submitting ? '作成中…' : 'Shot を作成'}
        </button>
        <Link
          href={shotListHref(projectId)}
          className="text-sm text-muted underline hover:text-text"
        >
          キャンセル
        </Link>
      </div>
    </form>
  )
}
