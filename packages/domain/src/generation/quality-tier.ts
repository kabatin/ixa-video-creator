import { z } from 'zod'

/**
 * 同じ Provider の中での**生成の段**（ADR-0042）。
 *
 * 試作（速い・低解像度）で仕様を決め、本番（遅い・学習時の解像度）で作り直す。
 * 段は Provider ごとの事情なので、**モデルの宣言が持つ**。ID の文字列から導かない。
 *
 * ここが唯一の正。Provider の宣言（`provider-core`）・API の `/models`・画面は
 * すべてこの値を使う。**3 か所に同じ並びを書き写すと、段を増やした日にズレる**（L-016）。
 */
export const QualityTier = z.enum(['draft', 'standard', 'final'])
export type QualityTier = z.infer<typeof QualityTier>

/**
 * 「本番で作り直す」ときに Take へ残す理由（`regenerationReason`）。
 *
 * **1 本ずつ押す経路（画面）とまとめて積む経路（API）で同じ文字にする。**
 * 違う文字で残すと、あとから「本番で作り直した Take」をまとめて数えられない。
 */
export const REMAKE_FINAL_REASON = '本番で作り直す'

/**
 * 段を見分けるのに要る最小の形。
 *
 * Provider の宣言（`VideoModelDescriptor`）にも API が返す行（`WireVideoModel`）にも当たる。
 * **`qualityTier` は省略可能**（段を持たない Provider がある）。
 */
export type TieredModel = {
  readonly id: string
  readonly providerId: string
  readonly qualityTier?: QualityTier | null
}

/**
 * その Take を「本番で作り直す」ときに使うモデル（ADR-0042）。
 *
 * **同じ Provider の、段が `final` のモデル**を一覧から探す。
 * 見つからなければ `null`（その環境に本番の段が無い。操作を出さない・断る）。
 *
 * - 元のモデルが一覧に無ければ `null`。**別の Provider の本番に逃がさない。**
 *   逃がすと、頼んだのと違う AI で課金つきの生成が走り、できた動画を見るまで誰も気づけない
 * - **元のモデルが段を宣言していなければ `null`。** 段を持たないモデルは、同じ Provider の
 *   本番と同じ系列とは限らない（別の系列の本番に飛ぶと、絵がまるごと変わる）
 * - 元が既に本番なら、それ自身が返る。「作り直す必要が無い」の判定は呼ぶ側が持つ
 */
export const finalTierModelOf = <M extends TieredModel>(
  models: readonly M[],
  sourceModelId: string,
): M | null => {
  const source = models.find((model) => model.id === sourceModelId)
  if (source === undefined) return null
  if (source.qualityTier === undefined || source.qualityTier === null) return null
  return (
    models.find(
      (model) => model.providerId === source.providerId && model.qualityTier === 'final',
    ) ?? null
  )
}
