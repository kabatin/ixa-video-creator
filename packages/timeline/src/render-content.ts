/**
 * 2 つの書き出しが**同じ中身**になるかを、書き出す前に見分ける（制作者 2026-10-09
 * 「時間かけて書き出ししてから保存で失敗すると時間の無駄だし UX 最悪なので事前に分かるようにしたい」）。
 *
 * 書き出しは決定的で、同じ文書なら同じバイト列になる。ただし文書の中の素材の URL は**署名付き**で、
 * 発行のたびに署名と期限（`?` 以降）が変わる。そこだけを落として比べる（パスには素材の置き場が入っている）。
 *
 * **同じと言えるのは「文書が同じ」まで。** アプリを更新して描き方が変わっていれば、同じ文書でも
 * 結果は変わりうる。だから見分けたあとは自動で飛ばさず、人に選ばせる。
 */

/** 署名付き URL の署名と期限を落とす。URL でない文字列はそのまま。 */
const withoutSignature = (value: string): string =>
  /^https?:\/\//u.test(value) ? (value.split('?')[0] ?? value) : value

/**
 * 鍵の順を揃えた形。DB（jsonb）から読んだ文書は鍵の順が変わるので、そのまま文字列にすると
 * 同じ中身でも違って見える。
 */
const canonical = (value: unknown): unknown => {
  if (typeof value === 'string') return withoutSignature(value)
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, unknown>>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])] as const),
    )
  }
  return value
}

/** 比べるための鍵。同じ鍵なら同じ中身の書き出しになる（同じ描き方である限り）。 */
export const renderContentKey = (value: unknown): string => JSON.stringify(canonical(value))
