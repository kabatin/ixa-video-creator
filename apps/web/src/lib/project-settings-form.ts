import {
  AspectRatio,
  Fps,
  ProjectStatus,
  Resolution,
  UpdateProjectPatch,
  type Project,
} from '@ixa/domain'
import { z } from 'zod'
import { defaultResolutionKeyFor, findResolution } from '@/lib/resolution-presets'

/**
 * Project 設定フォームの検証（P55-9）。
 *
 * 作成フォーム（`project-form.ts`）とは別物として置いている。作成時は
 * 名前・比率・解像度・fps しか決められないが、設定画面はそれに加えて
 * **尺・予算・スタイルガイド・状態**を扱い、どれも「未設定（null）」を持てる。
 * 同じ関数に両方を入れると、作成時に送ってはいけない列が紛れ込む。
 *
 * ここは純粋関数だけ。IO も React も持たない。
 */

export type ProjectSettingsValues = {
  readonly name: string
  readonly aspectRatio: string
  readonly resolutionKey: string
  readonly fps: string
  /** 空文字は「未設定」。0 と未設定は別の事実なので畳まない。 */
  readonly durationSec: string
  readonly budgetUsd: string
  readonly styleGuide: string
  readonly status: string
}

export type ProjectSettingsField = keyof ProjectSettingsValues | 'form'

export type ProjectSettingsErrors = Readonly<Partial<Record<ProjectSettingsField, string>>>

/** 送信する差分。`UpdateProjectPatch` の出力形（既定値の解決済み）。 */
export type ProjectSettingsPatch = z.output<typeof UpdateProjectPatch>

export type ProjectSettingsValidation =
  | { readonly ok: true; readonly patch: ProjectSettingsPatch }
  | { readonly ok: false; readonly errors: ProjectSettingsErrors }

/** 数値欄の表示。未設定は空文字にする。`String(null)` で 'null' を出さないため。 */
const numberToField = (value: number | null): string => (value === null ? '' : String(value))

export const resolutionKeyOf = (resolution: Resolution): string =>
  `${String(resolution.width)}x${String(resolution.height)}`

export const initialProjectSettingsValues = (project: Project): ProjectSettingsValues => ({
  name: project.name,
  aspectRatio: project.aspectRatio,
  resolutionKey: resolutionKeyOf(project.resolution),
  fps: String(project.fps),
  durationSec: numberToField(project.durationSec),
  budgetUsd: numberToField(project.budgetUsd),
  styleGuide: project.styleGuide,
  status: project.status,
})

/** アスペクト比を変えると解像度プリセットの集合も変わるため、解像度を既定値へ戻す。 */
export const withSettingsAspectRatio = (
  values: ProjectSettingsValues,
  aspectRatio: string,
): ProjectSettingsValues => {
  const parsed = AspectRatio.safeParse(aspectRatio)
  return {
    ...values,
    aspectRatio,
    resolutionKey: parsed.success ? defaultResolutionKeyFor(parsed.data) : values.resolutionKey,
  }
}

/**
 * 保存済みの値と一致するか。一致している間は保存ボタンを押させない。
 * 押せるのに何も起きない状態を作らないため。
 */
export const isProjectSettingsUnchanged = (
  project: Project,
  values: ProjectSettingsValues,
): boolean => {
  const initial = initialProjectSettingsValues(project)
  return (Object.keys(initial) as (keyof ProjectSettingsValues)[]).every(
    (key) => initial[key] === values[key],
  )
}

/** `1920x1080` を解像度へ戻す。プリセットに無い既存の値を黙って捨てないために使う。 */
const parseResolutionKey = (key: string): Resolution | undefined => {
  const matched = /^(\d+)x(\d+)$/u.exec(key.trim())
  if (matched === null) return undefined
  const parsed = Resolution.safeParse({ width: Number(matched[1]), height: Number(matched[2]) })
  return parsed.success ? parsed.data : undefined
}

export const resolveResolution = (aspectRatio: AspectRatio, key: string): Resolution | undefined =>
  findResolution(aspectRatio, key) ?? parseResolutionKey(key)

type OptionalNumber =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false; readonly message: string }

/** 空欄は null（未設定）。それ以外は有限かつ非負の数だけを通す。 */
const parseOptionalNumber = (raw: string, label: string): OptionalNumber => {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, value: null }

  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { ok: false, message: `${label}は数値で入力してください。` }
  if (value < 0) return { ok: false, message: `${label}は 0 以上で入力してください。` }
  return { ok: true, value }
}

const NAME_MAX = 200

/**
 * 送信前検証。フォームの文字列を `UpdateProjectPatch` へ変換する。
 *
 * 更新可能な列の正はドメインの `UpdateProjectPatch`（id / workspaceId / 日時は変更不可）。
 * ここでその一覧を増やさないこと。増やしたい列があるなら BLOCKED で報告する。
 */
export const validateProjectSettings = (
  values: ProjectSettingsValues,
): ProjectSettingsValidation => {
  const name = values.name.trim()
  if (name === '') {
    return { ok: false, errors: { name: 'プロジェクト名を入力してください。' } }
  }
  if (name.length > NAME_MAX) {
    return {
      ok: false,
      errors: { name: `プロジェクト名は ${String(NAME_MAX)} 文字以内で入力してください。` },
    }
  }

  const aspectRatio = AspectRatio.safeParse(values.aspectRatio)
  if (!aspectRatio.success) {
    return { ok: false, errors: { aspectRatio: 'アスペクト比を選択してください。' } }
  }

  const resolution = resolveResolution(aspectRatio.data, values.resolutionKey)
  if (resolution === undefined) {
    return { ok: false, errors: { resolutionKey: '解像度を選択してください。' } }
  }

  const fps = Fps.safeParse(Number(values.fps))
  if (!fps.success) {
    return { ok: false, errors: { fps: 'fps は 24 / 25 / 30 / 60 から選択してください。' } }
  }

  const status = ProjectStatus.safeParse(values.status)
  if (!status.success) {
    return { ok: false, errors: { status: '状態を選択してください。' } }
  }

  const durationSec = parseOptionalNumber(values.durationSec, '尺（秒）')
  if (!durationSec.ok) return { ok: false, errors: { durationSec: durationSec.message } }

  const budgetUsd = parseOptionalNumber(values.budgetUsd, '予算（USD）')
  if (!budgetUsd.ok) return { ok: false, errors: { budgetUsd: budgetUsd.message } }

  const parsed = UpdateProjectPatch.safeParse({
    name,
    aspectRatio: aspectRatio.data,
    resolution,
    fps: fps.data,
    durationSec: durationSec.value,
    budgetUsd: budgetUsd.value,
    styleGuide: values.styleGuide,
    status: status.data,
  })

  if (!parsed.success) {
    // ここへ来るのは上の個別検証が取りこぼした場合だけ。握り潰さず理由を出す。
    const first = parsed.error.issues[0]
    return {
      ok: false,
      errors: { form: `入力を確認してください: ${first?.message ?? '理由不明'}` },
    }
  }

  return { ok: true, patch: parsed.data }
}
