import { ShotCamera, type Shot } from '@ixa/domain'
import { z } from 'zod'
import { ApiError, describeError } from '@/lib/api-error'
import type { UpdateShotBody } from '@/lib/api-schemas'
import { NONE_VALUE } from '@/lib/camera-options'
import { initialShotFormValues, type ShotFormValues } from '@/lib/shot-form'

/**
 * Shot 編集フォームの値と送信前検証。
 * 画面（React）から切り離した純粋関数にして、ブラウザ無しでテストできるようにする。
 * 作成側の `shot-form.ts` と対になる。
 *
 * **扱う列は `PATCH /shots/{id}` が受け付けるものだけ。**
 * ロケーションは `shot-location-editor.tsx` が別に持つため、ここでは触らない。
 */

export type ShotEditFormValues = {
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

export type ShotEditFormField = keyof ShotEditFormValues | 'form'

export type ShotEditFormErrors = Readonly<Partial<Record<ShotEditFormField, string>>>

export type ShotEditValidation =
  | { readonly ok: true; readonly patch: UpdateShotBody }
  | { readonly ok: false; readonly errors: ShotEditFormErrors }

/** 編集対象の列だけを見る。Shot 全体を要求すると、保存後の差し替えが重くなる。 */
export type EditableShot = Pick<
  Shot,
  'code' | 'startSec' | 'durationSec' | 'description' | 'mood' | 'camera'
>

export const EDITABLE_FIELDS: readonly (keyof ShotEditFormValues)[] = [
  'code',
  'startSec',
  'durationSec',
  'description',
  'mood',
  'size',
  'angleH',
  'angle',
  'lensMm',
  'movement',
  'movementIntensity',
]

const fromNullableText = (value: string | null): string => value ?? NONE_VALUE

const fromNullableNumber = (value: number | null): string =>
  value === null ? NONE_VALUE : String(value)

/** 保存済みの Shot をフォームの文字列へ戻す。null と「未指定」の対応をここ一箇所で決める。 */
export const initialShotEditValues = (shot: EditableShot): ShotEditFormValues => ({
  code: shot.code,
  startSec: String(shot.startSec),
  durationSec: String(shot.durationSec),
  description: shot.description,
  // mood は未設定が null。入力欄では空文字で表し、保存時に null へ戻す。
  mood: shot.mood ?? '',
  size: shot.camera.size,
  angleH: fromNullableText(shot.camera.angleH),
  angle: fromNullableText(shot.camera.angle),
  lensMm: fromNullableNumber(shot.camera.lensMm),
  movement: fromNullableText(shot.camera.movement),
  movementIntensity: fromNullableText(shot.camera.movementIntensity),
})

/**
 * 保存済みの値から動いたか。
 *
 * **保存ボタンを常に押せるようにしない。** 変化が無いまま PATCH を投げると
 * 画面は「保存しました」と言うのに何も変わっておらず、
 * 利用者は編集が効いたかどうかを判断できなくなる。
 */
export const isShotEditDirty = (values: ShotEditFormValues, saved: EditableShot): boolean => {
  const base = initialShotEditValues(saved)
  return EDITABLE_FIELDS.some((field) => values[field] !== base[field])
}

/**
 * カメラ入力欄（`CameraFields`）は作成フォームの値の形を要求する。
 * 編集で扱わない列は作成時の初期値で埋めて渡す。埋めた値は送信に使わない。
 */
export const toCameraFieldValues = (values: ShotEditFormValues): ShotFormValues => ({
  ...initialShotFormValues(),
  ...values,
})

const nullIfNone = (raw: string): string | null => (raw === NONE_VALUE ? null : raw)

/** 空文字を数値へ落とさない。`Number('')` は 0 になり、未入力を 0 と誤認するため。 */
const toNumber = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const FIELD_BY_CAMERA_KEY: Readonly<Record<string, ShotEditFormField>> = {
  size: 'size',
  angleH: 'angleH',
  angle: 'angle',
  lensMm: 'lensMm',
  movement: 'movement',
  movementIntensity: 'movementIntensity',
}

/** 未知のキーは `form` に落とす。取りこぼした指摘を黙って捨てないため。 */
const cameraFieldForPath = (path: readonly (string | number)[]): ShotEditFormField => {
  const [head] = path
  if (typeof head !== 'string') return 'form'
  return FIELD_BY_CAMERA_KEY[head] ?? 'form'
}

const collectCameraErrors = (
  issues: readonly { path: (string | number)[]; message: string }[],
): ShotEditFormErrors =>
  issues.reduce<ShotEditFormErrors>((acc, issue) => {
    const field = cameraFieldForPath(issue.path)
    return field in acc ? acc : { ...acc, [field]: issue.message }
  }, {})

/**
 * フォームの文字列を `PATCH /shots/{id}` の本文へ変換する。
 *
 * **成功時は必ず 4 列すべてを載せる。** 変わった列だけを拾う作りにすると、
 * 何も変わっていないときに空の本文が出来上がり、サーバは 200 を返す。
 * 「保存された」と「何も送っていない」が区別できなくなる。
 * 変化の有無は `isShotEditDirty` が別に判断する。
 */
export const validateShotEditForm = (values: ShotEditFormValues): ShotEditValidation => {
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
    return { ok: false, errors: collectCameraErrors(camera.error.issues) }
  }

  const mood = values.mood.trim()

  return {
    ok: true,
    patch: {
      code,
      startSec,
      durationSec,
      description: values.description.trim(),
      // 空欄は「mood なし」。空文字のまま送ると、未設定と「空という指定」が混ざる。
      mood: mood === '' ? null : mood,
      camera: camera.data,
    },
  }
}

