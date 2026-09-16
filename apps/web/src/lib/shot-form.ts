import { ShotCamera } from '@ixa/domain'
import { CreateShotBody } from '@/lib/api-schemas'
import { DEFAULT_SHOT_SIZE, NONE_VALUE } from '@/lib/camera-options'

/**
 * Shot 作成フォームの値と送信前検証。
 * 画面（React）から切り離した純粋関数にして、ブラウザ無しでテストできるようにする。
 */

export type ShotFormValues = {
  readonly code: string
  readonly startSec: string
  readonly durationSec: string
  readonly description: string
  readonly mood: string
  readonly size: string
  readonly angleH: string
  readonly angle: string
  readonly lensMm: string
  readonly movement: string
  readonly movementIntensity: string
}

export type ShotFormField = keyof ShotFormValues | 'form'

export type ShotFormErrors = Readonly<Partial<Record<ShotFormField, string>>>

export type ShotFormValidation =
  | { readonly ok: true; readonly input: CreateShotBody }
  | { readonly ok: false; readonly errors: ShotFormErrors }

export const initialShotFormValues = (startSec = 0): ShotFormValues => ({
  code: '',
  startSec: String(startSec),
  durationSec: '4',
  description: '',
  mood: '',
  size: DEFAULT_SHOT_SIZE,
  angleH: NONE_VALUE,
  angle: NONE_VALUE,
  lensMm: NONE_VALUE,
  movement: NONE_VALUE,
  movementIntensity: NONE_VALUE,
})

const nullIfNone = (raw: string): string | null => (raw === NONE_VALUE ? null : raw)

/** 空文字を数値へ落とさない。`Number('')` は 0 になり、未入力を 0 と誤認するため。 */
const toNumber = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const FIELD_BY_CAMERA_KEY: Readonly<Record<string, ShotFormField>> = {
  size: 'size',
  angleH: 'angleH',
  angle: 'angle',
  lensMm: 'lensMm',
  movement: 'movement',
  movementIntensity: 'movementIntensity',
}

const FIELD_BY_PATH: Readonly<Record<string, ShotFormField>> = {
  code: 'code',
  startSec: 'startSec',
  durationSec: 'durationSec',
  description: 'description',
  mood: 'mood',
}

const fieldForPath = (path: readonly (string | number)[]): ShotFormField => {
  const [head, next] = path
  if (typeof head !== 'string') return 'form'
  if (head === 'camera' && typeof next === 'string') return FIELD_BY_CAMERA_KEY[next] ?? 'form'
  return FIELD_BY_PATH[head] ?? 'form'
}

const collectErrors = (issues: readonly { path: (string | number)[]; message: string }[]) =>
  issues.reduce<ShotFormErrors>((acc, issue) => {
    const field = fieldForPath(issue.path)
    return field in acc ? acc : { ...acc, [field]: issue.message }
  }, {})

export type BuildShotInput = {
  readonly values: ShotFormValues
  readonly order: number
}

/**
 * フォームの文字列をドメインの `CreateShotInput`（projectId 抜き）へ変換する。
 * 数値・null 変換で潰れる情報を先に検査し、残りは zod に委ねる。
 */
export const validateShotForm = ({ values, order }: BuildShotInput): ShotFormValidation => {
  const code = values.code.trim()
  if (code === '') {
    return { ok: false, errors: { code: 'ショットコードを入力してください。' } }
  }

  const startSec = toNumber(values.startSec)
  if (startSec === null || startSec < 0) {
    return { ok: false, errors: { startSec: '開始秒は 0 以上の数値で入力してください。' } }
  }

  const durationSec = toNumber(values.durationSec)
  if (durationSec === null || durationSec <= 0) {
    return { ok: false, errors: { durationSec: '尺は 0 より大きい数値で入力してください。' } }
  }

  const lensRaw = nullIfNone(values.lensMm.trim())
  const lensMm = lensRaw === null ? null : toNumber(lensRaw)
  if (lensRaw !== null && (lensMm === null || lensMm <= 0)) {
    return { ok: false, errors: { lensMm: 'レンズは 0 より大きい mm 値で入力してください。' } }
  }

  const camera = ShotCamera.safeParse({
    size: values.size,
    angleH: nullIfNone(values.angleH),
    angle: nullIfNone(values.angle),
    lensMm,
    movement: nullIfNone(values.movement),
    movementIntensity: nullIfNone(values.movementIntensity),
  })
  if (!camera.success) {
    return {
      ok: false,
      errors: collectErrors(
        camera.error.issues.map((issue) => ({
          path: ['camera', ...issue.path],
          message: issue.message,
        })),
      ),
    }
  }

  const parsed = CreateShotBody.safeParse({
    sequenceId: null,
    order,
    code,
    startSec,
    durationSec,
    sourceInSec: 0,
    description: values.description.trim(),
    dialogue: null,
    camera: camera.data,
    mood: values.mood.trim() === '' ? null : values.mood.trim(),
    // Phase 1 の生成対象は AI 動画のみ（docs/ARCHITECTURE.md §11）。
    sourceType: { type: 'ai_video' },
    status: 'draft',
  })

  if (!parsed.success) return { ok: false, errors: collectErrors(parsed.error.issues) }

  return { ok: true, input: parsed.data }
}
