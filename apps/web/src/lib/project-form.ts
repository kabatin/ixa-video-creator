import { AspectRatio, CreateProjectInput, Fps, type WorkspaceId } from '@ixa/domain'
import { defaultResolutionKeyFor, findResolution } from '@/lib/resolution-presets'

export type ProjectFormValues = {
  readonly name: string
  readonly aspectRatio: string
  readonly resolutionKey: string
  readonly fps: string
}

export type ProjectFormField = keyof ProjectFormValues | 'form'

export type FieldErrors = Readonly<Partial<Record<ProjectFormField, string>>>

export type ProjectFormValidation =
  | { readonly ok: true; readonly input: CreateProjectInput }
  | { readonly ok: false; readonly errors: FieldErrors }

export const initialProjectFormValues = (): ProjectFormValues => ({
  name: '',
  aspectRatio: '16:9',
  resolutionKey: defaultResolutionKeyFor('16:9'),
  fps: '30',
})

/** アスペクト比を変えると解像度プリセットの集合も変わるため、解像度を既定値へ戻す。 */
export const withAspectRatio = (
  values: ProjectFormValues,
  aspectRatio: string,
): ProjectFormValues => {
  const parsed = AspectRatio.safeParse(aspectRatio)
  return {
    ...values,
    aspectRatio,
    resolutionKey: parsed.success ? defaultResolutionKeyFor(parsed.data) : values.resolutionKey,
  }
}

const FIELD_BY_PATH: Readonly<Record<string, ProjectFormField>> = {
  name: 'name',
  aspectRatio: 'aspectRatio',
  resolution: 'resolutionKey',
  fps: 'fps',
}

const fieldForPath = (path: readonly (string | number)[]): ProjectFormField => {
  const head = path[0]
  if (typeof head !== 'string') return 'form'
  return FIELD_BY_PATH[head] ?? 'form'
}

/**
 * 送信前検証。フォームの文字列をドメインの `CreateProjectInput` へ変換し、
 * zod のエラーをフィールド単位のメッセージへ畳み込む。
 */
export const validateProjectForm = (
  values: ProjectFormValues,
  workspaceId: WorkspaceId,
): ProjectFormValidation => {
  const aspectRatio = AspectRatio.safeParse(values.aspectRatio)
  if (!aspectRatio.success) {
    return { ok: false, errors: { aspectRatio: 'アスペクト比を選択してください。' } }
  }

  const resolution = findResolution(aspectRatio.data, values.resolutionKey)
  if (resolution === undefined) {
    return { ok: false, errors: { resolutionKey: '解像度を選択してください。' } }
  }

  const fps = Fps.safeParse(Number(values.fps))
  if (!fps.success) {
    return { ok: false, errors: { fps: 'fps は 24 / 25 / 30 / 60 から選択してください。' } }
  }

  const name = values.name.trim()
  if (name === '') {
    return { ok: false, errors: { name: 'プロジェクト名を入力してください。' } }
  }
  if (name.length > 200) {
    return { ok: false, errors: { name: 'プロジェクト名は 200 文字以内で入力してください。' } }
  }

  const parsed = CreateProjectInput.safeParse({
    workspaceId,
    name,
    aspectRatio: aspectRatio.data,
    resolution,
    fps: fps.data,
  })

  if (!parsed.success) {
    const errors = parsed.error.issues.reduce<FieldErrors>(
      (acc, issue) => {
        const field = fieldForPath(issue.path)
        return field in acc ? acc : { ...acc, [field]: issue.message }
      },
      {},
    )
    return { ok: false, errors }
  }

  return { ok: true, input: parsed.data }
}
