import type { Shot } from '@ixa/domain'
import { DELETE_SHORTCUT, NO_ADOPTED_TAKE, SPLIT_SHORTCUT } from '@/lib/menu-model'

/**
 * 右クリック（長押し・Shift+F10）のメニューの中身。**データとして持ち、React を含まない。**
 * 物の種類ごとに「何ができるか・押せるか」を決める。実行は画面側がアクション名から引く（`menu-model.ts` と同じ流儀）。
 * 押せない理由とショートカットの表示はメニューバーと同じ文を使う（書き写さない）。
 */

export type ContextMenuEntry<A extends string> =
  | {
      readonly kind: 'item'
      readonly action: A
      readonly label: string
      /** 表示だけ。打鍵の受け付けは `workbench-keys.ts` が持つ。 */
      readonly shortcut?: string
      /** 押せない理由。押せるなら null。 */
      readonly disabledReason: string | null
      /** 取り消せない操作の確認の文。あれば押したあとに確認を挟む。 */
      readonly confirm?: string
    }
  | { readonly kind: 'separator' }

const item = <A extends string>(
  action: A,
  label: string,
  options: { readonly shortcut?: string; readonly disabledReason?: string | null; readonly confirm?: string } = {},
): ContextMenuEntry<A> => ({
  kind: 'item',
  action,
  label,
  disabledReason: options.disabledReason ?? null,
  ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
  ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
})

const SEPARATOR = { kind: 'separator' } as const

export type ShotMenuAction =
  | 'make-take'
  | 'open-compare'
  | 'draw-start-frame'
  | 'split'
  | 'unselect-take'
  | 'toggle-check'
  | 'delete'

/**
 * Shot のメニュー（タイムライン・ストーリーボード・Shot 一覧）。**対象は右クリックした 1 つ**（チェックした複数とは混ぜない）。
 * `checked` を渡したときだけ（Shot 一覧）、チェックの付け外しを並べる。
 */
export const shotMenuEntries = (input: {
  readonly shot: Shot
  /** 再生位置で分割できない理由（`splitBlockerOf`）。できるなら null。 */
  readonly splitBlocker: string | null
  readonly checked?: boolean
}): readonly ContextMenuEntry<ShotMenuAction>[] => [
  item('make-take', 'Take を作る…'),
  item('open-compare', 'Take 比較で見る'),
  item('draw-start-frame', '絵コンテの画像を AI で作る'),
  SEPARATOR,
  item('split', '再生位置で分割', { shortcut: SPLIT_SHORTCUT, disabledReason: input.splitBlocker }),
  item('unselect-take', '採用を外す', {
    disabledReason: input.shot.selectedTakeId === null ? NO_ADOPTED_TAKE : null,
  }),
  ...(input.checked === undefined
    ? []
    : [
        item<ShotMenuAction>('toggle-check', input.checked ? 'チェックを外す' : 'チェックを付ける'),
      ]),
  SEPARATOR,
  item('delete', '削除…', { shortcut: DELETE_SHORTCUT }),
]

export type AssetMenuAction = 'open-viewer' | 'inspect' | 'set-default-look' | 'set-master' | 'reanalyze' | 'delete'

export type AssetMenuKind = 'character' | 'look' | 'location' | 'brand-asset' | 'track' | 'project'

const ASSET_KIND_LABELS: Readonly<Record<Exclude<AssetMenuKind, 'project'>, string>> = {
  character: 'キャラクター',
  look: 'Look',
  location: 'ロケーション',
  'brand-asset': 'ブランド資産',
  track: '楽曲',
}

/** 削除の確認の文。何が起きるかを言う（素材ツリーとインスペクターで同じ文）。 */
const deleteConfirmOf = (kind: Exclude<AssetMenuKind, 'project'>, name: string, isMaster: boolean): string => {
  switch (kind) {
    case 'character':
      return `${name} を削除します。この人が出ている Shot からも外れます。`
    case 'look':
      return `Look「${name}」を削除します。この Look で出ている Shot は、登場人物の Look を選び直す必要があります。`
    case 'location':
      return `ロケーション「${name}」を削除します。これを使っている Shot は「なし」になります。`
    case 'brand-asset':
      return `「${name}」を削除します。レビューはこの資産で照合しなくなります。`
    case 'track':
      return isMaster
        ? `マスターの「${name}」を削除します。残りの楽曲で最初に登録した曲がマスターになり、拍・尺の基準が変わります。`
        : `「${name}」を削除します。`
  }
}

/**
 * 素材のメニュー（素材ツリーの右クリックと、インスペクターの「…」）。
 * インスペクターではいま開いているので「インスペクターで直す」は出さない。作品の方針は直すだけ（消せない）。
 */
export const assetMenuEntries = (input: {
  readonly kind: AssetMenuKind
  readonly name: string
  readonly where: 'tree' | 'inspector'
  readonly isDefaultLook?: boolean
  readonly isMaster?: boolean
}): readonly ContextMenuEntry<AssetMenuAction>[] => {
  const inspect = input.where === 'tree' ? [item<AssetMenuAction>('inspect', 'インスペクターで直す')] : []
  if (input.kind === 'project') return inspect
  const kind = input.kind
  const extra: readonly ContextMenuEntry<AssetMenuAction>[] =
    kind === 'look'
      ? [
          item('set-default-look', '既定の Look にする', {
            disabledReason: input.isDefaultLook === true ? 'もう既定の Look です' : null,
          }),
        ]
      : kind === 'track'
        ? [
            item('set-master', 'この曲をマスターにする', {
              disabledReason: input.isMaster === true ? 'もうマスターの楽曲です' : null,
            }),
            item('reanalyze', '再解析'),
          ]
        : []
  return [
    item('open-viewer', '素材ビューアで見る'),
    ...inspect,
    ...(extra.length === 0 ? [] : [SEPARATOR, ...extra]),
    SEPARATOR,
    item('delete', `${ASSET_KIND_LABELS[kind]}を削除`, {
      confirm: deleteConfirmOf(kind, input.name, input.isMaster === true),
    }),
  ]
}

/** 画面の縁からこれだけは離す（枠線が縁と重なって切れて見えないように）。 */
const MENU_MARGIN_PX = 8

const clampWithin = (value: number, min: number, max: number): number =>
  max < min ? min : Math.min(Math.max(value, min), max)

/**
 * メニューを置く場所。**押した所の右下**に開き、右が足りなければ左へ、下が足りなければ上へ返す。
 * どちらでも入らなければ画面の縁から離して収める。React を含まない。
 */
export const placeContextMenu = (
  at: { readonly x: number; readonly y: number },
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } => {
  const fitsRight = at.x + size.width + MENU_MARGIN_PX <= viewport.width
  const fitsBelow = at.y + size.height + MENU_MARGIN_PX <= viewport.height
  return {
    left: clampWithin(
      fitsRight ? at.x : at.x - size.width,
      MENU_MARGIN_PX,
      viewport.width - size.width - MENU_MARGIN_PX,
    ),
    top: clampWithin(
      fitsBelow ? at.y : at.y - size.height,
      MENU_MARGIN_PX,
      viewport.height - size.height - MENU_MARGIN_PX,
    ),
  }
}
