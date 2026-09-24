'use client'

import { AspectRatio, type WorkspaceId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createModelsApi, recommendedFps, type WireVideoModel } from '@/lib/models-api'
import { createRequester } from '@/lib/requester'
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
import { workbenchHref } from '@/lib/workbench-url'
import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { FieldError } from '@/components/form/field-error'

export type ProjectFormProps = {
  readonly workspaceId: WorkspaceId
}

const aspectOptions = ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))
const fpsOptions = FPS_OPTIONS.map((fps) => ({ value: String(fps), label: `${String(fps)} fps` }))

/** 「決めていない」を表す値。選ばなくても作れる（fps は手で選べる）。 */
const NO_MODEL = ''

export const ProjectForm = ({ workspaceId }: ProjectFormProps) => {
  const modelsApi = useMemo(() => createModelsApi(createRequester(resolveApiBaseUrl())), [])
  const [models, setModels] = useState<readonly WireVideoModel[]>([])
  const [intendedModel, setIntendedModel] = useState<string>(NO_MODEL)

  /**
   * 読めなくても作成は止めない。**モデルの一覧は fps を決める手助けであって、必須ではない。**
   * 読めなかったことは選択肢の側に出す（空と混ぜない。L-015）。
   */
  const [modelsError, setModelsError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    modelsApi
      .listModels()
      .then((list) => {
        if (!cancelled) setModels(list)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setModelsError(describeError(cause))
      })
    return () => {
      cancelled = true
    }
  }, [modelsApi])

  const modelOptions = [
    {
      value: NO_MODEL,
      label:
        modelsError !== null
          ? 'モデルの一覧を取れませんでした（fps は手で選べます）'
          : '選ばない（fps を手で決める）',
    },
    ...models.map((model) => ({
      value: model.id,
      label: `${model.label}（${model.fps.join(' / ')} fps）`,
    })),
  ]

  const chosenModel = models.find((model) => model.id === intendedModel) ?? null
  const modelHint =
    chosenModel === null
      ? null
      : `このモデルの素材は ${chosenModel.fps.join(' / ')} fps です。` +
        `合わせておくと、書き出しで引き伸ばさずに済みます。参照画像は ${String(chosenModel.maxReferenceImages)} 枚まで。`

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

      {/**
        * **どの AI で作るつもりかを先に選ぶと、fps が付いてくる。**
        * 素材が 24fps なのに Project を 30fps にすると、書き出しで引き伸ばされて
        * 無い絵を作ることになる（`render/ffmpeg-filters.ts` が毎クリップに
        * `fps=doc.fps` を掛ける）。性質は `GET /models` の宣言から引く。画面に書き写さない。
        */}
      <SelectField
        id="intendedModel"
        label="使う映像生成 AI"
        value={intendedModel}
        options={modelOptions}
        disabled={submitting || models.length === 0}
        onChange={(modelId) => {
          setIntendedModel(modelId)
          const chosen = models.find((model) => model.id === modelId)
          const fps = chosen === undefined ? null : recommendedFps(chosen)
          // **上書きするのは選んだ瞬間だけ。** そのあと手で変えたものを勝手に戻さない。
          if (fps !== null) setValues((current) => ({ ...current, fps: String(fps) }))
        }}
      />

      {modelHint !== null && <p className="-mt-2 text-xs text-muted">{modelHint}</p>}

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
          やめる
        </a>
      </div>
    </form>
  )
}
