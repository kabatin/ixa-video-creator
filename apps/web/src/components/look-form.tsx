'use client'

import { useState } from 'react'
import { FieldError } from '@/components/form/field-error'
import { TagInput } from '@/components/tag-input'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import type { CreateLookBody } from '@/lib/character-schemas'
import {
  initialLookFormValues,
  validateLookForm,
  type LookFormErrors,
  type LookFormValues,
} from '@/lib/look-form'

export type LookFormProps = {
  readonly busy: boolean
  readonly onSubmit: (input: CreateLookBody) => void
}

/** Look の作成。key は Shot からの参照に使うため後から変更できない。 */
export const LookForm = ({ busy, onSubmit }: LookFormProps) => {
  const [values, setValues] = useState<LookFormValues>(initialLookFormValues)
  const [errors, setErrors] = useState<LookFormErrors>({})

  const submit = (): void => {
    const validation = validateLookForm(values)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }
    setErrors({})
    setValues(initialLookFormValues())
    onSubmit(validation.input)
  }

  return (
    <form
      noValidate
      className="space-y-4 rounded-lg border border-line bg-surface p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <h3 className="text-sm font-semibold text-text">Look を追加</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="look-key"
          label="識別名（英大文字・数字・_。あとで変えられません）"
          value={values.key}
          placeholder="IXA_CUP_PAST"
          disabled={busy}
          error={errors.key}
          onChange={(key) => {
            setValues((current) => ({ ...current, key }))
          }}
        />
        <TextField
          id="look-name"
          label="名前"
          value={values.name}
          placeholder="iXA CUP 2019"
          disabled={busy}
          error={errors.name}
          onChange={(name) => {
            setValues((current) => ({ ...current, name }))
          }}
        />
      </div>

      <TextField
        id="look-era"
        label="時代"
        value={values.era}
        placeholder="2019"
        disabled={busy}
        error={errors.era}
        onChange={(era) => {
          setValues((current) => ({ ...current, era }))
        }}
      />

      <TextareaField
        id="look-description"
        label="説明"
        value={values.description}
        rows={2}
        disabled={busy}
        error={errors.description}
        onChange={(description) => {
          setValues((current) => ({ ...current, description }))
        }}
      />

      <TagInput
        id="look-wardrobe-tokens"
        label="衣装トークン"
        values={values.wardrobeTokens}
        hint="この Look でだけ変わる外見。髪色・衣装・年齢など。"
        placeholder="黒髪短髪"
        disabled={busy}
        error={errors.wardrobeTokens}
        onChange={(wardrobeTokens) => {
          setValues((current) => ({ ...current, wardrobeTokens }))
        }}
      />

      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={values.isDefault}
          disabled={busy}
          onChange={(event) => {
            const isDefault = event.target.checked
            setValues((current) => ({ ...current, isDefault }))
          }}
          className="h-4 w-4 rounded border-line-strong"
        />
        既定の Look にする（Shot が Look を指定しないときに使われる）
      </label>

      <FieldError id="look-form-error" message={errors.form} />

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line-strong"
      >
        {busy ? '追加中…' : 'Look を追加'}
      </button>
    </form>
  )
}
