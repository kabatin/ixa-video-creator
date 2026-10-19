import type { ProjectId } from '@ixa/domain'
import type { AddPanelOptions, SerializedDockview } from 'dockview-react'
import { z } from 'zod'

/**
 * ワークベンチの配置（UI-WORKBENCH §3 / §6 / §8）。**React を含まない。**
 * ADR-0020 の `storyboard-layout.ts` を Project 全体へ一般化したもの。
 *
 * - 既定配置は `addDefaultPanels` の 1 箇所。**`addPanel` の順序を固定**し、テストで検査する
 *   （入れ子が意図どおりに並ばない危険を §12 で挙げた）
 * - プリセットは前に出すタブを変えるだけ。パネルの位置・大きさは動かさない（§6）
 * - 保存は Project ごと・版ごとに `localStorage`。制作データではない（ADR-0020）
 */

/** 区画。パネルが「どこに住むか」。閉じたパネルを戻すときの行き先になる。 */
export type DockArea = 'main' | 'bottom' | 'side' | 'left'

export const PANEL_IDS = [
  'storyboard',
  'preview',
  'compare',
  'viewer',
  'draft',
  'narration',
  'cutter',
  'timeline',
  'checks',
  'history',
  'console',
  'shots',
  'inspector',
  'assets',
] as const
export type PanelId = (typeof PANEL_IDS)[number]

type PanelSpec = {
  readonly title: string
  readonly area: DockArea
}

/**
 * パネルの名前。**メニューの項目名（`menu-model.ts`）と必ず一致させること。**
 * 突き合わせは `menu-panel-names.test.ts` が検査する。
 *
 * 名前の付け方:
 * - そこで**何をするか**が読めること（「聴きながら切る」が一番良い例）
 * - 英語のままにするのは Shot / Take / Look の 3 語だけ。
 *   これらは `docs/DOMAIN.md` のドメイン語で、訳すと DB の列名や API と食い違う。
 *   それ以外（キャラクター・ロケーション・ブランド資産・楽曲）は日本語にする。
 * - 同じ語を別の意味で使わない。「素材」はワークスペースの素材全体を指すので、
 *   その 1 件を大きく見るパネルは「素材ビューア」と呼び分ける。
 *   Shot の状態「下書き」と紛れるので、AI の案の一覧は「絵コンテの案」と呼ぶ。
 */
export const PANEL_SPECS: Readonly<Record<PanelId, PanelSpec>> = Object.freeze({
  storyboard: { title: 'ストーリーボード', area: 'main' },
  preview: { title: 'プレビュー', area: 'main' },
  compare: { title: 'Take 比較', area: 'main' },
  viewer: { title: '素材ビューア', area: 'main' },
  draft: { title: '絵コンテの案', area: 'main' },
  narration: { title: 'ナレーション', area: 'main' },
  cutter: { title: '聴きながら切る', area: 'bottom' },
  timeline: { title: 'タイムライン', area: 'bottom' },
  checks: { title: '検査', area: 'bottom' },
  history: { title: '変更履歴', area: 'bottom' },
  console: { title: 'コンソール', area: 'bottom' },
  shots: { title: 'Shot 一覧', area: 'side' },
  inspector: { title: 'インスペクター', area: 'side' },
  assets: { title: '素材ツリー', area: 'left' },
})

/**
 * 区画の幅（px）。1440×900 で中央 ≈ 840px になる値（§5.3）。
 *
 * 右は 320 だった。Shot 一覧の表は 7 列（選択 / # / サムネイル / コード / 尺 / 拍 / 状態）で、
 * いちばん長い状態ラベル「採用済み」が出ると 344px 要る。320 のままだと**既定の幅で
 * 横スクロールバーが出る**。列を足したらこの数字を見直すこと。
 */
export const LEFT_WIDTH_PX = 240
export const SIDE_WIDTH_PX = 360

/**
 * 区画に初めて置くときの位置。中央上を起点に、下・右・左へ広げる。
 * 中央下は中央上のどれかの下に付ける。中央上が 1 枚も無ければ全体の下へ。
 */
