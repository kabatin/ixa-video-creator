import { z } from 'zod'
import { PROJECT_NAME_MAX_LENGTH } from './project.js'

/**
 * 作品の複製で持っていく項目（制作者 2026-10-04「持って行きたいところだけ持っていけるようにすると超便利」）。
 *
 * 名前・画面の形（形・大きさ・fps）・予算は項目ではなく、いつも引き継ぐ。
 * セクションは楽曲の解析の一部で人が直す場所が無いので、楽曲（`music`）にまとめる。
 * **画面の「押せない理由」と API の 422 は、ここの同じ判定を使う。**
 */
export const DUPLICATION_ITEMS = [
  'concept',
  'music',
  'lyricTiming',
  'telops',
  'overlays',
  'characters',
  'locations',
  'brandAssets',
  'shots',
  'storyboard',
  'frames',
  'takes',
] as const

export const DuplicationItem = z.enum(DUPLICATION_ITEMS)
export type DuplicationItem = z.infer<typeof DuplicationItem>

/** 画面の言葉。API の断りの文にも使う（Shot・Take 以外は日本語）。 */
export const DUPLICATION_ITEM_LABELS: Readonly<Record<DuplicationItem, string>> = Object.freeze({
  concept: '作品の方針',
  music: '楽曲（解析・セクションも）',
  lyricTiming: '歌詞の時刻',
  telops: 'テロップ',
  overlays: 'エフェクト・重ね素材・効果音',
  characters: 'キャラクター',
  locations: 'ロケーション',
  brandAssets: 'ブランド資産',
  shots: 'Shot',
  storyboard: '絵コンテ',
  frames: '絵（最初のフレーム）',
  takes: 'Take',
})

/**
 * それを持っていくのに要る項目。
 * - 歌詞の時刻は、同じ曲（楽曲）と歌詞（作品の方針）が無いと意味を持たない
 * - 絵コンテ・絵・Take は Shot に付く
 */
export const DUPLICATION_REQUIRES: Readonly<Record<DuplicationItem, readonly DuplicationItem[]>> = Object.freeze({
  concept: [],
  music: [],
  lyricTiming: ['music', 'concept'],
  telops: [],
  overlays: [],
  characters: [],
  locations: [],
  brandAssets: [],
  shots: [],
  storyboard: ['shots'],
  frames: ['shots'],
  takes: ['shots'],
})

/** その項目に要るのに、選ばれていない項目（要る順）。 */
export const missingRequirements = (
  item: DuplicationItem,
  selected: ReadonlySet<DuplicationItem>,
): readonly DuplicationItem[] => DUPLICATION_REQUIRES[item].filter((required) => !selected.has(required))

/**
 * 要るものが欠けた項目を外す（画面で外したとき、それに頼る項目も外れる）。
 * 依存は 1 段だけだが、増えても崩れないよう落ち着くまで繰り返す。**新しい集合を返す。**
 */
export const settleDuplicationItems = (selected: ReadonlySet<DuplicationItem>): ReadonlySet<DuplicationItem> => {
  const settled = new Set(selected)
  for (;;) {
    const dropped = [...settled].filter((item) => missingRequirements(item, settled).length > 0)
    if (dropped.length === 0) return settled
    for (const item of dropped) settled.delete(item)
  }
}

/** 英字で終わる語（Shot・Take）の後ろには、助詞の前に空白を入れる（「Take を作る」と同じ書き方）。 */
const spaced = (label: string): string => (/[A-Za-z0-9]$/.test(label) ? `${label} ` : label)

const labelOf = (item: DuplicationItem): string => spaced(DUPLICATION_ITEM_LABELS[item])

/** 要るものが欠けた選び方なら、何が要るかの 1 文。そろっていれば null（何も選ばなくてもよい）。 */
export const duplicationProblem = (items: readonly DuplicationItem[]): string | null => {
  const selected = new Set(items)
  for (const item of DUPLICATION_ITEMS) {
    if (!selected.has(item)) continue
    const missing = missingRequirements(item, selected)
    if (missing.length > 0) return `${labelOf(item)}を持っていくには、${missing.map(labelOf).join('と')}も選んでください`
  }
  return null
}

/** 複製の依頼。依存の検査は `duplicationProblem` で別に行う（断る理由を項目の言葉で言うため）。 */
export const DuplicateProjectRequest = z.object({
  name: z.string().trim().min(1, '名前を入れてください').max(PROJECT_NAME_MAX_LENGTH),
  items: z
    .array(DuplicationItem)
    .max(DUPLICATION_ITEMS.length)
    .refine((items) => new Set(items).size === items.length, '同じ項目を 2 回選ばないでください'),
})
export type DuplicateProjectRequest = z.infer<typeof DuplicateProjectRequest>

const COPY_SUFFIX = 'のコピー'

/** 既定の名前。上限を超えるなら元の名前の方を詰める（「のコピー」は残す）。 */
export const duplicateProjectName = (name: string): string =>
  `${name.slice(0, PROJECT_NAME_MAX_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`
