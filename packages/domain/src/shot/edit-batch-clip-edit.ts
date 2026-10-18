import { z } from 'zod'
import { TimelineClipId } from '../common/ids.js'
import { TimelineClip, type TimelineClipContent, type TimelineTrack } from '../timeline/timeline.js'

/**
 * クリップ（テロップ・エフェクト・効果音・重ね素材）1 件ずつの作る・直す・消すの記録（`clip_edit`。2026-10-19）。
 * 制作者「『この効果音を消す』を押して消したけど、元に戻したい時に UNDO できなかった」。
 *
 * **変える前のクリップを丸ごと持つ。** 直した欄だけを持つ Shot の記録（`EditBatchEntry`）と違い、
 * 消したクリップは丸ごと無くなるので、戻すには全部が要る。戻すと**同じ ID・同じ中身**になる
 * （消したものは論理削除を外し、直したものは控えの値で上書きし、作ったものは論理削除する）。
 */

/** 控え。ID と作品は記録の側が持ち、作った時刻は戻しても変わらないので持たない（`Date` は jsonb から読み戻せない）。 */
export const ClipSnapshot = TimelineClip.omit({ id: true, projectId: true, createdAt: true })
export type ClipSnapshot = z.infer<typeof ClipSnapshot>

/**
 * 1 件ぶん。**作った物は控えを持たない**（戻すと消すだけ）。直した物・消した物は必ず控えを持つ
 * （無ければ戻す先が無い。型で起こせなくする）。
 */
export const EditBatchClipEdit = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), clipId: TimelineClipId }),
  z.object({ op: z.literal('update'), clipId: TimelineClipId, before: ClipSnapshot }),
  z.object({ op: z.literal('delete'), clipId: TimelineClipId, before: ClipSnapshot }),
])
export type EditBatchClipEdit = z.infer<typeof EditBatchClipEdit>
export type ClipEditOp = EditBatchClipEdit['op']

export const clipSnapshotOf = (clip: TimelineClip): ClipSnapshot =>
  ClipSnapshot.parse({
    track: clip.track,
    startSec: clip.startSec,
    durationSec: clip.durationSec,
    layer: clip.layer,
    content: clip.content,
    opacity: clip.opacity,
  })

/** 呼び名を決める材料。作る前の入力（既定値を省いた形）でも渡せるよう、帯と中身の種類だけを見る。 */
export type ClipKindSource = {
  readonly track: TimelineTrack
  readonly content: { readonly type: TimelineClipContent['type'] }
}

/** 画面の呼び名。中身で決まり、音・映像の素材は帯で分ける（VIDEO2 は「重ね素材」）。 */
export const clipNounOf = (clip: ClipKindSource): string => {
  if (clip.content.type === 'text') return 'テロップ'
  if (clip.content.type === 'motion_graphics') return 'エフェクト'
  return clip.track === 'SFX' ? '効果音' : '重ね素材'
}

/** 位置と尺だけを変えたなら「動かす」。それ以外を含めば「直す」。 */
const MOVE_FIELDS: ReadonlySet<string> = new Set(['startSec', 'durationSec'])

/** 履歴の見出し（「効果音を消す」「テロップを動かす」）。`changedFields` は直したときに送られた欄。 */
export const clipEditSummary = (
  op: ClipEditOp,
  clip: ClipKindSource,
  changedFields: readonly string[] = [],
): string => {
  const noun = clipNounOf(clip)
  if (op === 'create') return `${noun}を置く`
  if (op === 'delete') return `${noun}を消す`
  const moved = changedFields.length > 0 && changedFields.every((field) => MOVE_FIELDS.has(field))
  return moved ? `${noun}を動かす` : `${noun}を直す`
}
