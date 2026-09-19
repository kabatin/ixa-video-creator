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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TimelineClipList, type ClipPatch } from '@/components/timeline-clip-list'
import {
  TimelineInlineForm,
  inlineFormErrors,
  type InlineFormAnchor,
  type InlineFormDraft,
} from '@/components/timeline-inline-form'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import { TimelineSnapPanel } from '@/components/timeline-snap-panel'
import { ProgramMonitor } from '@/components/program-monitor'
import { TEXT_INSERT_LAYER, TimelineTracks } from '@/components/timeline-tracks'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WireTimelineBeatAlignment } from '@/lib/beat-alignment-view'
import { EditHistoryPanel } from '@/components/edit-history-panel'
import { RoughCutPanel } from '@/components/rough-cut-panel'
import { nextSeekCommand, type SeekCommand } from '@/lib/program-monitor'
import type { ShotPosterMap } from '@/lib/shot-posters'
import { createRequester } from '@/lib/requester'
import {
  createTimelineApi,
  type WireTimelineDocument,
  type WireTimelineIssue,
} from '@/lib/timeline-api'
import { resolveTimelineKey } from '@/lib/timeline-playhead'
import {
  DEFAULT_PX_PER_SEC,
  ZOOM_LEVELS,
  zoomLabel,
  formatClock,
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
  /** モニターの入力。null は読めていない（空のタイムラインとは別）。 */
  readonly initialDocument: WireTimelineDocument | null
  /**
   * ビート候補の出どころ。**「解析が無い」と「読めていない」を畳まずに渡す。**
   * どちらもビートには吸着しないが、利用者が取るべき行動が違う（lessons L-015）。
   */
  readonly beatSource: BeatSource
  /**
   * 拍とのズレ。**null は「読めていない」**（「ズレが無い」ではない）。
   * 判定・しきい値・「解析が無い」の扱いはすべてサーバ側の 1 箇所が持つ。
   */
  readonly beatAlignment: WireTimelineBeatAlignment | null
  /** 読み込みに失敗した部分の理由。1 件でもあれば画面に必ず出す。 */
  readonly loadErrors: readonly string[]
  /**
   * 外から渡す再生位置（PHASE 7.1 ワークベンチ）。**渡すと内部の再生状態と Space の受け付けを使わない。**
   * 再生位置はワークベンチの 1 箇所が持ち、プレビューと同じ値を見る（UI-WORKBENCH §7.2）。
   */
  readonly playback?: TimelinePlayback
  /** モニターを出すか。ワークベンチではプレビューのパネルに任せるので出さない。既定は出す。 */
  readonly showMonitor?: boolean
  /** 「拍に吸着」の初期値。環境設定の既定を渡す（UI-WORKBENCH §3.4）。 */
  readonly initialSnapEnabled?: boolean
  /**
   * 検査・粗編集・履歴・吸着を帯の下へ畳むか（PHASE 7.1 ワークベンチ）。
   * ワークベンチの中央下は高さが限られ、上に積むと帯が見えるところまで届かない。
   */
  readonly collapseAuxiliary?: boolean
  /** 帯に敷くサムネイル・選択中の Shot・選ぶ口（PHASE 7.2 ワークベンチ）。`TimelineTracks` へそのまま渡す。 */
  readonly posters?: ShotPosterMap
  readonly selectedShotId?: ShotId | null
  readonly onSelectShot?: (shotId: ShotId) => void
  /** 楽曲の波形の帯。`TimelineTracks` へそのまま渡す。 */
  readonly audioLane?: { readonly durationSec: number; readonly node: ReactNode }
}

export type TimelinePlayback = {
  readonly currentSec: number
  readonly playing: boolean
  readonly seek: SeekCommand | null
  /** 目盛りを押した。明示的に飛ぶ。 */
  readonly onSeek: (sec: number) => void
  readonly onFrame: (sec: number) => void
  readonly onPlayingChange: (playing: boolean) => void
}

