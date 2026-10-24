import { usedSourceEndSec } from './timing.js'
import type { Shot } from './shot.js'

/**
 * 「前の Shot から続ける」の繋ぎ目（制作者 2026-10-24）。**純粋。**
 *
 * 次の Shot は、前の Shot が**画面に出す最後のコマ**から作る。ファイルの末尾から作ると、
 * 前の Shot を短く切ったぶんコマが飛び（尺 3.333 秒・Take 3.75 秒で 10 コマ）、
 * 末尾の少し手前から作ると、全部使ったときにコマが戻っていた（2 コマ）。
 *
 * 作った動画の頭は、元にしたコマの写し（1 コマ目）と、動き出しの遅いコマ（2 コマ目）になる（H3 で実測）。
 * この 2 コマを捨てると、3 コマ目が前の Shot の次の 1 コマにちょうど当たる。
 */

/** 次の Shot の頭で捨てるコマ数（元のコマの写し 1 + 動き出し 1）。 */
export const CONTINUITY_HEAD_SKIP_FRAMES = 2

/**
 * 頼む長さに足す余裕（秒）。頼む時点では出来る Take のコマの速さが分からないので、
 * 遅いモデル（16fps）の 2 コマ分を見込む。これが無いと、尺がちょうど作れる長さの Shot は頭を捨てたぶん足りなくなる。
 */
export const CONTINUITY_HEAD_MARGIN_SEC = CONTINUITY_HEAD_SKIP_FRAMES / 16

/** 捨てる長さ（秒）。Take のコマの速さで決まる。 */
export const continuityHeadSkipSec = (takeFps: number): number => CONTINUITY_HEAD_SKIP_FRAMES / takeFps

/** 浮動小数の誤差でコマの境目を跨がないための丸め（コマ数の 100 万分の 1）。 */
const snap = (frames: number): number => Math.round(frames * 1e6) / 1e6

type ContinuityShot = Pick<Shot, 'timing' | 'durationSec' | 'sourceInSec'> & { readonly speed?: number }

/**
 * 前の Shot が画面に出す最後のコマの番号（0 始まり）。
 * 出す区間の終わり（`usedSourceEndSec`。排他）の直前のコマ。Take が足りなければ最後のコマで止まるので、最後のコマ。
 */
export const continuityFrameIndex = (
  shot: ContinuityShot,
  take: { readonly durationSec: number; readonly fps: number },
): number => {
  const lastFrame = Math.max(0, Math.round(take.durationSec * take.fps) - 1)
  const endFrame = Math.ceil(snap(usedSourceEndSec(shot, take.durationSec) * take.fps)) - 1
  return Math.min(lastFrame, Math.max(0, endFrame))
}

/**
 * 前の Shot のコマから作った Take の、使い始める位置（秒）。頭の写しと動き出しのコマを捨てる。
 * 前の Shot のコマを使っていないか、制作者が既にそれ以上切っているなら null（触らない）。
 */
export const continuitySourceInFor = (
  shot: Pick<Shot, 'sourceInSec'>,
  spec: { readonly fps: number; readonly references: readonly { readonly role: string }[] },
): number | null => {
  if (!spec.references.some((reference) => reference.role === 'previous_shot_last_frame')) return null
  const skip = continuityHeadSkipSec(spec.fps)
  return shot.sourceInSec >= skip - 1e-9 ? null : skip
}
