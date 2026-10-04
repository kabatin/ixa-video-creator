'use client'

import { AspectRatio, ProjectStatus, type Project } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FieldError } from '@/components/form/field-error'
import { SelectField, type SelectOption } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { Button } from '@/components/ui/button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createLibraryClient, fieldErrorsOf } from '@/lib/library-api'
import { statusLabel } from '@/lib/project-display'
import {
  initialProjectSettingsValues,
  isProjectSettingsUnchanged,
  resolutionKeyOf,
  validateProjectSettings,
  withSettingsAspectRatio,
  type ProjectSettingsErrors,
  type ProjectSettingsField,
  type ProjectSettingsValues,
} from '@/lib/project-settings-form'
import { AspectRatioField, FpsField, ResolutionField } from '@/components/project-spec-fields'
import { WORDING } from '@/lib/wording'

/**
 * Project の設定（P55-9）。
 *
 * **作ったあと変えられない列を無くすための画面。** 以前は名前も解像度も予算も
 * 作成時に決めた値のまま固定され、直すには API を直接叩くしか無かった。
 *
 * 更新可能な列の正はドメインの `UpdateProjectPatch`。ここで列を足さない。
 */

export type ProjectSettingsFormProps = {
  readonly project: Project
}

const STATUS_OPTIONS: readonly SelectOption[] = ProjectStatus.options.map((status) => ({
  value: status,
  label: statusLabel(status),
}))

/** サーバが返した列名を、この画面のフィールドへ写す。 */
const FIELD_BY_COLUMN: Readonly<Record<string, ProjectSettingsField>> = Object.freeze({
  name: 'name',
  aspectRatio: 'aspectRatio',
  resolution: 'resolutionKey',
  fps: 'fps',
  durationSec: 'durationSec',
  budgetUsd: 'budgetUsd',
  status: 'status',
})

/**
 * サーバの 422 をフィールド単位のエラーへ戻す。
 * 規則をこちらへ書き写さず、判定の結果だけを受け取る（lessons L-016）。
 */
const errorsFromServer = (error: unknown): ProjectSettingsErrors => {
  const fields = fieldErrorsOf(error)
  if (fields === null) return { form: `保存できませんでした: ${describeError(error)}` }

  return Object.entries(fields).reduce<ProjectSettingsErrors>((acc, [column, message]) => {
    const field = FIELD_BY_COLUMN[column] ?? 'form'
    return field in acc ? acc : { ...acc, [field]: message }
  }, {})
}

export const ProjectSettingsForm = ({ project }: ProjectSettingsFormProps) => {
  const router = useRouter()
  const [saved, setSaved] = useState<Project>(project)
  const [values, setValues] = useState<ProjectSettingsValues>(() =>
    initialProjectSettingsValues(project),
  )
  const [errors, setErrors] = useState<ProjectSettingsErrors>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const set = (patch: Partial<ProjectSettingsValues>): void => {
    setValues((current) => ({ ...current, ...patch }))
  }

  const submit = async (): Promise<void> => {
    const validation = validateProjectSettings(values)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    setErrors({})
    setBusy(true)
    setNotice(null)
    try {
      const updated = await createLibraryClient(resolveApiBaseUrl()).updateProject(
        saved.id,
        validation.patch,
      )
      setSaved(updated)
      setValues(initialProjectSettingsValues(updated))
      setNotice(`${new Date().toLocaleTimeString('ja-JP')} に保存しました`)
      // 一覧やヘッダが古い名前のままにならないよう、サーバ側の描画も引き直す。
      router.refresh()
    } catch (error) {
      setErrors(errorsFromServer(error))
    } finally {
      setBusy(false)
    }
  }

  const unchanged = isProjectSettingsUnchanged(saved, values)

  return (
    <div className="space-y-8">
      <form
        noValidate
        className="space-y-5 rounded-lg border border-line bg-surface p-6 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2 className="text-base font-semibold text-text">基本</h2>

        <TextField
          id="project-name"
          label="プロジェクト名"
          value={values.name}
          disabled={busy}
          error={errors.name}
          onChange={(name) => {
            set({ name })
          }}
        />

        {/* 形・大きさ・fps は新規作成と同じ図つきのカード（`project-spec-fields.tsx`。選択肢を書き写さない）。 */}
        <AspectRatioField
          value={values.aspectRatio}
          disabled={busy}
          error={errors.aspectRatio}
          onChange={(aspectRatio) => {
            setValues((current) => withSettingsAspectRatio(current, aspectRatio))
          }}
        />
        {AspectRatio.safeParse(values.aspectRatio).success && (
          <ResolutionField
            aspectRatio={AspectRatio.parse(values.aspectRatio)}
            value={values.resolutionKey}
            // 保存済みの大きさを残すのは同じ形のときだけ（形を変えたら、その形の選択肢から選ぶ）。
            {...(values.aspectRatio === saved.aspectRatio ? { savedKey: resolutionKeyOf(saved.resolution) } : {})}
            disabled={busy}
            error={errors.resolutionKey}
            onChange={(resolutionKey) => {
              set({ resolutionKey })
            }}
          />
        )}
        <FpsField
          value={values.fps}
          disabled={busy}
          error={errors.fps}
          onChange={(fps) => {
            set({ fps })
          }}
        />

        <h2 className="pt-2 text-base font-semibold text-text">制作の制約</h2>

        <div className="grid gap-5 sm:grid-cols-3">
          <TextField
            id="project-duration-sec"
            label="尺（秒）"
            value={values.durationSec}
            placeholder="116"
            disabled={busy}
            error={errors.durationSec}
            onChange={(durationSec) => {
              set({ durationSec })
            }}
          />
          <TextField
            id="project-budget-usd"
            label="予算（USD）"
            value={values.budgetUsd}
            placeholder="250"
            disabled={busy}
            error={errors.budgetUsd}
            onChange={(budgetUsd) => {
              set({ budgetUsd })
            }}
          />
          <SelectField
            id="project-status"
            label="状態"
            value={values.status}
            options={STATUS_OPTIONS}
            disabled={busy}
            error={errors.status}
            onChange={(status) => {
              set({ status })
            }}
          />
        </div>

        <p className="text-xs text-muted">
          尺と予算は空欄にすると「未設定」になります。0 と未設定は別の意味で扱われます。
        </p>

        <p className="text-xs text-muted">
          画風・光・質感（ルック）やコンセプトは、素材ツリーの一番上の「作品の方針」で決めます。
        </p>

        <FieldError id="project-settings-error" message={errors.form} />

        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={busy || unchanged}>
            {busy ? '保存中…' : WORDING.save}
          </Button>
          {notice !== null && (
            <span role="status" className="text-sm text-ok">
              {notice}
            </span>
          )}
        </div>
      </form>

    </div>
  )
}
