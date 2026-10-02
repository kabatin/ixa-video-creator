'use client'

import type { ProjectId, Shot } from '@ixa/domain'
import { SHOT_MIN_DURATION_SEC } from '@ixa/timeline'
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'
import { createRoughCutApi, type RoughCutApi } from '@/lib/rough-cut-api'
import type { TimeSpan } from '@/lib/timeline-display'
import {
  applyClipDrag,
  timelineSecAtClientX,
  type ClipDragContext,
  type ClipDragOutcome,
  type ClipDragStart,
} from '@/lib/timeline-drag'
import { adjacentIds, previewSpans } from '@/lib/timeline-rolling'
import { shotEdgeEdit, shotEdgeGrabBlocked, shotEdgeNeighbors } from '@/lib/timeline-shot-edge'

/**
 * カット（VIDEO1 の Shot）の端をつまんで長さを変える（制作者 2026-10-02「CUT4 の右側をつまんで右に移動したら
 * CUT5 の先頭が後ろに追従して下がる感じ、逆もしかり、左側も同様」）。
 *
 * **計算はここに書かない。** 端の動きは `timeline-drag` と `timeline-rolling`（テロップと同じ規則）、
 * 送る変更は `timeline-shot-edge` が決める。ここは指の動きを渡し、離したら粗編集の適用で当てるだけ。
 */

export type ShotEdgeDragProps = {
  readonly projectId: ProjectId
  readonly busy: boolean
  /** 掴んだ。外す Shot（自分と付いてくる隣）の端を除いた吸着の候補と許容距離を返す。 */
  readonly begin: (excludeShotIds: ReadonlySet<string>) => ClipDragContext
  /** 止めた理由・吸着した先・断られた理由・当てた結果。**黙って丸めない。** */
  readonly notify: (notes: readonly string[]) => void
  /** 当てた。サーバの材料を読み直す。 */
  readonly onApplied: () => void
  readonly api?: Pick<RoughCutApi, 'applyRoughCut'>
}

export type ShotEdgeHandle = 'start' | 'end'

type ShotDrag = {
  readonly shot: Shot
  readonly start: ClipDragStart
  readonly context: ClipDragContext
  readonly pointerId: number
}

/** 仮の位置。`basis` の Shot 一覧を描いている間だけ使う（読み直した一覧が届いたら捨てる）。 */
type ShotPreview = { readonly basis: readonly Shot[]; readonly spans: ReadonlyMap<string, TimeSpan> }

const dragNotesOf = (outcome: ClipDragOutcome): readonly string[] => [
  ...outcome.limits.map((limit) => limit.message),
  ...outcome.snapNotices.filter((notice) => notice.state === 'snapped').map((notice) => notice.message),
]

export const useShotEdgeDrag = (
  shots: readonly Shot[],
  pxPerSec: number,
  laneRef: RefObject<HTMLDivElement | null>,
  edges: ShotEdgeDragProps | undefined,
) => {
  const injected = edges?.api
  const client = useMemo(() => injected ?? createRoughCutApi(createRequester(resolveApiBaseUrl())), [injected])
  const dragRef = useRef<ShotDrag | null>(null)
  const [preview, setPreview] = useState<ShotPreview | null>(null)
  const [applying, setApplying] = useState(false)

  const boundsOf = (): { readonly left: number } => ({ left: laneRef.current?.getBoundingClientRect().left ?? 0 })
  const outcomeAt = (drag: ShotDrag, event: ReactPointerEvent<HTMLElement>): ClipDragOutcome =>
    applyClipDrag(drag.start, event.clientX, boundsOf(), pxPerSec, drag.context, { detach: event.altKey })
  const takeDrag = (event: ReactPointerEvent<HTMLElement>): ShotDrag | null => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return null
    // 帯の Shot の長押しメニューに流さない。
    event.stopPropagation()
    return drag
  }
  const release = (event: ReactPointerEvent<HTMLElement>): void => {
    dragRef.current = null
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // 捕捉していなければ解く物も無い。
    }
  }

  const apply = (edits: ShotEdgeDragProps, drag: ShotDrag, outcome: ClipDragOutcome): void => {
    const notes = dragNotesOf(outcome)
    const edit = shotEdgeEdit(shots, drag.shot, outcome)
    if (edit.problem !== null || edit.changes.length === 0) {
      setPreview(null)
      edits.notify([...notes, ...(edit.problem === null ? [] : [edit.problem])])
      return
    }
    // 読み直した一覧が届くまで仮の位置で描く（離した瞬間に元へ戻って見えないように）。
    setPreview({ basis: shots, spans: previewSpans(drag.shot.id, outcome) })
    setApplying(true)
    edits.notify(notes)
    client
      .applyRoughCut(edits.projectId, edit.changes, edit.summary)
      .then((result) => {
        if (result.skipped.length > 0) {
          setPreview(null)
          edits.notify([...notes, ...result.skipped.map((entry) => entry.reason)])
        } else {
          edits.notify([...notes, `${edit.summary}。変更の履歴から戻せます`])
        }
        edits.onApplied()
      })
      .catch((cause: unknown) => {
        setPreview(null)
        edits.notify([...notes, `長さを変えられませんでした: ${describeError(cause)}`])
      })
      .finally(() => {
        setApplying(false)
      })
  }

  const handleProps = (shot: Shot, handle: ShotEdgeHandle) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
      if (edges === undefined || event.button !== 0) return
      event.stopPropagation()
      if (edges.busy || applying) return
      const neighbors = shotEdgeNeighbors(shots, shot)
      const blocked = shotEdgeGrabBlocked(shot, handle, neighbors, shots)
      if (blocked !== null) {
        edges.notify([blocked])
        return
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 捕捉は上乗せ。要素の中にいる限り pointermove は届く。
      }
      dragRef.current = {
        shot,
        start: {
          handle,
          origin: { startSec: shot.startSec, durationSec: shot.durationSec },
          grabSec: timelineSecAtClientX(event.clientX, boundsOf(), pxPerSec),
        },
        context: {
          // 自分と付いてくる隣の端を候補から外す（その端は距離 0 で、吸い寄せると動かせない）。
          ...edges.begin(new Set([shot.id, ...adjacentIds(neighbors)])),
          neighbors,
          minDurationSec: SHOT_MIN_DURATION_SEC,
          minNeighborSec: SHOT_MIN_DURATION_SEC,
          neighborNoun: 'カット',
        },
        pointerId: event.pointerId,
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>): void => {
      const drag = takeDrag(event)
      if (drag === null) return
      setPreview({ basis: shots, spans: previewSpans(drag.shot.id, outcomeAt(drag, event)) })
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>): void => {
      const drag = takeDrag(event)
      if (drag === null || edges === undefined) return
      release(event)
      apply(edges, drag, outcomeAt(drag, event))
    },
    // 取りやめは当てない（変更の履歴に残る操作なので、指が外れただけで書かない）。
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>): void => {
      if (takeDrag(event) === null) return
      release(event)
      setPreview(null)
    },
  })

  /** 描く区間。ドラッグ中・当てている最中は仮の位置。 */
  const spanOf = (shot: Shot): TimeSpan =>
    (preview !== null && preview.basis === shots ? preview.spans.get(shot.id) : undefined) ?? shot
  const previewing = (shot: Shot): boolean => preview !== null && preview.basis === shots && preview.spans.has(shot.id)

  return { handleProps, spanOf, previewing }
}
