import { isTextEntryTarget, type KeyTargetLike } from '@/lib/playback-state'
import { secondsToPx } from '@/lib/timeline-display'
import { timelineSecAtClientX, type TimelineBounds } from '@/lib/timeline-drag'

/**
 * タイムラインの再生ヘッド（PHASE 6.0）。**React を含まない。**
 *
 * 位置の変換は `timeline-display` / `timeline-drag` の物を呼ぶ。写さない（L-016）。
 * ここが持つのは「目盛りを押した秒」「線を置く x」「キーの行き先」の 3 つだけ。
 */

/** 再生ヘッドの線を置く x（px）。曲の外は端に収める。 */
export const playheadLeftPx = (currentSec: number, durationSec: number, pxPerSec: number): number =>
  secondsToPx(Math.min(Math.max(currentSec, 0), Math.max(durationSec, 0)), pxPerSec)

/** 目盛りの帯を押した位置を秒に。曲の外は端に収める。 */
export const seekSecAtClientX = (
  clientX: number,
  bounds: TimelineBounds,
  pxPerSec: number,
  durationSec: number,
): number => {
  const sec = timelineSecAtClientX(clientX, bounds, pxPerSec)
  return Math.min(Math.max(sec, 0), Math.max(durationSec, 0))
}

export type TimelineKeyEvent = {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly target: KeyTargetLike | null
}

export type TimelineKeyCommand = { readonly kind: 'toggle_play' }

/**
 * タイムライン画面のキー。**いまは Space だけ。**
 *
 * 帯の上の入力（その場で出る入力・数値の欄）に飛んだ打鍵は横取りしない。
 * 矢印などを足すときは `cut-editor-keys` と同じく**衝突を 1 か所で解く**こと（L-018）。
 */
export const resolveTimelineKey = (event: TimelineKeyEvent): TimelineKeyCommand | null => {
  if (isTextEntryTarget(event.target)) return null
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  return event.key === ' ' || event.key === 'Spacebar' ? { kind: 'toggle_play' } : null
}

/** 画面に出す割り当て。判定と同じファイルに置き、ズレないようにする。 */
export const TIMELINE_KEY_HELP: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Space', action: '再生 / 一時停止' },
]
