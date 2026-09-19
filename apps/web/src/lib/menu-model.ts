import { CHARACTER_LIST_HREF } from '@/lib/character-links'
import type { PanelId } from '@/lib/workbench-layout'

/**
 * メニューバーの中身（UI-WORKBENCH §4）。**データとして持ち、React を含まない。**
 *
 * - 行き先は全部ここに集める。ページを消して到達できない機能が生まれないように
 *   （`project-links.ts` / `SiteHeader` の方針。§12）
 * - 「押せるかどうか」はここの純粋関数が決め、ユニットテストで固定する
 * - 実行は部品側がアクション名から引く。ここは何をするかの**名前**だけを持つ
 */

/** ダイアログで開くもの。`workbench-url.ts` の URL から開けるものより広い。 */
export type WorkbenchDialog =
  'render' | 'settings' | 'preferences' | 'history' | 'new-shot' | 'shortcuts'

export type MenuAction =
  | { readonly kind: 'href'; readonly href: string }
  | { readonly kind: 'dialog'; readonly dialog: WorkbenchDialog }
  | { readonly kind: 'panel'; readonly panel: PanelId }
  | { readonly kind: 'command'; readonly command: MenuCommand }

export type MenuCommand =
  | 'undo'
  | 'redo'
  | 'reset-layout'
  | 'copy-link'
  | 'delete-shot'
  | 'bulk-edit'
  | 'generate-shot'
  | 'bulk-generate'
  | 'import-files'
  | 'inspect-master-track'
  | 'unselect-take'

export type MenuItem = {
  readonly id: string
  readonly label: string
  /** 表示だけ。打鍵の受け付けは `workbench-keys.ts` が持つ。 */
  readonly shortcut?: string
  readonly action: MenuAction
  readonly enabled: boolean
  /** 押せない理由。無効な項目にだけ付ける（読み上げと title に使う）。 */
  readonly disabledReason?: string
}

export type Menu = {
  readonly id: string
  readonly label: string
  readonly items: readonly MenuItem[]
}

/** 有効判定の材料。**これ以外を見ない。** */
export type MenuState = {
  /** インスペクターで開いている Shot があるか。 */
  readonly hasCurrentShot: boolean
  /** 一覧でチェックした Shot の数。 */
  readonly checkedCount: number
  /** 取り消せる一括操作があるか（判定はサーバの `canUndo`）。 */
  readonly canUndo: boolean
  /** 選んでいる Shot に採用 Take があるか（「採用を外す」の有効判定）。 */
  readonly currentHasTake: boolean
}

const href = (value: string): MenuAction => ({ kind: 'href', href: value })
const dialog = (value: WorkbenchDialog): MenuAction => ({ kind: 'dialog', dialog: value })
const panel = (value: PanelId): MenuAction => ({ kind: 'panel', panel: value })
const command = (value: MenuCommand): MenuAction => ({ kind: 'command', command: value })

const item = (
  id: string,
  label: string,
  action: MenuAction,
  options: { readonly shortcut?: string; readonly disabledReason?: string | null } = {},
): MenuItem => ({
  id,
  label,
  action,
  enabled: options.disabledReason === undefined || options.disabledReason === null,
  ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
  ...(options.disabledReason === undefined || options.disabledReason === null
    ? {}
    : { disabledReason: options.disabledReason }),
})

const NO_CURRENT_SHOT = 'Shot を選んでいません'
const NO_CHECKED = '一覧で Shot にチェックを付けてください'

export const REDO_DISABLED_REASON = 'やり直しはまだありません'

