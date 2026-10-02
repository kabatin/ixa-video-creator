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
      /** 確認で「しない」側の言葉。既定は「やめる」。操作の名前に「やめる」が入るときに替える。 */
      readonly keepLabel?: string
    }
  | { readonly kind: 'separator' }

const item = <A extends string>(
  action: A,
  label: string,
  options: {
    readonly shortcut?: string
    readonly disabledReason?: string | null
    readonly confirm?: string
    readonly keepLabel?: string
  } = {},
): ContextMenuEntry<A> => ({
  kind: 'item',
  action,
  label,
  disabledReason: options.disabledReason ?? null,
  ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
  ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
  ...(options.keepLabel === undefined ? {} : { keepLabel: options.keepLabel }),
})

const SEPARATOR = { kind: 'separator' } as const

export type ShotMenuAction =
  | 'make-take'
  | 'cancel-generation'
  | 'open-compare'
  | 'draw-start-frame'
  | 'split'
  | 'unselect-take'
  | 'toggle-check'
  | 'delete'

/**
 * 生成をやめる（制作者 2026-10-01「動画生成をキャンセル出来るようにしたい」）。
 * 右クリックのメニュー・生成中の行・ストーリーボードのカードが同じ名前と確認を使う。
 */
export const CANCEL_GENERATION_LABEL = '生成をやめる'
export const CANCEL_GENERATION_CONFIRM =
  'この Shot で動いている生成をやめます。生成先によっては、途中まで費用が掛かります。止めた後に届いた結果は Take になりません。'
/** 確認の「しない」側。「やめる」だと「生成をやめる」と並んで逆の意味に読める。 */
export const KEEP_GENERATING_LABEL = '続ける'
export const NOT_GENERATING_REASON = '生成中ではありません'

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
  item('cancel-generation', CANCEL_GENERATION_LABEL, {
    disabledReason: input.shot.status === 'generating' ? null : NOT_GENERATING_REASON,
    confirm: CANCEL_GENERATION_CONFIRM,
    keepLabel: KEEP_GENERATING_LABEL,
  }),
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

export type AssetMenuAction =
  'open-viewer' | 'inspect' | 'set-default-look' | 'set-master' | 'reanalyze' | 'delete'

export type AssetMenuKind = 'character' | 'look' | 'location' | 'brand-asset' | 'track' | 'project'

const ASSET_KIND_LABELS: Readonly<Record<Exclude<AssetMenuKind, 'project'>, string>> = {
  character: 'キャラクター',
  look: 'Look',
  location: 'ロケーション',
  'brand-asset': 'ブランド資産',
  track: '楽曲',
}

/** 削除の確認の文。何が起きるかを言う（素材ツリーとインスペクターで同じ文）。 */
const deleteConfirmOf = (
  kind: Exclude<AssetMenuKind, 'project'>,
  name: string,
  isMaster: boolean,
): string => {
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
  const inspect =
    input.where === 'tree' ? [item<AssetMenuAction>('inspect', 'インスペクターで直す')] : []
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

export type TakeMenuAction = 'adopt' | 'unadopt'

/** Take のメニュー（Take 比較のカード）。採用するか、採用を外すか。 */
export const takeMenuEntries = (input: {
  readonly adopted: boolean
}): readonly ContextMenuEntry<TakeMenuAction>[] => [
  item('adopt', '採用する', {
    disabledReason: input.adopted ? 'この Take を採用しています' : null,
  }),
  item('unadopt', '採用を外す', {
    disabledReason: input.adopted ? null : 'この Take は採用していません',
  }),
]

export type TextClipMenuAction = 'edit' | 'delete'

/** テロップのメニュー（帯の右クリックと、インスペクターの「…」）。インスペクターでは直すは出さない。 */
export const textClipMenuEntries = (input: {
  readonly text: string
  /** 画面の書式（`formatSpan`）の時間。確認の文に入れる。 */
  readonly span: string
  readonly where: 'timeline' | 'inspector'
}): readonly ContextMenuEntry<TextClipMenuAction>[] => [
  ...(input.where === 'timeline'
    ? [item<TextClipMenuAction>('edit', 'インスペクターで直す'), SEPARATOR]
    : []),
  item('delete', 'テロップを削除', {
    confirm: `テロップ「${input.text}」${input.span} を削除します。`,
  }),
]

export type CutMarkMenuAction = 'remove'

/** 聴きながら切るの区切りのメニュー。Delete でも消せる（選んでいる区切り）。 */
export const cutMarkMenuEntries = (): readonly ContextMenuEntry<CutMarkMenuAction>[] => [
  item('remove', 'この区切りを消す', { shortcut: DELETE_SHORTCUT }),
]

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
