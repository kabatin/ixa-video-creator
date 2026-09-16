'use client'

import type {
  ProjectId,
  Shot,
  ShotId,
  TimelineClip,
  TimelineClipId,
  Transition,
  TransitionId,
} from '@ixa/domain'
import { useMemo, useState } from 'react'
import { TimelineClipForm, type NewTextClipInput } from '@/components/timeline-clip-form'
import { TimelineClipList, type ClipPatch } from '@/components/timeline-clip-list'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import { TimelineSnapPanel } from '@/components/timeline-snap-panel'
import { TimelineTracks } from '@/components/timeline-tracks'
import {
  TimelineTransitionEditor,
  type AddTransitionInput,
} from '@/components/timeline-transition-editor'
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

  const [transitions, setTransitions] = useState(initialTransitions)
  const [clips, setClips] = useState(initialClips)
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [selectedClipId, setSelectedClipId] = useState<TimelineClipId | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

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
  const snapSpanForClip = (
    clipId: TimelineClipId | null,
    span: SnapSpanInput,
  ): SnapSpanOutcome =>
    snapSpan(span, buildSnapCandidates(snapSource, { clipId }), toleranceSec, snapEnabled)

  /** 失敗を握り潰すと「押したのに何も起きない」画面になる。必ず理由を出す。 */
  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await action()
      setStatus(`${label}しました`)
    } catch (error) {
      setActionError(`${label}できませんでした: ${describeError(error)}`)
      setStatus(null)
    } finally {
      setBusy(false)
    }
  }

  const addTransition = (input: AddTransitionInput): void => {
    void run('Transition を追加', async () => {
      const created = await api.createTransition(projectId, input)
      setTransitions((current) => (current === null ? [created] : [...current, created]))
    })
  }

  const removeTransition = (id: TransitionId): void => {
    void run('Transition を削除', async () => {
      await api.deleteTransition(id)
      setTransitions((current) =>
        current === null ? current : current.filter((transition) => transition.id !== id),
      )
    })
  }

  const addClip = (input: NewTextClipInput): void => {
    void run('TEXT クリップを追加', async () => {
      const created = await api.createClip(projectId, {
        track: 'TEXT',
        startSec: input.startSec,
        durationSec: input.durationSec,
        layer: input.layer,
        content: { type: 'text', templateKey: input.templateKey, params: {} },
      })
      setClips((current) => (current === null ? [created] : [...current, created]))
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
          transitions={transitions ?? []}
          renderedShotIds={new Set(renderedShotIds ?? [])}
          durationSec={durationSec}
          pxPerSec={pxPerSec}
          selectedClipId={selectedClipId}
          onSelectClip={setSelectedClipId}
        />
      )}

      {shots !== null && transitions !== null ? (
        <TimelineTransitionEditor
          shots={shots}
          transitions={transitions}
          busy={busy}
          onAdd={addTransition}
          onRemove={removeTransition}
        />
      ) : (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800"
        >
          Shot または Transition を読み込めていないため、Transition を編集できません。
        </p>
      )}

      <TimelineClipForm
        busy={busy}
        onAdd={addClip}
        onSnapSpan={(span) => snapSpanForClip(null, span)}
      />

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
  )
}
