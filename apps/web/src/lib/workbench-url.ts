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

export const MAIN_TABS = ['storyboard', 'preview', 'compare'] as const
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

/** 指定はあるが読めない値のときの行き先。 */
const FALLBACK = Object.freeze({ main: 'storyboard', bottom: 'cutter', side: 'shots' } as const)

type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>

const first = (value: string | readonly string[] | undefined): string | null =>
  (typeof value === 'string' ? value : value?.[0]) ?? null

/** 無ければ null、あるのに知らない値なら `fallback`。 */
const tab = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).nullable().catch(fallback)

const Query = z.object({
  // 不正な Shot ID は無視する（既定の選択＝先頭 Shot で開く）。
  shot: ShotId.nullable().catch(null),
  main: tab(MAIN_TABS, FALLBACK.main),
  bottom: tab(BOTTOM_TABS, FALLBACK.bottom),
  side: tab(SIDE_TABS, FALLBACK.side),
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
 * 旧 URL の行き先（§7.1 の表）。**ページ側の `redirect()` から呼ぶ。**
 * 表を 1 箇所に置き、各リダイレクトページはこれを引くだけにする。
 */
export const LEGACY_SECTIONS = [
  'storyboard',
  'shots',
  'timeline',
  'music',
  'render',
  'settings',
] as const
export type LegacySection = (typeof LEGACY_SECTIONS)[number]

const LEGACY_QUERY: Readonly<Record<LegacySection, Partial<WorkbenchQuery>>> = Object.freeze({
  storyboard: { main: 'storyboard', bottom: 'cutter' },
  shots: { side: 'shots' },
  timeline: { bottom: 'timeline' },
  music: { dialog: 'music' },
  render: { dialog: 'render' },
  settings: { dialog: 'settings' },
})

export const legacySectionHref = (projectId: ProjectId, section: LegacySection): string =>
  workbenchHref(projectId, LEGACY_QUERY[section])

/** `/shots/[id]` の行き先。Take 比較とインスペクターを前に出す。 */
export const legacyShotHref = (projectId: ProjectId, shotId: ShotId): string =>
  workbenchHref(projectId, { shot: shotId, main: 'compare', side: 'inspector' })
