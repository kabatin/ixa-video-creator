'use client'

import { useRouter } from 'next/navigation'

import type {
  ProjectId,
  Shot,
  ShotId,
  TimelineClip,
  TimelineClipId,
  TimelineTrack,
  Transition,
  TransitionId,
} from '@ixa/domain'
import { useMemo, useRef, useState } from 'react'
import { TimelineClipList, type ClipPatch } from '@/components/timeline-clip-list'
import {
  TimelineInlineForm,
  inlineFormErrors,
  type InlineFormAnchor,
  type InlineFormDraft,
} from '@/components/timeline-inline-form'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import { TimelineSnapPanel } from '@/components/timeline-snap-panel'
import { TEXT_INSERT_LAYER, TimelineTracks } from '@/components/timeline-tracks'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'
import { createTimelineApi, type WireTimelineIssue } from '@/lib/timeline-api'
import {
  DEFAULT_PX_PER_SEC,
  ZOOM_LEVELS,
  formatDuration,
  programEndSec,
} from '@/lib/timeline-display'
import {
  candidatesForClipDrag,
  type ClipDragContext,
  type ClipDragOutcome,
} from '@/lib/timeline-drag'
import {
  INSERTABLE_TRANSITION_TYPES,
  probeTextInsertion,
  transitionInsertionPoints,
  validateTextClipInsert,
  validateTransitionInsert,
  type InsertIssue,
  type TransitionInsertionPoint,
} from '@/lib/timeline-insert'
import {
  openFormCaption,
  textEditDraft,
  textInsertDraft,
  transitionDraft,
  type OpenInlineForm,
} from '@/lib/timeline-open-form'
import {
  buildSnapCandidates,
  snapSpan,
  snapToleranceSec,
  type BeatSource,
  type SnapSpanInput,
  type SnapSpanOutcome,
} from '@/lib/timeline-snap'

/**
 * タイムライン編集画面の操作盤（P5-4）。
 *
 * 読み込みは部分的に失敗しうる。**失敗した部分を空として描かない。**
 * 空配列（本当に 0 件）と null（読み込めていない）を最後まで区別して渡す（lessons L-015）。
 *
 * ビート吸着は `@ixa/timeline` の `collectSnapCandidates` / `snapTime` をそのまま呼ぶ。
 * **画面に吸着の規則を書き写さない**（正は 1 箇所、lessons L-016）。
 * 許容距離はズーム率から出すので、拡大すると細かく置ける。
 */

export type TimelineEditorProps = {
  readonly projectId: ProjectId
  readonly shots: readonly Shot[] | null
  readonly initialTransitions: readonly Transition[] | null
  readonly initialClips: readonly TimelineClip[] | null
  /** `TimelineDocument.video1` に載った ShotId。null なら組み立て結果を読めていない。 */
  readonly renderedShotIds: readonly ShotId[] | null
  /** サーバの検証結果。null は「検査できていない」（指摘なしの空配列とは別物）。 */
  readonly initialIssues: readonly WireTimelineIssue[] | null
  readonly documentDurationSec: number | null
  /**
   * ビート候補の出どころ。**「解析が無い」と「読めていない」を畳まずに渡す。**
   * どちらもビートには吸着しないが、利用者が取るべき行動が違う（lessons L-015）。
   */
  readonly beatSource: BeatSource
  /** 読み込みに失敗した部分の理由。1 件でもあれば画面に必ず出す。 */
  readonly loadErrors: readonly string[]
}

