import { ShotId, type ProjectId } from '@ixa/domain'
import { z } from 'zod'

/**
 * ワークベンチの URL（UI-WORKBENCH §7.1）。**React を含まない。**
 *
 * `?` は開くときに一度読むだけ。開いた後の操作で URL は書き換えない
 * （操作のたびに履歴が増えるのを避ける）。共有したいときは現在値から作り直す。
 *
 * **読めない値は既定へ倒す。** 古いリンクや打ち間違いでワークベンチが開かないのは困る。
 */

/** 中央上のタブ。**`PANEL_SPECS` の `area: 'main'` と同じ集合であること**（テストで検査）。 */
export const MAIN_TABS = ['storyboard', 'preview', 'compare', 'viewer', 'draft', 'narration'] as const
export type MainTab = (typeof MAIN_TABS)[number]

export const BOTTOM_TABS = ['cutter', 'timeline'] as const
export type BottomTab = (typeof BOTTOM_TABS)[number]

export const SIDE_TABS = ['shots', 'inspector'] as const
export type SideTab = (typeof SIDE_TABS)[number]

/** URL から開けるダイアログ。内部だけで開くもの（新規 Shot など）はここに入れない。 */
export const URL_DIALOGS = ['music', 'render', 'settings'] as const
export type UrlDialog = (typeof URL_DIALOGS)[number]

/**
 * **`null` は「指定なし」。** 指定の無いタブは保存した配置のまま開く
 * （開くたびに既定のタブへ戻すと、配置を覚えている意味が無い）。
 */
export type WorkbenchQuery = {
  readonly shot: ShotId | null
  readonly main: MainTab | null
  readonly bottom: BottomTab | null
  readonly side: SideTab | null
  readonly dialog: UrlDialog | null
}

export const EMPTY_WORKBENCH_QUERY: WorkbenchQuery = Object.freeze({
  shot: null,
  main: null,
  bottom: null,
  side: null,
  dialog: null,
})

type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>

const first = (value: string | readonly string[] | undefined): string | null =>
  (typeof value === 'string' ? value : value?.[0]) ?? null

/**
 * 無ければ null、**あるのに知らない値でも null**。
 *
 * 以前は知らない値を既定のタブ（storyboard など）へ倒していた。しかし
 * この関数の `null` は「指定なし＝保存した配置のまま開く」を意味するので、
 * 打ち間違いや古いリンクが**利用者の配置を勝手に書き換える**ことになっていた。
 * 読めない指定は「指定が無かった」と同じに扱うのが、この型の約束に合う。
 */
const tab = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).nullable().catch(null)

const Query = z.object({
  // 不正な Shot ID は無視する（既定の選択＝先頭 Shot で開く）。
  shot: ShotId.nullable().catch(null),
  main: tab(MAIN_TABS),
  bottom: tab(BOTTOM_TABS),
  side: tab(SIDE_TABS),
  // 知らないダイアログは開かない。開けないものの代わりに別のものを開かない。
  dialog: z.enum(URL_DIALOGS).nullable().catch(null),
})

export const parseWorkbenchQuery = (params: RawParams): WorkbenchQuery =>
  Query.parse({
    shot: first(params['shot']),
    main: first(params['main']),
    bottom: first(params['bottom']),
    side: first(params['side']),
    dialog: first(params['dialog']),
  })

/** ワークベンチの URL を組む。指定したものだけを書く。 */
export const workbenchHref = (
  projectId: ProjectId,
  query: Partial<WorkbenchQuery> = {},
): string => {
  const params = new URLSearchParams()
  const entries: readonly (readonly [keyof WorkbenchQuery, string | null | undefined])[] = [
    ['shot', query.shot],
    ['main', query.main],
    ['bottom', query.bottom],
    ['side', query.side],
    ['dialog', query.dialog],
  ]
  entries.forEach(([key, value]) => {
    if (value !== null && value !== undefined) params.set(key, value)
  })
  const search = params.toString()
  return `/projects/${encodeURIComponent(projectId)}${search === '' ? '' : `?${search}`}`
}

/**
 * その Shot を開いたワークベンチ。Take 比較とインスペクターを前に出す。
 *
 * Shot を指すリンクはすべてこれを通す。以前は `/shots/[id]?projectId=` という
 * 別ページがあり、その行き先を組む表がここに別途あった。ページごと畳んだので、
 * 行き先は 1 本になった。
 */
export const shotHref = (projectId: ProjectId, shotId: ShotId): string =>
  workbenchHref(projectId, { shot: shotId, main: 'compare', side: 'inspector' })
