import { isTextEntryTarget, resolveKeyOwner, type KeyTargetLike } from '@/lib/playback-state'

/**
 * ワークベンチの打鍵（UI-WORKBENCH §9 7.2）。**React を含まない。衝突はここ 1 か所で解く**（L-018）。
 *
 * | 打鍵 | 動き |
 * |---|---|
 * | ⌘Z / Ctrl+Z | 元に戻す（一括操作） |
 * | ⇧⌘Z | やり直す（未実装。何もしない） |
 * | ⌘Y | 変更履歴 |
 * | ⌘, | 環境設定 |
 * | Space | 再生 / 一時停止 |
 * | ← → | 前 / 次の Shot |
 * | Delete / Backspace | Shot の削除（確認を開く。チェックがあればチェックした Shot） |
 *
 * - **入力欄の中の打鍵は取らない。** ⌘Z は文字の取り消しとしてブラウザに任せる
 * - Space と ← → は**フォーカスが「聴きながら切る」の中にある間だけ**そちらに任せる。
 *   見えているかでは決めない（見えている ≠ 操作している）。判定は `resolveKeyOwner`
 * - ボタンの上の Space はボタンを押す打鍵。再生に変えない
 */
export type WorkbenchKeyEvent = {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly target: KeyTargetLike | null
  /**
   * フォーカスが「聴きながら切る」の中にあるか。**見えているかではない。**
   * 呼び出し側が `CUT_EDITOR_SELECTOR` で `closest` して渡す。
   */
  readonly insideCutEditor: boolean
}

export type WorkbenchKeyCommand =
  | 'undo'
  | 'redo'
  | 'history'
  | 'preferences'
  | 'toggle-play'
  | 'previous-shot'
  | 'next-shot'
  | 'delete-shots'

export const resolveWorkbenchKey = (event: WorkbenchKeyEvent): WorkbenchKeyCommand | null => {
  if (isTextEntryTarget(event.target)) return null
  const command = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()

  if (command && !event.altKey) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
    if (key === 'y' && !event.shiftKey) return 'history'
    if (key === ',' && !event.shiftKey) return 'preferences'
    return null
  }

  if (command || event.altKey || event.shiftKey) return null
  /**
   * Delete / Backspace は**ボタンや一覧の行の上でも取る。** ボタンが自分で使うのは
   * Space・矢印・Enter で、Delete は使わない。カードを押して選んだ直後はフォーカスが
   * カードにあるので、ここで捨てると「選んで Delete」が効かない。
   * 文字入力（入力欄で文字を消す）と「聴きながら切る」（区切りを消す）の中だけは譲る。
   */
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return event.insideCutEditor ? null : 'delete-shots'
  }
  // 素のキーはフォーカスの持ち主のもの。カット編集・ボタン・入力欄のどれでもないときだけ受ける。
  if (resolveKeyOwner(event.target, event.insideCutEditor) !== 'workbench') return null
  if (event.key === ' ' || event.key === 'Spacebar') return 'toggle-play'
  if (event.key === 'ArrowLeft') return 'previous-shot'
  if (event.key === 'ArrowRight') return 'next-shot'
  return null
}

/** 並びの中で隣の Shot。端では止まる（回り込むと、どこにいるか分からなくなる）。 */
export const neighborShotId = <T extends { readonly id: string }>(
  shots: readonly T[],
  currentId: string | null,
  direction: -1 | 1,
): T['id'] | null => {
  if (shots.length === 0) return null
  const index = shots.findIndex((shot) => shot.id === currentId)
  if (index < 0) return shots[0]?.id ?? null
  const next = Math.min(Math.max(index + direction, 0), shots.length - 1)
  return shots[next]?.id ?? null
}
