'use client'

import type { Character } from '@ixa/domain'
import { useState } from 'react'
import { FieldError } from '@/components/form/field-error'
import { TagInput } from '@/components/tag-input'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import {
  validateCharacterForm,
  type CharacterFormErrors,
  type CharacterFormValues,
} from '@/lib/character-form'

export type CharacterEditorProps = {
  readonly character: Character
}

const valuesOf = (character: Character): CharacterFormValues => ({
  name: character.name,
  displayName: character.displayName,
  description: character.description,
  identityAnchors: character.identityAnchors,
  styleTokens: character.styleTokens,
  colorPalette: character.colorPalette,
})

/** Character の同一性の部分だけを編集する。Look で変わる外見はここには入れない。 */
export const CharacterEditor = ({ character }: CharacterEditorProps) => {
  const [values, setValues] = useState<CharacterFormValues>(() => valuesOf(character))
  const [errors, setErrors] = useState<CharacterFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const validation = validateCharacterForm(values, character.workspaceId)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    setErrors({})
    setSaving(true)
    setSavedAt(null)
    try {
      const updated = await createApiClient().updateCharacter(character.id, {
        name: validation.input.name,
        displayName: validation.input.displayName,
        description: validation.input.description,
        identityAnchors: validation.input.identityAnchors,
        styleTokens: validation.input.styleTokens,
        colorPalette: validation.input.colorPalette,
      })
      setValues(valuesOf(updated))
      setSavedAt(new Date().toLocaleTimeString('ja-JP'))
    } catch (error) {
      setErrors({ form: `保存できませんでした: ${describeError(error)}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      noValidate
      className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h2 className="text-base font-semibold text-slate-900">同一性</h2>

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id="character-name"
          label="名前"
          value={values.name}
          disabled={saving}
          error={errors.name}
          onChange={(name) => {
            setValues((current) => ({ ...current, name }))
          }}
        />
        <TextField
          id="character-display-name"
          label="表示名"
          value={values.displayName}
          disabled={saving}
          error={errors.displayName}
          onChange={(displayName) => {
            setValues((current) => ({ ...current, displayName }))
          }}
        />
      </div>

      <TextareaField
        id="character-description"
        label="説明"
        value={values.description}
        disabled={saving}
        error={errors.description}
        onChange={(description) => {
          setValues((current) => ({ ...current, description }))
        }}
      />

      <TagInput
        id="character-identity-anchors"
        label="識別アンカー"
        values={values.identityAnchors}
        hint="Look で変わらない特徴だけを入れる。衣装や髪色は Look 側へ。"
        placeholder="20代日本人男性"
        disabled={saving}
        error={errors.identityAnchors}
        onChange={(identityAnchors) => {
          setValues((current) => ({ ...current, identityAnchors }))
        }}
      />

      <TagInput
        id="character-style-tokens"
        label="スタイル"
        values={values.styleTokens}
        hint="光や質感の指定。再生成時にここだけを強調できる。"
        placeholder="シネマティック"
        disabled={saving}
        error={errors.styleTokens}
        onChange={(styleTokens) => {
          setValues((current) => ({ ...current, styleTokens }))
        }}
      />

      <TagInput
        id="character-color-palette"
        label="配色"
        values={values.colorPalette}
        hint="キャラクターに固定で効かせる色。"
        placeholder="#1A1A1A"
        disabled={saving}
        error={errors.colorPalette}
        onChange={(colorPalette) => {
          setValues((current) => ({ ...current, colorPalette }))
        }}
      />

      <FieldError id="character-editor-error" message={errors.form} />

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {savedAt !== null && (
          <span role="status" className="text-sm text-emerald-700">
            {savedAt} に保存しました
          </span>
        )}
      </div>
    </form>
  )
}
