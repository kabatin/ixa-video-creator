import { z } from 'zod'

/**
 * セリフの行の「差し替えの指定」（ADR-0062）。行ごとに任意。**無い行は口に合わせて読み直す**（既定）。
 *
 * - `placeAtSec`: 口に合わせず、この時刻（Shot の頭からの秒）から話させる。画面外の声など
 * - `fitSec`: この長さに収める。長いときだけ縮める（1.6 倍を超えたら止める）
 * - `cutSec`: 縮めずにこの長さで切る（最後 0.15 秒でフェード）。笑い声など
 * - `levelDb`: 距離（音量だけで出す）。無ければキャラクターの既定
 * - `keepOriginal`: 元の H3 の声のまま（読み直さない・消さない）
 * - `snap: false`: 元の声を消す範囲を、近くの声の区間まで広げない
 * - `added`: H3 が声を出していない所に足す行。`placeAtSec` が必須。音量は `levelLikeIndex` の行に合わせる
 * - `startSec`/`endSec`: 行の手の区間（声の区間から行の区間が決まらないとき）
 */

/** 1 Shot の尺はこれより長くならない（時刻の書き間違いを保存の時点で止める上限）。 */
export const MAX_DUB_TIME_SEC = 120
/** 読み方の指示の上限（文字）。 */
export const MAX_DUB_STYLE_LENGTH = 200
export const MIN_DUB_LEVEL_DB = -40
export const MAX_DUB_LEVEL_DB = 12
/** 収める長さ・切る長さの下限。これより短い声は聞き取れない。 */
export const MIN_DUB_LENGTH_SEC = 0.1
/** `levelLikeIndex` の上限。行の上限（`MAX_DIALOGUE_LINES`）と同じ値。dialogue.ts から引くと循環するので値で持つ。 */
const MAX_LEVEL_LIKE_INDEX = 19

const TimeSec = z.number().finite().min(0).max(MAX_DUB_TIME_SEC)
const LengthSec = z.number().finite().min(MIN_DUB_LENGTH_SEC).max(MAX_DUB_TIME_SEC)

const DialogueDubShape = z
  .object({
    style: z.string().trim().min(1).max(MAX_DUB_STYLE_LENGTH).optional(),
    placeAtSec: TimeSec.optional(),
    fitSec: LengthSec.optional(),
    cutSec: LengthSec.optional(),
    levelDb: z.number().finite().min(MIN_DUB_LEVEL_DB).max(MAX_DUB_LEVEL_DB).optional(),
    keepOriginal: z.boolean().optional(),
    snap: z.boolean().optional(),
    added: z.boolean().optional(),
    levelLikeIndex: z.number().int().min(0).max(MAX_LEVEL_LIKE_INDEX).optional(),
    startSec: TimeSec.optional(),
    endSec: TimeSec.optional(),
  })
  .strict()

type DialogueDubShape = z.infer<typeof DialogueDubShape>

/** 1 行の中で食い違う指定。食い違いが無ければ空。 */
const conflictsOf = (dub: DialogueDubShape): readonly { readonly path: string; readonly message: string }[] => [
  ...(dub.fitSec !== undefined && dub.cutSec !== undefined
    ? [{ path: 'cutSec', message: '収める長さと切る長さは、どちらか 1 つだけにしてください' }]
    : []),
  ...((dub.startSec === undefined) !== (dub.endSec === undefined)
    ? [{ path: 'endSec', message: '行の区間は、始まりと終わりを両方入れてください' }]
    : []),
  ...(dub.startSec !== undefined && dub.endSec !== undefined && !(dub.endSec > dub.startSec)
    ? [{ path: 'endSec', message: '行の区間の終わりは、始まりより後にしてください' }]
    : []),
  ...(dub.added === true && dub.placeAtSec === undefined
    ? [{ path: 'placeAtSec', message: '足す行には、置く時刻が要ります' }]
    : []),
  ...(dub.added === true && dub.keepOriginal === true
    ? [{ path: 'keepOriginal', message: '足す行には元の声がありません（元の声のままにはできません）' }]
    : []),
  ...(dub.added === true && dub.startSec !== undefined
    ? [{ path: 'startSec', message: '足す行には元の声が無いので、行の区間は入れられません' }]
    : []),
  ...(dub.added !== true && dub.levelLikeIndex !== undefined
    ? [{ path: 'levelLikeIndex', message: '音量を合わせる行は、足す行にだけ指定できます' }]
    : []),
]

export const DialogueDub = DialogueDubShape.superRefine((dub, ctx) => {
  conflictsOf(dub).forEach((conflict) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [conflict.path], message: conflict.message }),
  )
})
export type DialogueDub = z.infer<typeof DialogueDub>

/**
 * 行の並びの中で食い違う指定（`levelLikeIndex` は足す行ではない別の行を指す）。食い違いが無ければ空。
 * 位置は `[行の番号, 'dub', 欄]`。
 */
export const dubLineConflicts = (
  lines: readonly { readonly dub?: DialogueDub | undefined }[],
): readonly { readonly path: readonly (string | number)[]; readonly message: string }[] =>
  lines.flatMap((line, index) => {
    const target = line.dub?.levelLikeIndex
    if (target === undefined) return []
    const path = [index, 'dub', 'levelLikeIndex']
    if (target === index) return [{ path, message: '音量を合わせる行に、自分の行は選べません' }]
    const other = lines[target]
    if (other === undefined) return [{ path, message: '音量を合わせる行がありません' }]
    if (other.dub?.added === true) return [{ path, message: '音量を合わせる行は、足す行ではない行にしてください' }]
    return []
  })