/** メニューの全体。`state` が同じなら同じ値を返す。 */
export const buildMenus = (state: MenuState): readonly Menu[] => {
  const noCurrent = state.hasCurrentShot ? null : NO_CURRENT_SHOT
  const noChecked = state.checkedCount > 0 ? null : NO_CHECKED
  return [
    {
      id: 'app',
      label: 'iXA',
      items: [
        item('projects', 'プロジェクト一覧', href('/')),
        item('characters', 'キャラクター', href(CHARACTER_LIST_HREF)),
        item('library', '素材ライブラリ', href('/library')),
        item('preferences', '環境設定…', dialog('preferences'), { shortcut: '⌘,' }),
      ],
    },
    {
      id: 'file',
      label: 'ファイル',
      items: [
        item('new-project', '新規プロジェクト', href('/projects/new')),
        item('settings', '設定…', dialog('settings')),
        item('render', '書き出し…', dialog('render')),
      ],
    },
    {
      id: 'edit',
      label: '編集',
      items: [
        item('undo', '元に戻す', command('undo'), {
          shortcut: '⌘Z',
          disabledReason: state.canUndo ? null : '戻せる一括操作がありません',
        }),
        // 実装が無い。モックでも灰色。押せるように見せない。
        item('redo', 'やり直す', command('redo'), {
          shortcut: '⇧⌘Z',
          disabledReason: REDO_DISABLED_REASON,
        }),
        item('history', '変更履歴…', dialog('history'), { shortcut: '⌘Y' }),
      ],
    },
    {
      id: 'view',
      label: '表示',
      items: [
        item('view-storyboard', 'ストーリーボード', panel('storyboard')),
        item('view-preview', 'プレビュー', panel('preview')),
        item('view-compare', 'Take 比較', panel('compare')),
        item('view-viewer', '素材ビューア', panel('viewer')),
        item('view-draft', '絵コンテ下書き', panel('draft')),
        item('view-cutter', '聴きながら切る', panel('cutter')),
        item('view-timeline', 'タイムライン', panel('timeline')),
        item('view-shots', 'Shot 一覧', panel('shots')),
        item('view-inspector', 'インスペクター', panel('inspector')),
        item('view-assets', '素材ツリー', panel('assets')),
        item('copy-link', 'リンクをコピー', command('copy-link')),
        item('reset-layout', 'パネル配置をリセット', command('reset-layout')),
      ],
    },
    {
      id: 'assets',
      label: '素材',
      items: [
        item('import', 'ファイルを取り込む…', command('import-files')),
        item('music', '楽曲', command('inspect-master-track')),
      ],
    },
    {
      id: 'shot',
      label: 'Shot',
      items: [
        item('new-shot', '新規 Shot', dialog('new-shot')),
        item('bulk-edit', '選択を一括変更…', command('bulk-edit'), { disabledReason: noChecked }),
        item('unselect-take', '採用を外す', command('unselect-take'), {
          disabledReason: state.hasCurrentShot
            ? state.currentHasTake
              ? null
              : '採用している Take がありません'
            : NO_CURRENT_SHOT,
        }),
        item('delete-shot', '選択を削除', command('delete-shot'), { disabledReason: noCurrent }),
      ],
    },
    {
      id: 'generate',
      label: '生成',
      items: [
        item('generate-shot', '選択した Shot を生成', command('generate-shot'), {
          disabledReason: noCurrent,
        }),
        item('bulk-generate', '一括生成…', command('bulk-generate'), {
          disabledReason: noChecked,
        }),
      ],
    },
    {
      id: 'help',
      label: 'ヘルプ',
      items: [item('shortcuts', 'キーボードショートカット', dialog('shortcuts'))],
    },
  ]
}

/** ショートカットの一覧（ヘルプと環境設定で読むだけ）。メニューから作る。 */
export const listShortcuts = (
  menus: readonly Menu[],
): readonly { readonly label: string; readonly shortcut: string }[] =>
  menus.flatMap((menu) =>
    menu.items.flatMap((entry) =>
      entry.shortcut === undefined ? [] : [{ label: entry.label, shortcut: entry.shortcut }],
    ),
  )

/** メニューに無い打鍵。再生と Shot の移動（7.2）。 */
export const EXTRA_SHORTCUTS: readonly { readonly label: string; readonly shortcut: string }[] = [
  { label: '再生 / 一時停止', shortcut: 'Space' },
  { label: '前の Shot / 次の Shot', shortcut: '← / →' },
]
