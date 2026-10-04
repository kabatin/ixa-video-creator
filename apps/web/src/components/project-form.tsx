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
import { workbenchHref } from '@/lib/workbench-url'
import { TextField } from '@/components/form/text-field'
import { FieldError } from '@/components/form/field-error'
import { AspectRatioField, FpsField, ResolutionField } from '@/components/project-spec-fields'
import { VideoAiFpsNote } from '@/components/project-video-ai-note'
import { Button } from '@/components/ui/button'

export type ProjectFormProps = {
  readonly workspaceId: WorkspaceId
}

/**
 * 新規作成（制作者 2026-10-03「アスペクト比は実際のサイズ図を選ぶ形」「解像度もサイズ図的なもの」「使う生成 AI 欄や
 * FPS 欄もよしなに」）。形・大きさ・fps は図つきのカードで選ぶ（`project-spec-fields.tsx`。プロジェクト設定と共有）。
 * 動画の AI は「使う AI」で選んだものを見せ、fps を合わせる案内を出す（`project-video-ai-note.tsx`）。
 */
export const ProjectForm = ({ workspaceId }: ProjectFormProps) => {
  const router = useRouter()
  const [values, setValues] = useState<ProjectFormValues>(initialProjectFormValues)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)

  const parsedAspect = AspectRatio.safeParse(values.aspectRatio)

  const submit = async (): Promise<void> => {
    const validation = validateProjectForm(values, workspaceId)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      const created = await createApiClient().createProject(validation.input)
      // **作った本人はそのプロジェクトに入りたい。** 一覧へ戻すと、次に何をするかを
      // もう一度選ばせることになる。曲を入れるのが次の一手なので、そこまで運ぶ。
      router.push(workbenchHref(created.id))
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

      <AspectRatioField
        value={values.aspectRatio}
        disabled={submitting}
        error={errors.aspectRatio}
        onChange={(aspectRatio) => {
          setValues((current) => withAspectRatio(current, aspectRatio))
        }}
      />

      {parsedAspect.success && (
        <ResolutionField
          aspectRatio={parsedAspect.data}
          value={values.resolutionKey}
          disabled={submitting}
          error={errors.resolutionKey}
          onChange={(resolutionKey) => {
            setValues((current) => ({ ...current, resolutionKey }))
          }}
        />
      )}

      {/**
        * 素材が 24fps なのに Project を 30fps にすると、書き出しで引き伸ばされて無い絵を作ることになる
        * （`render/ffmpeg-filters.ts` が毎クリップに `fps=doc.fps` を掛ける）。動画の AI の fps に合わせる案内を出す。
        */}
      <FpsField
        value={values.fps}
        disabled={submitting}
        error={errors.fps}
        onChange={(fps) => {
          setValues((current) => ({ ...current, fps }))
        }}
        note={
          <VideoAiFpsNote
            fps={values.fps}
            onUseFps={(fps) => {
              setValues((current) => ({ ...current, fps }))
            }}
          />
        }
      />

      <FieldError id="form-error" message={errors.form} />

      <div className="flex items-center gap-3 pt-2">
        <Button tone="primary" type="submit" disabled={submitting}>
          {submitting ? '作成中…' : 'プロジェクトを作成'}
        </Button>
        <a href="/" className="text-sm text-muted underline hover:text-text">
          やめる
        </a>
      </div>
    </form>
  )
}
