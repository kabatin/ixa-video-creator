import { THUMBNAIL_TOO_BIG_MESSAGE } from '@ixa/render'
import { withoutUrls } from './redact.js'

/**
 * サムネイルが失敗したときに行へ書く文と、ログに残す詳細（ADR-0051）。
 *
 * **行（画面にそのまま出る）には決まった日本語だけを書く。** Remotion・Chrome の英語の文や
 * 「（画質 90）」のような内部の値を重ねると、画面に三重に包まれた読めない文が出た。
 * 詳細はログにだけ残す（URL は抜く）。
 */

/** 利用者に見せる理由をそのまま持つ失敗（背景が無い・文書が届いていない など、分かっている場合）。 */
export class ThumbnailFailure extends Error {
  override readonly name = 'ThumbnailFailure'
}

export const THUMBNAIL_FAILED_MESSAGE = 'サムネイルを描けませんでした。もう一度書き出してください。'

/** 画面に出す文。分かっている失敗はその文、描く側の大きさの失敗はその文、ほかは決まった 1 文。 */
export const failureMessageFor = (error: unknown): string => {
  if (error instanceof ThumbnailFailure) return error.message
  if (error instanceof Error && error.message === THUMBNAIL_TOO_BIG_MESSAGE) return THUMBNAIL_TOO_BIG_MESSAGE
  return THUMBNAIL_FAILED_MESSAGE
}

const MAX_CAUSE_DEPTH = 5

const causeChain = (error: unknown, depth: number): readonly string[] => {
  if (error === undefined || error === null || depth >= MAX_CAUSE_DEPTH) return []
  if (!(error instanceof Error)) return [typeof error === 'string' ? error : JSON.stringify(error)]
  return [error.message, ...causeChain(error.cause, depth + 1)]
}

/** 原因をたどった文（ログ用）。`cause` の鎖も含め、URL は抜く。深すぎる鎖は打ち切る。 */
export const describeCause = (error: unknown): string => withoutUrls(causeChain(error, 0).join(' ← '))