export const TimelineEditor = ({
  projectId,
  shots,
  initialTransitions,
  initialClips,
  renderedShotIds,
  initialIssues,
  documentDurationSec,
  beatSource,
  loadErrors,
}: TimelineEditorProps) => {
  const api = useMemo(() => createTimelineApi(createRequester(resolveApiBaseUrl())), [])

  const router = useRouter()

  const [transitions, setTransitions] = useState(initialTransitions)
  const [clips, setClips] = useState(initialClips)
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [selectedClipId, setSelectedClipId] = useState<TimelineClipId | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  /** 帯の上で開いている入力。開く場所が変わったら下書きも作り直す。 */
  const [open, setOpen] = useState<OpenInlineForm | null>(null)
  const [draft, setDraft] = useState<InlineFormDraft | null>(null)
  const [formIssues, setFormIssues] = useState<readonly InsertIssue[]>([])
  /** 掴んでいる最中の見た目。確定するまで本体は書き換えない。 */
  const [preview, setPreview] = useState<{
    readonly id: TimelineClipId
    readonly span: { readonly startSec: number; readonly durationSec: number }
  } | null>(null)
  /** 掴んで止まった理由・吸着した先。**黙って丸めない。** */
  const [dragNotes, setDragNotes] = useState<readonly string[]>([])
  /**
   * 入力を開いた元のボタン。**閉じたら焦点をここへ戻す。**
   * 戻さないと、キーボードだけで操作している人が現在地を失って帯の先頭へ飛ばされる。
   * 戻すのは入力部品の仕事なので、こちらは受け口を渡すだけ。
   */
  const openerRef = useRef<HTMLElement | null>(null)

  /**
   * 検証はサーバの `validateTimeline` が唯一の正。**画面に同じ規則を置かない。**
   * 置くと必ずズレて、レンダリングでは止まるのに画面では合格に見える状態が生まれる。
   *
   * null は「検査できていない」を意味する（取得に失敗した場合）。空配列の
   * 「指摘なし」とは別物で、画面も出し分ける。
   */
  const issues = initialIssues

  const durationSec = documentDurationSec ?? programEndSec(shots ?? [])

  /**
   * 吸着の材料。読み込めていない部分は空として渡すしかないが、
   * **その事実は `beatSource` と読み込みエラーの表示で別に出している。**
   * 候補が減っていることを黙って「吸着しない」に畳まない。
   */
  const snapSource = useMemo(
    () => ({
      shots: shots ?? [],
      clips: clips ?? [],
      beatSource,
      timelineEndSec: durationSec,
    }),
    [shots, clips, beatSource, durationSec],
  )

  /** 許容距離はズーム率から。px で一定にするのは `snapToleranceSecForZoom` の判断。 */
  const toleranceSec = snapToleranceSec(pxPerSec)

  /** 内訳の表示用。どのクリップも除外していない状態の候補数。 */
  const overviewCandidates = useMemo(
    () => buildSnapCandidates(snapSource, { clipId: null }),
    [snapSource],
  )

  /**
   * **動かしている当のクリップを必ず除外する。**
   * 自分の端は距離 0 の候補になり、そこへ吸着して二度と動かせなくなる。
   */
  const snapSpanForClip = (clipId: TimelineClipId | null, span: SnapSpanInput): SnapSpanOutcome =>
    snapSpan(span, buildSnapCandidates(snapSource, { clipId }), toleranceSec, snapEnabled)

  /** 失敗を握り潰すと「押したのに何も起きない」画面になる。必ず理由を出す。 */
  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setStatus(`${label}しました`)
      // 他の画面の先読み内容を捨てる（music-panel.tsx の説明を参照）。
      router.refresh()
    } catch (error) {
      setActionError(`${label}できませんでした: ${describeError(error)}`)
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  const removeTransition = (id: TransitionId): void => {
    void run('Transition を削除', async () => {
      await api.deleteTransition(id)
      setTransitions((current) =>
        current === null ? current : current.filter((transition) => transition.id !== id),
      )
    })
  }

  // --- 帯の上の入力 ---

  const points = useMemo(
    () => transitionInsertionPoints(shots ?? [], transitions ?? []),
    [shots, transitions],
  )

  const closeForm = (): void => {
    setOpen(null)
    setDraft(null)
    setFormIssues([])
  }

  const openTransition = (
    point: TransitionInsertionPoint,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ): void => {
    openerRef.current = opener
    setOpen({ kind: 'transition', point, anchor })
    setDraft(transitionDraft(point))
    setFormIssues([])
  }

  const openTextInsert = (
    track: TimelineTrack,
    atSec: number,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ): void => {
    openerRef.current = opener
    const probe = probeTextInsertion({
      clips: clips ?? [],
      track,
      layer: TEXT_INSERT_LAYER,
      atSec,
      programEndSec: durationSec,
    })
    if (!probe.ok) {
      // **置けない理由を必ず出す。** 押しても何も出ないと、押せる場所が分からない。
      closeForm()
      setActionError(probe.message)
      return
    }
    setActionError(null)
    setOpen({ kind: 'text_insert', track, layer: TEXT_INSERT_LAYER, anchor })
    setDraft(textInsertDraft(probe))
    setFormIssues([])
  }

  const openClip = (
    clip: TimelineClip,
    anchor: InlineFormAnchor,
    opener: HTMLElement | null,
  ): void => {
    openerRef.current = opener
    setOpen({ kind: 'text_edit', clip, anchor })
    // 読めなかった値は `null` のまま渡す。断りは入力部品が出す。
    setDraft(textEditDraft(clip))
    setFormIssues([])
  }

  /**
   * トランジションは差し替えの口が無いので、**消してから作り直す**。
   * 2 つの Shot の間に 1 本、という不変条件を保ちやすいため（`timeline-api.ts`）。
   */
  const submitTransition = (point: TransitionInsertionPoint, next: InlineFormDraft): void => {
    if (next.kind !== 'transition') return
    const result = validateTransitionInsert(point, {
      type: next.type,
      durationSec: next.durationSec,
    })
    if (!result.ok) {
      setFormIssues(result.issues)
      return
    }
    const existing = point.existing
    void run(existing === null ? 'Transition を追加' : 'Transition を差し替え', async () => {
      if (existing !== null) {
        await api.deleteTransition(existing.id)
        setTransitions((current) =>
          current === null ? current : current.filter((t) => t.id !== existing.id),
        )
      }
      const created = await api.createTransition(projectId, result.value)
      setTransitions((current) => (current === null ? [created] : [...current, created]))
      closeForm()
    })
  }

  const submitTextClip = (next: InlineFormDraft, existing: TimelineClip | null): void => {
    if (next.kind !== 'text') return
    const track: TimelineTrack = existing?.track ?? 'TEXT'
    const layer = existing?.layer ?? TEXT_INSERT_LAYER
    const result = validateTextClipInsert({
      // 自分自身は重なりの相手にしない。直しているのだから当然ぶつかる。
      clips: (clips ?? []).filter((clip) => clip.id !== existing?.id),
      track,
      layer,
      programEndSec: durationSec,
      draft: {
        // 読めなかった値は `null` で来る。**検証へ渡す直前にだけ畳む。**
        // 早く畳むと「読めない」と「空」の区別が消える。
        templateKey: next.templateKey ?? '',
        text: next.text ?? '',
        startSec: next.startSec,
        durationSec: next.durationSec,
      },
    })
    if (!result.ok) {
      setFormIssues(result.issues)
      return
    }

    const value = result.value
    if (existing === null) {
      void run('テロップを追加', async () => {
        const created = await api.createClip(projectId, {
          track: value.track,
          startSec: value.startSec,
          durationSec: value.durationSec,
          layer: value.layer,
          content: {
            type: 'text',
            templateKey: value.templateKey,
            params: { ...value.params },
          },
        })
        setClips((current) => (current === null ? [created] : [...current, created]))
        closeForm()
      })
      return
    }

    void run('テロップを更新', async () => {
      const updated = await api.updateClip(existing.id, {
        startSec: value.startSec,
        durationSec: value.durationSec,
        content: {
          type: 'text',
          templateKey: value.templateKey,
          params: { ...value.params },
        },
      })
      setClips((current) =>
        current === null ? current : current.map((c) => (c.id === existing.id ? updated : c)),
      )
      closeForm()
    })
  }

  // --- 掴んで動かす ---

  const beginDrag = (clip: TimelineClip): ClipDragContext => {
    setDragNotes([])
    return {
      // **当人を候補から外す。** 外し忘れると自分の端に吸着して動かせない。
      candidates: candidatesForClipDrag(snapSource, clip.id),
      toleranceSec,
      snapEnabled,
      timelineEndSec: durationSec,
    }
  }

  const dragMove = (clip: TimelineClip, outcome: ClipDragOutcome): void => {
    setPreview({ id: clip.id, span: outcome.span })
  }

  const dragEnd = (clip: TimelineClip, outcome: ClipDragOutcome): void => {
    setPreview(null)
    setDragNotes([
      ...outcome.limits.map((limit) => limit.message),
      ...outcome.snapNotices.filter((n) => n.state === 'snapped').map((n) => n.message),
    ])
    if (!outcome.moved) return
    void run('クリップの位置と尺を更新', async () => {
      const updated = await api.updateClip(clip.id, {
        startSec: outcome.span.startSec,
        durationSec: outcome.span.durationSec,
      })
      setClips((current) =>
        current === null ? current : current.map((c) => (c.id === clip.id ? updated : c)),
      )
    })
  }

  const updateClip = (id: TimelineClipId, patch: ClipPatch): void => {
    void run('クリップを更新', async () => {
      const updated = await api.updateClip(id, patch)
      setClips((current) =>
        current === null ? current : current.map((clip) => (clip.id === id ? updated : clip)),
      )
    })
  }

  const removeClip = (id: TimelineClipId): void => {
    void run('クリップを削除', async () => {
      await api.deleteClip(id)
      setClips((current) => (current === null ? current : current.filter((clip) => clip.id !== id)))
      setSelectedClipId((current) => (current === id ? null : current))
    })
  }

  return (
    <div className="space-y-6">
      {loadErrors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-4">
          {loadErrors.map((message) => (
            <li key={message} className="text-sm text-red-800">
              {message}
            </li>
          ))}
        </ul>
      )}

      <TimelineIssuePanel issues={issues} projectId={projectId} />

      <TimelineSnapPanel
        enabled={snapEnabled}
        onToggle={setSnapEnabled}
        beatSource={beatSource}
        toleranceSec={toleranceSec}
        candidates={overviewCandidates}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-700">{`全体の尺 ${formatDuration(durationSec)}`}</span>
        <span className="text-sm text-slate-500">ズーム（1 秒あたりの px）</span>
        {ZOOM_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={level === pxPerSec}
            onClick={() => {
              setPxPerSec(level)
            }}
            className={`rounded-md px-3 py-1 text-sm ring-1 ${
              level === pxPerSec
                ? 'bg-slate-900 text-white ring-slate-900'
                : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-100'
            }`}
          >
            {level}
          </button>
        ))}
      </div>

      {actionError !== null && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {actionError}
        </p>
      )}
      {status !== null && actionError === null && (
        <p role="status" className="rounded-md bg-slate-100 p-3 text-sm text-slate-700">
          {status}
        </p>
      )}

      {shots === null ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800"
        >
          Shot を読み込めていません。タイムラインを描けません。
        </p>
      ) : (
        <TimelineTracks
          shots={shots}
          clips={clips ?? []}
          transitionPoints={points}
          renderedShotIds={new Set(renderedShotIds ?? [])}
          durationSec={durationSec}
          pxPerSec={pxPerSec}
          selectedClipId={selectedClipId}
          busy={busy}
          openTransitionAtSec={open?.kind === 'transition' ? open.point.atSec : null}
          previewClipId={preview?.id ?? null}
          previewSpan={preview?.span ?? null}
          onSelectClip={setSelectedClipId}
          onOpenTransition={openTransition}
          onOpenClip={openClip}
          onInsertText={openTextInsert}
          onClipDragBegin={beginDrag}
          onClipDragMove={dragMove}
          onClipDragEnd={dragEnd}
          overlay={
            open === null || draft === null ? null : (
              <TimelineInlineForm
                // 開く場所が変われば作り直す。残っていると前の打ちかけが出る。
                key={`${open.kind}-${String(open.anchor.leftPx)}-${String(open.anchor.topPx)}`}
                draft={draft}
                anchor={open.anchor}
                caption={openFormCaption(open)}
                transitionTypes={INSERTABLE_TRANSITION_TYPES}
                errors={inlineFormErrors(formIssues)}
                returnFocusRef={openerRef}
                busy={busy}
                onSubmit={(next) => {
                  if (open.kind === 'transition') submitTransition(open.point, next)
                  else submitTextClip(next, open.kind === 'text_edit' ? open.clip : null)
                }}
                onDismiss={closeForm}
                onRemove={
                  open.kind === 'transition' && open.point.existing !== null
                    ? () => {
                        removeTransition(open.point.existing!.id)
                        closeForm()
                      }
                    : open.kind === 'text_edit'
                      ? () => {
                          removeClip(open.clip.id)
                          closeForm()
                        }
                      : undefined
                }
              />
            )
          }
        />
      )}

      {dragNotes.length > 0 && (
        <ul role="status" className="space-y-1 rounded-md bg-slate-100 p-3 text-sm text-slate-700">
          {dragNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {/**
       * 数値で直す口は残す。**帯の上の操作は掴める幅に限りがある。**
       * 0.01 秒を合わせ込むには数値のほうが速く、キーボードだけでも操作できる。
       * 主でなくなったので、開かないと出ないところへ下げてある。
       */}
      <details className="rounded-lg border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          クリップを数値で直す
        </summary>
        <div className="mt-4">
          <TimelineClipList
            clips={clips}
            busy={busy}
            selectedClipId={selectedClipId}
            onSelect={setSelectedClipId}
            onUpdate={updateClip}
            onRemove={removeClip}
            onSnapSpan={snapSpanForClip}
          />
        </div>
      </details>
    </div>
  )
}
