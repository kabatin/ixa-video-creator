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

/**
 * 再生位置を追うときの横スクロールの位置（制作者 2026-10-02「タイムラインも現在位置に合わせて追従するようにしたい」）。
 * 動かさないなら null。聴きながら切ると同じ決まりにする。
 *
 * - 鳴っている間: 再生位置を、見えている帯の真ん中に保つ
 * - 止めている間: 見えているうちは触らない（自分で送った窓を引き戻さない）。画面から出たときだけ真ん中へ連れ戻す
 *
 * 左の見出しの列（`labelPx`）は横に流れないので、見えている帯は箱の幅から見出しを引いた分。
 * 位置はすべて px（画面の上の距離。秒を px にするのは呼ぶ側）。
 */
export const followScrollLeft = (input: {
  /** 帯の 0 秒からの再生位置（px）。 */
  readonly playheadPx: number
  readonly scrollLeft: number
  /** 横スクロールの箱の見えている幅（px）。 */
  readonly viewportPx: number
  /** 左の見出しの列の幅（px）。 */
  readonly labelPx: number
  /** 帯の長さ（px）。 */
  readonly contentPx: number
  readonly playing: boolean
}): number | null => {
  const bandPx = Math.max(input.viewportPx - input.labelPx, 0)
  const visible = input.playheadPx >= input.scrollLeft && input.playheadPx <= input.scrollLeft + bandPx
  if (!input.playing && visible) return null
  const maxScroll = Math.max(input.labelPx + input.contentPx - input.viewportPx, 0)
  const target = Math.min(Math.max(input.playheadPx - bandPx / 2, 0), maxScroll)
  return Math.abs(target - input.scrollLeft) < 1 ? null : target
}
