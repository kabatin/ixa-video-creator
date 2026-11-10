import type { ProjectActivity } from '@ixa/domain'
import type { WireProjectListItem } from '@/lib/api-schemas'
import type { PosterView } from '@/lib/shot-posters'

/**
 * 作品一覧の画面（検索・カード・「…」のメニュー）へ渡す 1 行。**一覧が使う欄だけを持つ。**
 *
 * 一覧の部品はブラウザで動くので、渡した値は全部ページに埋め込まれて届く。行をそのまま渡すと、
 * 歌詞・作品の方針・手本画像・予算・見本の印まで全作品分を送ってしまう（一覧では使わない）。
 * サーバのページで `toProjectListEntry` を通してから渡す。部品の props はこの型なので、行は渡せない（`cover` が無い）。
 */
export type ProjectListEntry = Pick<
  WireProjectListItem,
  'id' | 'name' | 'kind' | 'status' | 'createdAt' | 'aspectRatio' | 'resolution' | 'fps'
> & {
  readonly activity: ProjectActivity
  /**
   * 表紙の絵（`pickProjectCover` が選ぶ）。**`undefined` は「呼び出し側がまだ繋いでいない」**（絵の枠ごと出さない）。
   * `url` が null なら「繋がっているが絵が無い」で、`reason` に理由が入る。混ぜない（L-021）。
   */
  readonly cover: PosterView | undefined
}

/** 持つ欄の名前（足すときは、ブラウザへ送ってよいかを確かめてから）。 */
export const PROJECT_LIST_ENTRY_KEYS: readonly (keyof ProjectListEntry)[] = Object.freeze([
  'id', 'name', 'kind', 'status', 'createdAt', 'aspectRatio', 'resolution', 'fps', 'activity', 'cover',
])

/** 一覧の行を、画面へ渡す形に写す。**行を広げて写さない**（使わない欄まで送ることになる）。 */
export const toProjectListEntry = (row: WireProjectListItem, cover: PosterView | undefined): ProjectListEntry => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  status: row.status,
  createdAt: row.createdAt,
  aspectRatio: row.aspectRatio,
  resolution: row.resolution,
  fps: row.fps,
  activity: row.activity,
  cover,
})
