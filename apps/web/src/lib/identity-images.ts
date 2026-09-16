import { IdentityImageRole, type CharacterIdentityImage } from '@ixa/domain'

/**
 * 識別画像の役割と四面図の扱い（docs/ARCHITECTURE.md §8）。
 *
 * Veo と Runway は参照画像を 3 枚しか受け付けない。
 * 正面・側面・全身を個別に渡すと 3 枠を使い切り、衣装やロケーションを渡せなくなる。
 * `four_view`（正面/側面/背面/斜めを 1 枚に集約したターンアラウンドシート）なら
 * 1 枠で同じ情報量を渡せるため、参照枠の少ないモデルで有利になる。
 */

export type Option = {
  readonly value: string
  readonly label: string
}

/** 参照枠を節約できる唯一の role。判定を文字列リテラルで散らさないため enum から引く。 */
export const FOUR_VIEW_ROLE = IdentityImageRole.enum.four_view

const ROLE_LABELS: Readonly<Record<IdentityImageRole, string>> = {
  four_view: '四面図',
  face_front: '顔（正面）',
  face_side: '顔（側面）',
  face_three_quarter: '顔（斜め）',
  full_body: '全身',
  profile: 'プロフィール',
}

const ROLE_HINTS: Readonly<Record<IdentityImageRole, string>> = {
  four_view: '正面・側面・背面・斜めを 1 枚に集約。参照枠 1 つで同一性を渡せる',
  face_front: '顔の正面。四面図が無いときの基本参照',
  face_side: '顔の側面。単体では参照枠を 1 つ消費する',
  face_three_quarter: '顔の斜め。単体では参照枠を 1 つ消費する',
  full_body: '全身。体型と身長を伝える',
  profile: '人物紹介などの参考画像',
}

export const identityRoleLabel = (role: IdentityImageRole): string => ROLE_LABELS[role]

export const identityRoleHint = (role: IdentityImageRole): string => ROLE_HINTS[role]

export const IDENTITY_ROLE_OPTIONS: readonly Option[] = IdentityImageRole.options.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}))

/** 登録フォームの初期値。参照枠を節約できる四面図を最初に促す。 */
export const DEFAULT_IDENTITY_ROLE: IdentityImageRole = FOUR_VIEW_ROLE

export const FOUR_VIEW_NOTICE =
  '四面図（four_view）は正面・側面・背面・斜めを 1 枚にまとめたターンアラウンドシートです。' +
  '参照画像を 3 枚しか受け付けないモデル（Veo / Runway）でも、1 枠で人物の同一性を渡せます。' +
  '残りの枠を衣装とロケーションに回せるため、まず四面図を登録してください。'

export const FOUR_VIEW_ABSENT_HINT =
  '四面図がありません。顔と全身を個別に渡すと参照枠を使い切り、衣装やロケーションを渡せなくなります。'

type RoleBearing = Pick<CharacterIdentityImage, 'role'>

/** 四面図が登録されているか。参照枠の節約が効くかどうかの判定そのもの。 */
export const hasFourView = (images: readonly RoleBearing[]): boolean =>
  images.some((image) => image.role === FOUR_VIEW_ROLE)

export type IdentityImageSummary = {
  readonly total: number
  readonly hasFourView: boolean
  readonly hasAny: boolean
}

export const summarizeIdentityImages = (
  images: readonly RoleBearing[],
): IdentityImageSummary => ({
  total: images.length,
  hasFourView: hasFourView(images),
  hasAny: images.length > 0,
})

/**
 * 同じ role の中で主画像は 1 枚だけという不変条件を画面で示すために、
 * role ごとに主画像を引けるようにする。
 */
export const primaryImageOfRole = (
  images: readonly CharacterIdentityImage[],
  role: IdentityImageRole,
): CharacterIdentityImage | undefined =>
  images.find((image) => image.role === role && image.isPrimary)

/** role ごとの枚数。表示順は enum の宣言順に揃える。 */
export const countByRole = (
  images: readonly RoleBearing[],
): ReadonlyMap<IdentityImageRole, number> =>
  new Map(
    IdentityImageRole.options.map((role) => [
      role,
      images.filter((image) => image.role === role).length,
    ]),
  )
