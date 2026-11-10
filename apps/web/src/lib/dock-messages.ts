import type { Position, resolveMessages } from 'dockview-react'

/**
 * ドックが読み上げる言葉と、タブの「閉じる」の名前（スクリーンリーダー向け）。
 *
 * ドックの部品（dockview）の既定は英語で、「Close 素材ツリー」「プレビュー opened」のように
 * パネル名とだけ言葉が混ざっていた。画面の言葉は日本語（CLAUDE.md「画面の言葉」）なので、すべて差し替える。
 *
 * **一部だけ差し替えない。** 部品の版が上がって項目が増えたら、テストが英語のまま残る項目を知らせる
 * （`dock-messages.test.ts`）。
 */
export type DockMessages = ReturnType<typeof resolveMessages>

const SIDE_NAMES: Readonly<Record<Exclude<Position, 'center'>, string>> = {
  left: '左',
  right: '右',
  top: '上',
  bottom: '下',
}

/** 置く場所。真ん中は同じ枠のタブに入れ、端は枠を分けて置く。 */
const placeOf = (position: Position, target: string): string =>
  position === 'center' ? `${target}と同じ枠のタブ` : `${target}の${SIDE_NAMES[position]}`

export const DOCK_MESSAGES: DockMessages = {
  panelOpened: (title) => `${title}を開きました`,
  panelClosed: (title) => `${title}を閉じました`,
  groupMaximized: (title) => `${title}を広げました`,
  groupRestored: (title) => `${title}を元の大きさに戻しました`,
  groupFloated: (title) => `${title}を切り離しました`,
  groupDocked: (title) => `${title}を枠に戻しました`,
  groupPoppedOut: (title) => `${title}を別の窓で開きました`,
  closeTab: (title) => `${title}を閉じる`,
  closeTabPlain: () => '閉じる',
  movePickTarget: (source, target, current, total) =>
    `${source}を動かします。動かす先は${target}（${String(total)} 個のうち ${String(current)} 個目）。決定キーで置く場所を選び、エスケープキーでやめます。`,
  movePickEdge: (position, target) =>
    `${placeOf(position, target)}に置きます。矢印キーで変え、決定キーで決め、エスケープキーで戻ります。`,
  moveCommitted: (source, target, position) => `${source}を${placeOf(position, target)}に置きました。`,
  moveCancelled: () => '動かすのをやめました。',
  moveNotAllowed: () => 'そこへは動かせません。',
  moveFloated: (source) => `${source}を切り離しました。`,
}
