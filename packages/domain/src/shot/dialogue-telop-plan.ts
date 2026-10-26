import type { TimelineClipId } from '../common/ids.js'
import { canonicalJson } from '../generation/spec.js'
import { dialogueTelopOf } from '../timeline/text-template.js'
import type { CreateTimelineClipInput, TimelineClip } from '../timeline/timeline.js'

/**
 * セリフの字幕の作り直しを、(Shot, 何行目) ごとの差分にする（ADR-0061）。
 *
 * **丸ごと消して作り直さない。** 作り直すたびに ID が変わると、取り消しの記録（クリップの直し・見た目のまとめ変更）が
 * 消えた ID を指して戻せなくなり、画面のインスペクターも選んでいた字幕を見失う。
 * - 同じ行の字幕が残っていれば、その行をその場で直す（中身が同じなら何もしない）。
 * - 無ければ作る（消した字幕を戻せるなら戻す。`restorable`）。
 * - 行が無くなった字幕と、同じ行に 2 枚目以降がある字幕（前に重なって作られたもの）は消す。
 */

export type DialogueTelopPatch = Pick<CreateTimelineClipInput, 'track' | 'startSec' | 'durationSec' | 'layer' | 'opacity' | 'content'>

export type DialogueTelopPlan = {
  readonly creates: readonly CreateTimelineClipInput[]
  readonly updates: readonly { readonly id: TimelineClipId; readonly patch: DialogueTelopPatch }[]
  /** 戻してから直す（論理削除を外す）。 */
  readonly restores: readonly { readonly id: TimelineClipId; readonly patch: DialogueTelopPatch | null }[]
  readonly deletes: readonly TimelineClipId[]
}

const keyOf = (content: CreateTimelineClipInput['content']): string | null => {
  const mark = content.type === 'text' ? dialogueTelopOf(content.params) : null
  return mark === null ? null : `${mark.shotId}#${String(mark.lineIndex)}`
}

const patchOf = (clip: CreateTimelineClipInput): DialogueTelopPatch => ({
  track: clip.track,
  startSec: clip.startSec,
  durationSec: clip.durationSec,
  layer: clip.layer ?? 0,
  opacity: clip.opacity ?? 1,
  content: clip.content,
})

const sameShape = (a: DialogueTelopPatch, b: DialogueTelopPatch): boolean => canonicalJson(a) === canonicalJson(b)

/** 行ごとに、頭の早い 1 枚を残す側にする。残りは重なり（消す）。 */
const byKey = (clips: readonly TimelineClip[]): ReadonlyMap<string, readonly TimelineClip[]> =>
  [...clips]
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
    .reduce<ReadonlyMap<string, readonly TimelineClip[]>>((acc, clip) => {
      const key = keyOf(clip.content)
      return key === null ? acc : new Map([...acc, [key, [...(acc.get(key) ?? []), clip]]])
    }, new Map())

export const planDialogueTelopSync = (input: {
  /** 今ある（論理削除していない）セリフの字幕。 */
  readonly live: readonly TimelineClip[]
  /** 戻してよい、消した字幕（行ごとに 1 枚まで）。 */
  readonly restorable?: readonly TimelineClip[]
  readonly desired: readonly CreateTimelineClipInput[]
}): DialogueTelopPlan => {
  const live = byKey(input.live)
  const restorable = byKey(input.restorable ?? [])
  const wanted = new Set(input.desired.flatMap((clip) => keyOf(clip.content) ?? []))
  const steps = input.desired.map((clip) => {
    const key = keyOf(clip.content)
    const patch = patchOf(clip)
    const survivor = key === null ? undefined : live.get(key)?.[0]
    if (survivor !== undefined) {
      return sameShape(patchOf(survivor), patch) ? ({ kind: 'same' } as const) : ({ kind: 'update', id: survivor.id, patch } as const)
    }
    const back = key === null ? undefined : restorable.get(key)?.[0]
    if (back !== undefined) return { kind: 'restore', id: back.id, patch: sameShape(patchOf(back), patch) ? null : patch } as const
    return { kind: 'create', clip } as const
  })
  return {
    creates: steps.flatMap((step) => (step.kind === 'create' ? [step.clip] : [])),
    updates: steps.flatMap((step) => (step.kind === 'update' ? [{ id: step.id, patch: step.patch }] : [])),
    restores: steps.flatMap((step) => (step.kind === 'restore' ? [{ id: step.id, patch: step.patch }] : [])),
    deletes: [...live].flatMap(([key, clips]) => (wanted.has(key) ? clips.slice(1) : clips).map((clip) => clip.id)),
  }
}

/** 何も変えない作り直しか。 */
export const isEmptyDialogueTelopPlan = (plan: DialogueTelopPlan): boolean =>
  plan.creates.length + plan.updates.length + plan.restores.length + plan.deletes.length === 0