const areaAnchor = (
  area: DockArea,
  mainPanel: string | null,
): AddPanelOptions['position'] | undefined => {
  switch (area) {
    case 'main':
      return undefined
    case 'bottom':
      return mainPanel === null
        ? { direction: 'below' }
        : { referencePanel: mainPanel, direction: 'below' }
    case 'side':
      return { direction: 'right' }
    case 'left':
      return { direction: 'left' }
  }
}

const AREA_WIDTHS: Readonly<Partial<Record<DockArea, number>>> = Object.freeze({
  side: SIDE_WIDTH_PX,
  left: LEFT_WIDTH_PX,
})

/**
 * 区画ごとに先頭が表、残りが裏のタブ。**この順で `addPanel` する。**
 * 下の区画はタイムラインが先（制作者 2026-10-19「既定のタブはタイムライン」）。
 * 聴きながら切るは、曲を入れたとき・Shot がまだ無いときだけ前に出す（`shouldFrontCutter`）。
 */
const DEFAULT_ORDER: readonly PanelId[] = [
  'storyboard',
  'preview',
  'compare',
  'viewer',
  'draft',
  'narration',
  'timeline',
  'cutter',
  'checks',
  'history',
  'console',
  'shots',
  'inspector',
  'assets',
]

/** テストから差し替えられるよう、使う口だけに絞る。 */
export type DockLike = {
  readonly addPanel: (options: AddPanelOptions) => unknown
  readonly getPanel: (
    id: string,
  ) => { readonly api: { readonly setActive: () => void } } | undefined
}

const firstOfArea = (area: DockArea): PanelId =>
  DEFAULT_ORDER.find((id) => PANEL_SPECS[id].area === area) ?? 'storyboard'

/** 1 枚の置き方。同じ区画に既にパネルがあればそのタブに並べ、無ければ区画を作る。 */
const panelOptions = (
  id: PanelId,
  where: { readonly sibling: string | null; readonly mainPanel: string | null },
  inactive: boolean,
): AddPanelOptions => {
  const spec = PANEL_SPECS[id]
  const width = AREA_WIDTHS[spec.area]
  const position =
    where.sibling === null
      ? areaAnchor(spec.area, where.mainPanel)
      : ({ referencePanel: where.sibling, direction: 'within' } as const)
  return {
    id,
    component: id,
    title: spec.title,
    ...(inactive ? { inactive: true } : {}),
    ...(position === undefined ? {} : { position }),
    ...(where.sibling === null && width !== undefined ? { initialWidth: width } : {}),
  }
}

/** 既定配置（§3）。左 240 / 中央上下 / 右 320。区画の先頭のタブが表に出る。 */
export const addDefaultPanels = (api: Pick<DockLike, 'addPanel'>): void => {
  DEFAULT_ORDER.forEach((id) => {
    const head = firstOfArea(PANEL_SPECS[id].area)
    api.addPanel(
      panelOptions(
        id,
        { sibling: head === id ? null : head, mainPanel: 'storyboard' },
        head !== id,
      ),
    )
  })
}

/** 区画の幅を合わせる口。`addPanel` の `initialWidth` は区画を作る順によって効かないことがある。 */
export type SizableDock = {
  readonly getPanel: (
    id: string,
  ) =>
    | {
        readonly group: {
          readonly api: { readonly setSize: (size: { width?: number; height?: number }) => void }
        }
      }
    | undefined
}

/**
 * 下の区画の高さ（ドックの高さに対する割合）。ドック任せだと半分を切り、
 * タイムラインの帯が 2〜3 段しか見えなかった（制作者 2026-10-19「帯をできるだけ上に」）。
 */
export const BOTTOM_HEIGHT_RATIO = 0.45

/** 区画の下限を決める口。窓が狭くなったときに、どこから先を削らせないかを決める。 */
export type ConstrainableDock = {
  readonly getPanel: (
    id: string,
  ) =>
    | {
        readonly group: {
          readonly api: { readonly setConstraints: (c: { minimumWidth?: number }) => void }
        }
      }
    | undefined
}

/** タブ名を書き換える口。保存した配置を戻したあとに当てる。 */
export type RetitlableDock = {
  readonly getPanel: (
    id: string,
  ) => { readonly api: { readonly setTitle: (title: string) => void } } | undefined
}

