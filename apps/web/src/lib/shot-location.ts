import { LocationId, type Location } from '@ixa/domain'
import { NO_LOCATION_VALUE } from '@/lib/location-options'

/**
 * Shot 詳細でロケーションを「見る」「付け替える」ための変換。
 * 表示と保存の両方が同じ「未設定 = null / select の空文字」という約束に依存するので、
 * 画面側に散らさずここへ集める（ADR-0015）。
 */

/** 未設定の見え方は Shot 詳細の他項目（mood など）と揃える。 */
export const NO_LOCATION_DISPLAY = '—'

/**
 * 表示用のロケーション名。
 *
 * 一覧を読み込めなかったときや、選択中のロケーションが削除済みのときは名前を引けない。
 * ここで「—」に潰すと「外れている」と誤解され、気付かないまま参照画像が渡り続ける。
 * そのため引けない場合は ID をそのまま出し、設定済みであることだけは失わせない。
 */
export const describeLocation = (
  locationId: string | null,
  locations: readonly Location[],
): string => {
  if (locationId === null || locationId === NO_LOCATION_VALUE) return NO_LOCATION_DISPLAY

  const found = locations.find((location) => location.id === locationId)
  return found === undefined ? locationId : found.name
}

/** 保存済みの値を select の値へ戻す。null と空文字の対応をここ一箇所で決める。 */
export const toLocationFieldValue = (locationId: string | null): string =>
  locationId === null ? NO_LOCATION_VALUE : locationId

export const INVALID_LOCATION_MESSAGE =
  '選択されたロケーションの ID が不正です。画面を再読み込みしてください。'

export type LocationPatchResult =
  | { readonly ok: true; readonly locationId: LocationId | null }
  | { readonly ok: false; readonly message: string }

/**
 * select の値を `PATCH /shots/{id}` の locationId へ正規化する。
 * 空文字は「なし」＝解除なので null にする。ULID かどうかの判定は zod に委ね、UI で形を持たない。
 */
export const toLocationPatch = (value: string): LocationPatchResult => {
  if (value === NO_LOCATION_VALUE) return { ok: true, locationId: null }

  const parsed = LocationId.safeParse(value)
  if (!parsed.success) return { ok: false, message: INVALID_LOCATION_MESSAGE }

  return { ok: true, locationId: parsed.data }
}