export const TimelineEditor = ({
  projectId,
  shots,
  initialTransitions,
  initialClips,
  renderedShotIds,
  initialIssues,
  documentDurationSec,
  initialDocument,
  beatSource,
  beatAlignment,
  loadErrors,
  playback,
  showMonitor = true,
  initialSnapEnabled = true,
  collapseAuxiliary = false,
  posters,
  selectedShotId,
  onSelectShot,
  audioLane,
}: TimelineEditorProps) => {
  const api = useMemo(() => createTimelineApi(createRequester(resolveApiBaseUrl())), [])

  const router = useRouter()

  const [transitions, setTransitions] = useState(initialTransitions)
  const [clips, setClips] = useState(initialClips)
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC)
  const [snapEnabled, setSnapEnabled] = useState(initialSnapEnabled)
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

  /** 再生ヘッド（PHASE 6.0）。モニターと帯が同じ値を見る。 */
  const [ownCurrentSec, setOwnCurrentSec] = useState(0)
  const [ownPlaying, setOwnPlaying] = useState(false)
  /** 目盛りを押した、という明示的な指示。モニターはこれが変わったときだけ飛ぶ（`program-monitor.ts`）。 */
  const [ownSeek, setOwnSeek] = useState<SeekCommand | null>(null)
  const document = initialDocument

  /** 外から渡されていればそちらが正。内部の状態は使わない。 */
  const currentSec = playback?.currentSec ?? ownCurrentSec
  const playing = playback?.playing ?? ownPlaying
  const seek = playback === undefined ? ownSeek : playback.seek
  const setCurrentSec = playback?.onFrame ?? setOwnCurrentSec
  const setPlaying = playback?.onPlayingChange ?? setOwnPlaying
  const seekTo = (sec: number): void => {
    if (playback !== undefined) {
      playback.onSeek(sec)
      return
    }
    setOwnCurrentSec(sec)
    setOwnSeek((previous) => nextSeekCommand(previous, sec))
  }
  const controlled = playback !== undefined

  /** Space で再生/停止。入力欄の中の打鍵は横取りしない（`timeline-playhead`）。 */
  useEffect(() => {
    // ワークベンチでは Space をワークベンチの 1 箇所が受ける。二重に反応させない。
    if (controlled) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? { tagName: event.target.tagName } : null
      const command = resolveTimelineKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        target,
      })
      if (command === null) return
      event.preventDefault()
      setOwnPlaying((current) => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [controlled])

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

  /** 検査・粗編集・履歴・吸着。帯の操作の周りの道具。 */
  const auxiliary = (
    <>
      <TimelineIssuePanel issues={issues} projectId={projectId} />

      {/**
       * 粗編集の提案（PHASE 6.3）。**指摘の真下に置く。**
       * 「重なり 72 件」を見た人が次に取る行動がこれなので、探させない。
       * 押すまで何も変わらない作りは部品側が持つ。
       */}
      <RoughCutPanel
        projectId={projectId}
        shotCodes={new Map((shots ?? []).map((shot) => [shot.id, shot.code]))}
        onApplied={() => {
          router.refresh()
        }}
      />

      {/**
       * 一括で変えたものを戻す（横断 ROADMAP）。**押した場所の隣に置く。**
       * 49 件を当てた直後に「戻したい」と思うので、別の画面へ探しに行かせない。
       */}
      <EditHistoryPanel
        projectId={projectId}
        shotCodes={new Map((shots ?? []).map((shot) => [shot.id, shot.code]))}
        onUndone={() => {
          router.refresh()
        }}
      />

      <TimelineSnapPanel
        enabled={snapEnabled}
        onToggle={setSnapEnabled}
        beatSource={beatSource}
        toleranceSec={toleranceSec}
        candidates={overviewCandidates}
      />
    </>
  )

  return (
    <div className="space-y-6">
      {loadErrors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-danger/40 bg-danger/10 p-4">
          {loadErrors.map((message) => (
            <li key={message} className="text-sm text-danger">
              {message}
            </li>
          ))}
        </ul>
      )}

      {!collapseAuxiliary && auxiliary}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-text">{`全体の尺 ${formatDuration(durationSec)}`}</span>
        <span className="text-sm text-muted">ズーム</span>
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
                ? 'bg-accent text-accent-fg ring-accent'
                : 'bg-surface text-text ring-line-strong hover:bg-surface-2'
            }`}
          >
            {zoomLabel(level)}
          </button>
        ))}
      </div>

      {actionError !== null && (
        <p role="alert" className="rounded-md bg-danger/10 p-3 text-sm text-danger">
          {actionError}
        </p>
      )}
      {status !== null && actionError === null && (
        <p role="status" className="rounded-md bg-surface-2 p-3 text-sm text-text">
          {status}
        </p>
      )}

      {/**
       * プログラムモニター（PHASE 6.0）。**書き出しと同じ TimelineDocument を同じコンポジションで**
       * 再生する。プレビューでは合っていたのに書き出すとズレる、を構造的に防ぐ。
       * 再生位置は帯の再生ヘッドと同じ state を見る。
       */}
      {showMonitor && (
        <div className="mx-auto w-full max-w-4xl">
          <ProgramMonitor
            document={document}
            currentSec={currentSec}
            seek={seek}
            playing={playing}
            onFrame={setCurrentSec}
            onPlayingChange={setPlaying}
            onError={(message) => {
              setActionError(`モニター: ${message}`)
            }}
          />
        </div>
      )}

      {document !== null && (
        <p role="status" className="text-sm text-muted">
          {`${playing ? '再生中' : '停止中'} ${formatClock(currentSec)}（Space で再生 / 一時停止、目盛りを押すとその位置へ）`}
        </p>
      )}

      {shots === null ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger"
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
          playheadSec={document === null ? null : currentSec}
          {...(posters === undefined ? {} : { posters })}
          selectedShotId={selectedShotId ?? null}
          {...(onSelectShot === undefined ? {} : { onSelectShot })}
          {...(audioLane === undefined ? {} : { audioLane })}
          beatAlignment={
            beatAlignment === null
              ? undefined
              : // wire の 1 件は `ShotBeatAlignmentView` と同じ形。名前だけ揃える。
                {
                  source: beatAlignment.source,
                  trackTitle: beatAlignment.trackTitle,
                  views: beatAlignment.shots,
                }
          }
          onSeek={seekTo}
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
        <ul role="status" className="space-y-1 rounded-md bg-surface-2 p-3 text-sm text-text">
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
      <details className="rounded-lg border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-text">
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

      {collapseAuxiliary && (
        <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm font-semibold text-text">
            検査・粗編集・変更の履歴・ビート吸着
          </summary>
          <div className="mt-3 space-y-4">{auxiliary}</div>
        </details>
      )}
    </div>
  )
}
