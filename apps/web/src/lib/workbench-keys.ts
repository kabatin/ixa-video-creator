import { isTextEntryTarget, type KeyTargetLike } from '@/lib/playback-state'

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
 *
 * - **入力欄の中の打鍵は取らない。** ⌘Z は文字の取り消しとしてブラウザに任せる
 * - Space と ← → は「聴きながら切る」が見えている間はそちらに任せる（区切りの操作に使う）
 * - ボタンの上の Space はボタンを押す打鍵。再生に変えない
 */
export type WorkbenchKeyEvent = {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly target: (KeyTargetLike & { readonly role?: string | null }) | null
  /** 聴きながら切るが見えていて、自分の打鍵を受けている。 */
  readonly cutterActive: boolean
}

export type WorkbenchKeyCommand =
  | 'undo'
  | 'redo'
  | 'history'
  | 'preferences'
  | 'toggle-play'
  | 'previous-shot'
  | 'next-shot'

/** 押すと自分が動く要素。Space や矢印はそちらのもの。 */
const OWN_KEYS_TAGS: ReadonlySet<string> = new Set(['BUTTON', 'A', 'SUMMARY'])
const OWN_KEYS_ROLES: ReadonlySet<string> = new Set(['menuitem', 'tab', 'option', 'slider', 'checkbox'])

const ownsPlainKeys = (target: WorkbenchKeyEvent['target']): boolean =>
  target !== null &&
  (OWN_KEYS_TAGS.has((target.tagName ?? '').toUpperCase()) ||
    (target.role !== null && target.role !== undefined && OWN_KEYS_ROLES.has(target.role)))

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
  if (event.cutterActive || ownsPlainKeys(event.target)) return null
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
