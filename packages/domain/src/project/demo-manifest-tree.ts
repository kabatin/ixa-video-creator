import type { DemoManifest } from './demo-manifest.js'

/**
 * 見本の目録の `source`（JSON の木）を歩く関数（ADR-0067）。純粋。
 * 素材の ID の付け替え（入れる側）と、目録の中の結び付きの点検（入れる側・書き出す側）。
 */

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i

/** JSON の木の文字の値を `fn` で替えた**新しい木**を返す（キーは替えない。元は変えない）。 */
const mapStringValues = (value: unknown, fn: (text: string) => string): unknown => {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map((item: unknown) => mapStringValues(item, fn))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStringValues(item, fn)]))
  }
  return value
}

/** JSON の木の文字の値を、すべて集める（キーは数えない）。 */
const stringValues = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((item: unknown) => stringValues(item))
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap((item) => stringValues(item))
  return []
}

/**
 * 素材の ID を付け替える。**値がちょうど表の ID と一致するものだけ**を替える（ID は ULID なので、ほかの値には当たらない。
 * 列の名前を並べないので、あとで列が増えても漏れない）。キー・表に無い値・ID を含むだけの文字（置き場など）は替えない。
 */
export const remapExactValues = (value: unknown, map: ReadonlyMap<string, string>): unknown =>
  mapStringValues(value, (text) => map.get(text) ?? text)

/** 値に出てくる ULID（どれが素材かは書き出す側が素材の表で引く）。 */
export const ulidValues = (value: unknown): ReadonlySet<string> =>
  new Set(stringValues(value).filter((text) => ULID.test(text)))

/**
 * 目録の外を指してよい欄（キーの名前）。作る人の作業場所と、作る人の作品の外の Take（複製の印）。
 * **入れる側はこの欄の値を素材として引かない**（作業場所は頼んだ所に替え、複製の印は何も引かない）。
 */
export const DEMO_FOREIGN_REFERENCE_KEYS: ReadonlySet<string> = new Set(['workspaceId', 'copiedFromTakeId'])

type Visit = { readonly path: string; readonly key: string | null; readonly value: string }

/** 文字の値を、場所（JSON の道）と、いちばん近いキーの名前と一緒に集める（配列の中はその配列のキー）。 */
const visitStrings = (value: unknown, path: string, key: string | null): readonly Visit[] => {
  if (typeof value === 'string') return [{ path, key, value }]
  if (Array.isArray(value)) return value.flatMap((item: unknown, index) => visitStrings(item, `${path}[${String(index)}]`, key))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([child, item]) => visitStrings(item, `${path}.${child}`, child))
  }
  return []
}

/**
 * 目録の中の結び付きが閉じているか。合わない値の場所（JSON の道）を返す（空なら閉じている）。
 *
 * - ULID の値は、目録の素材（`media[].id`）か、`source` の中で定まった ID（どこかの `id` の値）か、
 *   決まった欄（`DEMO_FOREIGN_REFERENCE_KEYS`）のどれか。**それ以外は、この機械の素材や行に当たりうるので断る**
 *   （素材を指す欄を名前で並べない。列が増えても漏れない）
 * - 定まった ID が素材の ID と重なってはいけない（素材の欄に置かれると付け替えの外で素材として引かれる）
 * - 曲の解析の波形の置き場（`waveformPeaksKey`）は `files[].key` のどれか
 *
 * 定まった ID がこの機械の素材に当たらないかは、入れる側が素材の表で確かめる（`demoDefinedIds`）。
 */
export const demoBindingProblems = (manifest: Pick<DemoManifest, 'media' | 'files' | 'source'>): readonly string[] => {
  const visits = visitStrings(manifest.source, 'source', null)
  const media = new Set<string>(manifest.media.map((entry) => entry.id))
  const defined = new Set(visits.filter((visit) => visit.key === 'id').map((visit) => visit.value))
  const files = new Set<string>(manifest.files.map((entry) => entry.key))
  return visits
    .filter((visit) => {
      if (visit.key === 'waveformPeaksKey') return !files.has(visit.value)
      if (!ULID.test(visit.value)) return false
      if (visit.key === 'id') return media.has(visit.value)
      return !media.has(visit.value) && !defined.has(visit.value) && !DEMO_FOREIGN_REFERENCE_KEYS.has(visit.key ?? '')
    })
    .map((visit) => visit.path)
}

/** `source` の中で定まった ID（どこかの `id` の値）。入れる側が、この機械の素材に当たらないか確かめる。 */
export const demoDefinedIds = (source: unknown): readonly string[] => [
  ...new Set(visitStrings(source, 'source', null).filter((visit) => visit.key === 'id' && ULID.test(visit.value)).map((visit) => visit.value)),
]