/**
 * サーバが返したフィールド別エラーの形（`apps/api/src/response.ts` の `ErrorResponse`）。
 * ここで検証するのは、200 以外の本文が必ず JSON とは限らないため。
 */
const ApiErrorBody = z.object({
  error: z.string().optional(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
})

/**
 * フィールド名の対応表。サーバ側のキーは zod の `issue.path.join('.')` なので、
 * カメラの列は `camera.size` のような入れ子の名前で届く。
 */
const FIELD_BY_API_KEY: Readonly<Record<string, ShotEditFormField>> = {
  code: 'code',
  startSec: 'startSec',
  durationSec: 'durationSec',
  description: 'description',
  mood: 'mood',
  'camera.size': 'size',
  'camera.angleH': 'angleH',
  'camera.angle': 'angle',
  'camera.lensMm': 'lensMm',
  'camera.movement': 'movement',
  'camera.movementIntensity': 'movementIntensity',
}

export const SAVE_FAILED_PREFIX = 'Shot を保存できませんでした'

/** 本文が JSON でないこともある。読めなければ null にして、呼び出し側の既定文に委ねる。 */
const parseJsonOrNull = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

const appendToForm = (current: string | undefined, addition: string): string =>
  current === undefined ? addition : `${current} / ${addition}`

/**
 * 保存が失敗したときのエラーを、入力欄に貼れる形へ落とす。
 *
 * 一番効くのはコードの重複（`(project_id, code)` が UNIQUE）で、
 * サーバは 422 と `fields.code` で理由を返す。これを欄の下に出さないと、
 * 利用者には「保存が効かない」としか見えない。
 *
 * **空を返さない。** 対応表に無いキーだけが返ってきた場合に `{}` を返すと、
 * 画面はエラーを 1 つも出さないまま値だけが元に戻り、
 * 「保存した」と「拒否された」が区別できなくなる（lessons L-015）。
 * 拾えなかった指摘は欄名を添えて `form` にまとめる。
 */
export const shotEditErrorsFromApi = (error: unknown): ShotEditFormErrors => {
  const fallback: ShotEditFormErrors = {
    form: `${SAVE_FAILED_PREFIX}: ${describeError(error)}`,
  }

  if (!(error instanceof ApiError)) return fallback

  const parsed = ApiErrorBody.safeParse(parseJsonOrNull(error.body))
  const fields = parsed.success ? parsed.data.fields : undefined
  if (fields === undefined) return fallback

  const mapped = Object.entries(fields).reduce<ShotEditFormErrors>((acc, [key, messages]) => {
    const message = messages.join(' / ')
    if (message === '') return acc

    const field = FIELD_BY_API_KEY[key]
    if (field === undefined) {
      // 画面に欄が無い列の指摘。捨てると、拒否された事実ごと消える。
      return { ...acc, form: appendToForm(acc.form, `${key}: ${message}`) }
    }
    return field in acc ? acc : { ...acc, [field]: message }
  }, {})

  return Object.keys(mapped).length === 0 ? fallback : mapped
}
