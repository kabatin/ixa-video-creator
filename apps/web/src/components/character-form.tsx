'use client'

import type { WorkspaceId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FieldError } from '@/components/form/field-error'
import { TagInput } from '@/components/tag-input'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import {
  initialCharacterFormValues,
  validateCharacterForm,
  type CharacterFormErrors,
  type CharacterFormValues,
} from '@/lib/character-form'
import { characterDetailHref } from '@/lib/character-links'

export type CharacterFormProps = {
  readonly workspaceId: WorkspaceId
}

export const CharacterForm = ({ workspaceId }: CharacterFormProps) => {
  const router = useRouter()
  const [values, setValues] = useState<CharacterFormValues>(initialCharacterFormValues)
  const [errors, setErrors] = useState<CharacterFormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  const submit = async (): Promise<void> => {
    const validation = validateCharacterForm(values, workspaceId)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      const created = await createApiClient().createCharacter(validation.input)
      router.push(characterDetailHref(created.id))
      router.refresh()
    } catch (error) {
      setErrors({ form: `キャラクターを作成できませんでした: ${describeError(error)}` })
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
      <TextField
        id="name"
        label="名前"
        value={values.name}
        placeholder="takepi"
        disabled={submitting}
        error={errors.name}
        onChange={(name) => {
          setValues((current) => ({ ...current, name }))
        }}
      />

      <TextField
        id="displayName"
        label="表示名"
        value={values.displayName}
        placeholder="タケピ"
        disabled={submitting}
        error={errors.displayName}
        onChange={(displayName) => {
          setValues((current) => ({ ...current, displayName }))
        }}
      />

      <TextareaField
        id="description"
        label="説明"
        value={values.description}
        disabled={submitting}
        error={errors.description}
        onChange={(description) => {
          setValues((current) => ({ ...current, description }))
        }}
      />

      <TagInput
        id="identityAnchors"
        label="識別アンカー"
        values={values.identityAnchors}
        hint="Look で変わらない特徴だけを入れる。衣装や髪色は Look 側に持たせる。"
        placeholder="切れ長の鋭い目"
        disabled={submitting}
        error={errors.identityAnchors}
        onChange={(identityAnchors) => {
          setValues((current) => ({ ...current, identityAnchors }))
        }}
      />

      <TagInput
        id="styleTokens"
        label="スタイル"
        values={values.styleTokens}
        hint="光や質感。再生成のときにここだけを強められるよう分けて持つ。"
        placeholder="硬質な光"
        disabled={submitting}
        error={errors.styleTokens}
        onChange={(styleTokens) => {
          setValues((current) => ({ ...current, styleTokens }))
        }}
      />

      <TagInput
        id="colorPalette"
        label="配色"
        values={values.colorPalette}
        hint="固定で効かせる色。"
        placeholder="#FFD200"
        disabled={submitting}
        error={errors.colorPalette}
        onChange={(colorPalette) => {
          setValues((current) => ({ ...current, colorPalette }))
        }}
      />

      <FieldError id="form-error" message={errors.form} />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line-strong"
        >
          {submitting ? '作成中…' : 'キャラクターを作成'}
        </button>
        <a href="/characters" className="text-sm text-muted underline hover:text-text">
          キャンセル
        </a>
      </div>
    </form>
  )
}
