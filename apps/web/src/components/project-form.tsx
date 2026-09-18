'use client'

import { AspectRatio, type WorkspaceId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import {
  initialProjectFormValues,
  validateProjectForm,
  withAspectRatio,
  type FieldErrors,
  type ProjectFormValues,
} from '@/lib/project-form'
import {
  ASPECT_RATIOS,
  FPS_OPTIONS,
  resolutionPresetsFor,
} from '@/lib/resolution-presets'
import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { FieldError } from '@/components/form/field-error'

export type ProjectFormProps = {
  readonly workspaceId: WorkspaceId
}

const aspectOptions = ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
const fpsOptions = FPS_OPTIONS.map((fps) => ({ value: String(fps), label: `${String(fps)} fps` }))

export const ProjectForm = ({ workspaceId }: ProjectFormProps) => {
  const router = useRouter()
  const [values, setValues] = useState<ProjectFormValues>(initialProjectFormValues)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  const parsedAspect = AspectRatio.safeParse(values.aspectRatio)
  const resolutionOptions = (
    parsedAspect.success ? resolutionPresetsFor(parsedAspect.data) : []
  ).map((preset) => ({ value: preset.key, label: preset.label }))

  const submit = async (): Promise<void> => {
    const validation = validateProjectForm(values, workspaceId)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      await createApiClient().createProject(validation.input)
      router.push('/')
      router.refresh()
    } catch (error) {
      setErrors({ form: `プロジェクトを作成できませんでした: ${describeError(error)}` })
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
        label="プロジェクト名"
        value={values.name}
        placeholder="iXA CUP MUSIC VIDEO"
        disabled={submitting}
        error={errors.name}
        onChange={(name) => {
          setValues((current) => ({ ...current, name }))
        }}
      />

      <SelectField
        id="aspectRatio"
        label="アスペクト比"
        value={values.aspectRatio}
        options={aspectOptions}
        disabled={submitting}
        error={errors.aspectRatio}
        onChange={(aspectRatio) => {
          setValues((current) => withAspectRatio(current, aspectRatio))
        }}
      />

      <SelectField
        id="resolutionKey"
        label="解像度"
        value={values.resolutionKey}
        options={resolutionOptions}
        disabled={submitting}
        error={errors.resolutionKey}
        onChange={(resolutionKey) => {
          setValues((current) => ({ ...current, resolutionKey }))
        }}
      />

      <SelectField
        id="fps"
        label="fps"
        value={values.fps}
        options={fpsOptions}
        disabled={submitting}
        error={errors.fps}
        onChange={(fps) => {
          setValues((current) => ({ ...current, fps }))
        }}
      />

      <FieldError id="form-error" message={errors.form} />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
        >
          {submitting ? '作成中…' : 'プロジェクトを作成'}
        </button>
        <a href="/" className="text-sm text-muted underline hover:text-text">
          キャンセル
        </a>
      </div>
    </form>
  )
}