/**
 * 保存した配置のタブ名を、いまの `PANEL_SPECS` に合わせ直す。
 *
 * **`toJSON()` はタブ名も一緒に保存する。** そのためパネルの名前を変えても、
 * 既に配置を保存している人の画面は古い名前のままになる。実際に「素材ビューア」と
 * 「絵コンテの案」へ改名したのに、実機のタブは「素材」「絵コンテ下書き」のままだった。
 *
 * 版を上げて配置ごと捨てる手もあるが、それだと利用者が組んだ配置まで消える。
 * **名前だけ当て直す。** 配置は残す。
 */
export const retitlePanels = (api: RetitlableDock): void => {
  PANEL_IDS.forEach((id) => {
    api.getPanel(id)?.api.setTitle(PANEL_SPECS[id].title)
  })
}

/**
 * 既定配置の幅を 左 240 / 右 320 に揃える（§3）。**置いたあとで**区画ごとに指定する。
 * 実機（1440×900）で右が 720px に広がり、中央が 1 列しか入らなかった（2026-09-19）。
 */
export const sizeDefaultAreas = (api: SizableDock, dockHeightPx?: number): void => {
  api.getPanel(firstOfArea('left'))?.group.api.setSize({ width: LEFT_WIDTH_PX })
  api.getPanel(firstOfArea('side'))?.group.api.setSize({ width: SIDE_WIDTH_PX })
  // 高さが測れないとき（描く前など）は触らない。0 で潰すとタイムラインが消える。
  if (dockHeightPx !== undefined && dockHeightPx > 0) {
    api.getPanel(firstOfArea('bottom'))?.group.api.setSize({ height: Math.round(dockHeightPx * BOTTOM_HEIGHT_RATIO) })
  }
}

/**
 * 聴きながら切るを前に出すか。**既定はタイムラインが前**で、出すのは次の 2 つだけ。
 *
 * - 開いた時点（`previousTrackId` が undefined）で、楽曲があって Shot が 0 件。最初の作業は曲を聴いて区切ること。
 * - 開いたあとでマスターの楽曲が決まった・替わった（楽曲を入れた直後）。
 *
 * Shot を読めていない（null）なら出さない。「0 件」と「読めていない」は別（L-015）。
 */
export const shouldFrontCutter = (input: {
  readonly previousTrackId: string | null | undefined
  readonly trackId: string | null
  readonly shotCount: number | null
}): boolean => {
  if (input.trackId === null) return false
  if (input.previousTrackId === undefined) return input.shotCount === 0
  return input.previousTrackId !== input.trackId
}

/**
 * 区画を縮めてよい下限。**保存した配置にも当てる**ので `sizeDefaultAreas` とは別にする。
 *
 * 窓を狭めるとドックは全区画を比例して縮める。右が下限なしだと Shot 一覧の表
 * （最小 344px）より狭くなり、**表の中に横スクロールバーが出る**。
 * 実際 1024px の窓で右が 256px まで潰れていた。狭くなったぶんは中央が引き受ける。
 */
export const constrainAreas = (api: ConstrainableDock): void => {
  api.getPanel(firstOfArea('left'))?.group.api.setConstraints({ minimumWidth: LEFT_WIDTH_PX })
  api.getPanel(firstOfArea('side'))?.group.api.setConstraints({ minimumWidth: SIDE_WIDTH_PX })
}

/**
 * パネルを前に出す。**閉じられていたら住んでいた区画へ戻してから出す。**
 * メニューの「表示」から押して何も起きないのが一番困る。
 */
export const focusPanel = (api: DockLike, id: PanelId): void => {
  const existing = api.getPanel(id)
  if (existing !== undefined) {
    existing.api.setActive()
    return
  }
  const present = (area: DockArea): string | null =>
    DEFAULT_ORDER.find(
      (other) => PANEL_SPECS[other].area === area && api.getPanel(other) !== undefined,
    ) ?? null
  api.addPanel(
    panelOptions(id, { sibling: present(PANEL_SPECS[id].area), mainPanel: present('main') }, false),
  )
}

