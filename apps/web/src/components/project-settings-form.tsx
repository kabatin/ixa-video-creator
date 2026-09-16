'use client'

import { AspectRatio, ProjectStatus, type Project } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { FieldError } from '@/components/form/field-error'
import { SelectField, type SelectOption } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createLibraryClient, fieldErrorsOf } from '@/lib/library-api'
import { statusLabel } from '@/lib/project-display'
import {
  initialProjectSettingsValues,
  isProjectSettingsUnchanged,
  validateProjectSettings,
  withSettingsAspectRatio,
  type ProjectSettingsErrors,
  type ProjectSettingsField,
  type ProjectSettingsValues,
} from '@/lib/project-settings-form'
import { ASPECT_RATIOS, FPS_OPTIONS, resolutionPresetsFor } from '@/lib/resolution-presets'
import { WORDING, deleteConfirmMessage } from '@/lib/wording'

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

const ASPECT_OPTIONS: readonly SelectOption[] = ASPECT_RATIOS.map((ratio) => ({
  value: ratio,
  label: ratio,
}))

const FPS_SELECT_OPTIONS: readonly SelectOption[] = FPS_OPTIONS.map((fps) => ({
  value: String(fps),
  label: `${String(fps)} fps`,
}))

const STATUS_OPTIONS: readonly SelectOption[] = ProjectStatus.options.map((status) => ({
  value: status,
  label: statusLabel(status),
}))

/**
 * 解像度の選択肢。
 * **保存済みの値がプリセットに無くても選択肢へ残す。** 落とすと、開いただけで
 * 別の解像度に化ける。
 */
const resolutionOptions = (aspectRatio: string, currentKey: string): readonly SelectOption[] => {
  const parsed = AspectRatio.safeParse(aspectRatio)
  const presets = parsed.success
    ? resolutionPresetsFor(parsed.data).map((preset) => ({
        value: preset.key,
        label: preset.label,
      }))
    : []
  if (currentKey === '' || presets.some((option) => option.value === currentKey)) return presets
  return [...presets, { value: currentKey, label: `${currentKey}（保存済みの値）` }]
}

/** サーバが返した列名を、この画面のフィールドへ写す。 */
const FIELD_BY_COLUMN: Readonly<Record<string, ProjectSettingsField>> = Object.freeze({
  name: 'name',
  aspectRatio: 'aspectRatio',
  resolution: 'resolutionKey',
  fps: 'fps',
  durationSec: 'durationSec',
  budgetUsd: 'budgetUsd',
  styleGuide: 'styleGuide',
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

  const remove = async (): Promise<void> => {
    setErrors({})
    setBusy(true)
    setNotice(null)
    try {
      await createLibraryClient(resolveApiBaseUrl()).deleteProject(saved.id)
      router.push('/')
      router.refresh()
    } catch (error) {
      setErrors({ form: `削除できませんでした: ${describeError(error)}` })
      setBusy(false)
    }
  }

  const unchanged = isProjectSettingsUnchanged(saved, values)

  return (
    <div className="space-y-8">
      <form
        noValidate
        className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2 className="text-base font-semibold text-slate-900">基本</h2>

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

        <div className="grid gap-5 sm:grid-cols-3">
          <SelectField
            id="project-aspect-ratio"
            label="アスペクト比"
            value={values.aspectRatio}
            options={ASPECT_OPTIONS}
            disabled={busy}
            error={errors.aspectRatio}
            onChange={(aspectRatio) => {
              setValues((current) => withSettingsAspectRatio(current, aspectRatio))
            }}
          />
          <SelectField
            id="project-resolution"
            label="解像度"
            value={values.resolutionKey}
            options={resolutionOptions(values.aspectRatio, values.resolutionKey)}
            disabled={busy}
            error={errors.resolutionKey}
            onChange={(resolutionKey) => {
              set({ resolutionKey })
            }}
          />
          <SelectField
            id="project-fps"
            label="fps"
            value={values.fps}
            options={FPS_SELECT_OPTIONS}
            disabled={busy}
            error={errors.fps}
            onChange={(fps) => {
              set({ fps })
            }}
          />
        </div>

        <h2 className="pt-2 text-base font-semibold text-slate-900">制作の制約</h2>

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

        <p className="text-xs text-slate-600">
          尺と予算は空欄にすると「未設定」になります。0 と未設定は別の意味で扱われます。
        </p>

        <TextareaField
          id="project-style-guide"
          label="スタイルガイド"
          value={values.styleGuide}
          rows={4}
          placeholder="全 Shot の生成プロンプトの先頭に入る指示"
          disabled={busy}
          error={errors.styleGuide}
          onChange={(styleGuide) => {
            set({ styleGuide })
          }}
        />

        <FieldError id="project-settings-error" message={errors.form} />

        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={busy || unchanged}>
            {busy ? '保存中…' : WORDING.save}
          </Button>
          {notice !== null && (
            <span role="status" className="text-sm text-emerald-700">
              {notice}
            </span>
          )}
        </div>
      </form>

      <section className="rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-rose-900">プロジェクトの削除</h2>
        <p className="mt-2 text-sm text-slate-700">
          このプロジェクトに紐づくものが、すべて画面から辿れなくなります。
        </p>
        <div className="mt-4">
          <ConfirmButton
            label={`${WORDING.delete}（プロジェクト）`}
            message={deleteConfirmMessage(`プロジェクト「${saved.name}」`)}
            confirmLabel="削除する"
            disabled={busy}
            onConfirm={() => {
              void remove()
            }}
          >
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-900">
              <li>すべての Shot と、その生成結果（Take）</li>
              <li>ストーリーボード・タイムライン・トランジション</li>
              <li>登録した楽曲と解析結果</li>
              <li>レンダリング結果</li>
            </ul>
            <p className="mt-2 text-sm text-rose-900">
              キャラクター・ロケーション・ブランド資産はワークスペースのものなので残ります。
            </p>
          </ConfirmButton>
        </div>
      </section>
    </div>
  )
}
