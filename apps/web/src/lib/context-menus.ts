import type { Shot } from '@ixa/domain'
import { DRAW_ANYWAY_LABEL, drawWithoutStoryboardWarning } from '@/lib/step-guards'
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
      /** 確認の「する」側の色と言葉（手順を飛ばしたときの確認は primary・「このまま作る」）。 */
      readonly confirmTone?: 'danger' | 'primary'
      readonly confirmLabel?: string
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
    readonly confirmTone?: 'danger' | 'primary'
    readonly confirmLabel?: string
  } = {},
): ContextMenuEntry<A> => ({
  kind: 'item',
  action,
  label,
  disabledReason: options.disabledReason ?? null,
  ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
  ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
  ...(options.keepLabel === undefined ? {} : { keepLabel: options.keepLabel }),
  ...(options.confirmTone === undefined ? {} : { confirmTone: options.confirmTone }),
  ...(options.confirmLabel === undefined ? {} : { confirmLabel: options.confirmLabel }),
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

/** 絵コンテ（説明）が空なら、絵を作る前に確かめる（制作者 2026-10-03「手順を飛び越えて…警告ダイアログを出して、任意の上で実行」）。 */
const drawGuardOf = (shot: Shot) => {
  const warning = drawWithoutStoryboardWarning([shot])
  return warning === null
    ? {}
    : { confirm: warning, confirmTone: 'primary' as const, confirmLabel: DRAW_ANYWAY_LABEL }
}

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
  item('draw-start-frame', '絵コンテの画像を AI で作る', drawGuardOf(input.shot)),
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

export type AssetMenuKind = 'character' | 'look' | 'location' | 'brand-asset' | 'track' | 'voice' | 'project'

const ASSET_KIND_LABELS: Readonly<Record<Exclude<AssetMenuKind, 'project'>, string>> = {
  character: 'キャラクター',
  look: 'Look',
  location: 'ロケーション',
  'brand-asset': 'ブランド資産',
  track: '楽曲',
  voice: '声',
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
    case 'voice':
      return `声「${name}」を削除します。この声で話す行は「声が未定」に戻ります（作った声の Take は残ります）。`
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
  // 声には絵が無いので、素材ビューアには出さない。
  const viewer = kind === 'voice' ? [] : [item<AssetMenuAction>('open-viewer', '素材ビューアで見る')]
  return [
    ...viewer,
    ...inspect,
    ...(extra.length === 0 ? [] : [SEPARATOR, ...extra]),
    SEPARATOR,
    item('delete', `${ASSET_KIND_LABELS[kind]}を削除`, {
      confirm: deleteConfirmOf(kind, input.name, input.isMaster === true),
    }),
  ]
}

export type TakeMenuAction = 'adopt' | 'unadopt' | 'hide' | 'remake_final' | 'upscale' | 'download'

/**
 * Take のメニュー（Take 比較のカードの右クリックと「…」）。採用する・外す・消す。
 * 消すのは**見えなくするだけ**（ADR-0003 追記）。行も中身も残り、払った額は費用に残る。
 */
export const takeMenuEntries = (input: {
  readonly adopted: boolean
  /** 画面の Take の番号（確認の文に入れる）。 */
  readonly index: number
  /**
   * 本番の段のモデルの名前（ADR-0042）。**無ければ「本番で作り直す」を押せなくする。**
   * 段が無い環境（手元の生成サーバを使っていない・サーバが古い）で、
   * 押しても必ず断られる操作を出さないため。
   */
  readonly finalModelLabel?: string | null
  /** 作り直しに使うシード。無ければ Provider に任せる（文言が変わる）。 */
  readonly seedUsed?: number | null
  /**
   * この環境で解像度を上げられるか（ADR-0044）。**まだ引けていなければ `undefined`。**
   * 分からないうちは押せなくしておく（押して断られるより良い）。
   */
  readonly upscaleSupported?: boolean
  /** 上げられない理由（domain の `upscaleBlocker`）。上げられるなら null。 */
  readonly upscaleBlocker?: string | null
}): readonly ContextMenuEntry<TakeMenuAction>[] => [
  item('adopt', '採用する', {
    disabledReason: input.adopted ? 'この Take を採用しています' : null,
  }),
  item('unadopt', '採用を外す', {
    disabledReason: input.adopted ? null : 'この Take は採用していません',
  }),
  SEPARATOR,
  item('remake_final', '本番で作り直す', {
    disabledReason:
      input.finalModelLabel === undefined || input.finalModelLabel === null
        ? '本番の画質で作れる AI が登録されていません'
        : null,
    confirm:
      `Take ${String(input.index)} と同じ仕様${input.seedUsed === null || input.seedUsed === undefined ? '' : '・同じシード'}で、` +
      `${input.finalModelLabel ?? ''} に作り直しを頼みます。` +
      '本番の画質は 1 本 20 分ほどかかり、できた Take は元の Take と並びます（元は消えません）。',
  }),
  /**
   * 解像度を上げる（ADR-0044）。**絵は変わらない**（作り直しとの違いがここ）。
   * 対応していない環境・すでに上げた Take では押せない。
   */
  item('upscale', '解像度を上げる', {
    disabledReason:
      input.upscaleSupported !== true
        ? '解像度を上げられる AI が登録されていません'
        : (input.upscaleBlocker ?? null),
    confirm:
      `Take ${String(input.index)} の絵はそのままで、細部をはっきりさせます。` +
      '1 本 5〜20 分ほどかかり、できた Take は元の Take と並びます（元は消えません）。',
  }),
  SEPARATOR,
  /** 制作者 2026-10-09「Take の動画を個別に DL できるようにしたい」。読める名前で保存される。 */
  item('download', 'ダウンロード'),
  item('hide', 'Take を消す', {
    disabledReason: input.adopted ? '採用中の Take は消せません（先に採用を外す）' : null,
    confirm: `Take ${String(input.index)} を消します。一覧と比較から見えなくなります（記録と使った費用は残ります）。`,
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