// --- 作業モード（§6） ---

export const PRESETS = ['compose', 'watch', 'finish'] as const
export type Preset = (typeof PRESETS)[number]

export const PRESET_LABELS: Readonly<Record<Preset, string>> = Object.freeze({
  compose: '構成',
  watch: '通し',
  finish: '仕上げ',
})

/**
 * モードごとに前に出す 3 枚（中央上・中央下・右）。
 *
 * **中央上の 3 枚は必ず別にすること。** 同じ区画に 2 枚入れると後の 1 枚が勝ち、
 * どのモードを押しても同じ見た目になる。ここが「押しても何も起きない」の元。
 *
 * `compose` は既定配置と同じ組。押しても見た目は変わらないが、
 * それが「いまその状態だ」という表示（`aria-pressed`）で伝わる。
 */
export const PRESET_PANELS: Readonly<Record<Preset, readonly PanelId[]>> = Object.freeze({
  compose: ['storyboard', 'cutter', 'shots'],
  // 通しで観る。仕上げ中にプレビューがどのモードにも入っていなかった。
  watch: ['preview', 'timeline', 'shots'],
  finish: ['compare', 'timeline', 'inspector'],
})

/** 前に出すタブを変えるだけ。配置の JSON には手を入れない。 */
export const applyPreset = (api: DockLike, preset: Preset): void => {
  PRESET_PANELS[preset].forEach((id) => {
    focusPanel(api, id)
  })
}

// --- 保存 ---

// 2: 素材ごとのタブをやめて「素材」ビューア 1 枚に、「自動で割る」タブを外した（PHASE 8.2）。
//    版を上げないと、保存済みの配置が消えた部品を指して復元に失敗する（lessons L-025）。
// 3: 下の区画に「検査」「変更履歴」「コンソール」を足し、タイムラインを先頭にした（2026-10-19）。
//    版を上げないと、保存済みの配置には新しいタブが出ず、メニューから開くまで在ることに気づけない。
const LAYOUT_VERSION = 3

/** 旧 `ixa:storyboard-layout:v4` と v1・v2 は読まない（パネルの組が違う）。 */
export const workbenchLayoutKey = (projectId: ProjectId): string =>
  `ixa:workbench-layout:v${String(LAYOUT_VERSION)}:${projectId}`

const SerializedLayout = z.custom<SerializedDockview>(
  (value) => typeof value === 'object' && value !== null && 'grid' in value && 'panels' in value,
  'Dockview の保存形式ではありません',
)

export type StoredLayoutResult =
  | { readonly state: 'missing' }
  | { readonly state: 'invalid'; readonly reason: string }
  | { readonly state: 'ready'; readonly layout: SerializedDockview }

export const readStoredWorkbenchLayout = (
  storage: Pick<Storage, 'getItem'>,
  projectId: ProjectId,
): StoredLayoutResult => {
  try {
    const raw = storage.getItem(workbenchLayoutKey(projectId))
    if (raw === null) return { state: 'missing' }
    const parsed = SerializedLayout.safeParse(JSON.parse(raw) as unknown)
    return parsed.success
      ? { state: 'ready', layout: parsed.data }
      : { state: 'invalid', reason: parsed.error.issues[0]?.message ?? '形式が不正です' }
  } catch (error) {
    return {
      state: 'invalid',
      reason: error instanceof Error ? error.message : 'JSON を読めません',
    }
  }
}

/** 書けなくても何も起きない。配置が残らないだけで、作業は続けられる。 */
export const writeWorkbenchLayout = (
  storage: Pick<Storage, 'setItem'>,
  projectId: ProjectId,
  layout: SerializedDockview,
): void => {
  try {
    storage.setItem(workbenchLayoutKey(projectId), JSON.stringify(layout))
  } catch {
    // 保存を止めているブラウザ設定がある。続ける。
  }
}

export const clearWorkbenchLayout = (
  storage: Pick<Storage, 'removeItem'>,
  projectId: ProjectId,
): void => {
  try {
    storage.removeItem(workbenchLayoutKey(projectId))
  } catch {
    // 同上。
  }
}
