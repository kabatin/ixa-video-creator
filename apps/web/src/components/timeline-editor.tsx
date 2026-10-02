'use client'

import { useRouter } from 'next/navigation'

import type {
  ProjectId,
  Shot,
  ShotId,
  TimelineClip,
  TimelineClipId,
  Transition,
  TransitionId,
} from '@ixa/domain'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TimelineClipList, type ClipPatch } from '@/components/timeline-clip-list'
import { TimelineInlineForm, inlineFormErrors } from '@/components/timeline-inline-form'
import { TimelineIssuePanel } from '@/components/timeline-issue-panel'
import { TimelineSnapPanel } from '@/components/timeline-snap-panel'
import { ProgramMonitor, type ProgramMonitorProps } from '@/components/program-monitor'
import { TimelineTracks } from '@/components/timeline-tracks'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WireTimelineBeatAlignment } from '@/lib/beat-alignment-view'
import { EditHistoryPanel } from '@/components/edit-history-panel'
import { RoughCutPanel } from '@/components/rough-cut-panel'
import { PlayheadSecContext, usePlayheadSec } from '@/lib/playhead-sec'
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
  programEndSec,
  type TimeSpan,
} from '@/lib/timeline-display'
import {
  candidatesForClipDrag,
  MIN_CLIP_DURATION_SEC,
  type ClipDragContext,
  type ClipDragOutcome,
} from '@/lib/timeline-drag'
import { adjacentIds, edgeNeighbors, previewSpans, shrinkFirst } from '@/lib/timeline-rolling'
import { INSERTABLE_TRANSITION_TYPES } from '@/lib/timeline-insert'
import { openFormCaption } from '@/lib/timeline-open-form'
import {
  buildSnapCandidates,
  snapPoint,
  snapSpan,
  snapToleranceSec,
  type BeatSource,
  type SnapSpanInput,
  type SnapSpanOutcome,
} from '@/lib/timeline-snap'
import type { ContextMenuTriggerProps, MenuPoint } from '@/components/workbench/use-context-menu'
import { useTimelineInlineForms } from '@/components/use-timeline-inline-forms'

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

/** 動かしていないときの仮の位置（空）。描くたびに作り直さない。 */
const NO_PREVIEW: ReadonlyMap<string, TimeSpan> = new Map()

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
  /** 歌詞の歌い出し。テロップなどを歌い出しに寄せる（制作者 2026-10-02）。省略なら寄せない。 */
  readonly lyricCues?: readonly number[]
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
  /**
   * 再生位置が動いているか（どのパネルが鳴らしていても）。「再生位置を追う」が、動いている間は真ん中に保つのに使う。
   * 省略なら、このタイムラインが鳴らしているか（`playback.playing`）で見る。
   */
  readonly playheadMoving?: boolean
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
  /** Shot の右クリックのメニューを開く口（帯の上の Shot）。 */
  readonly shotContextMenu?: (shot: Shot) => ContextMenuTriggerProps
  /** 帯のテロップの右クリック（長押し）でメニューを開く口。テロップ以外のクリップはブラウザのメニューのまま。 */
  readonly onTextClipContextMenu?: (id: TimelineClipId, at: MenuPoint, origin: HTMLElement) => void
  /**
   * 帯のテロップを押したとき・置いたときに、インスペクターで開く（ワークベンチ）。
   * **渡すと帯の上の小窓では直さない。** 小窓はパネルの端で見切れて編集しづらかった
   * （2026-09-28、制作者の指摘）。渡さなければ今までどおり小窓で直す（単独のタイムライン）。
   */
  readonly onOpenTextClip?: (clipId: TimelineClipId) => void
  /** 楽曲の波形の帯。`TimelineTracks` へそのまま渡す。 */
  readonly audioLane?: { readonly durationSec: number; readonly node: ReactNode }
}

/**
 * 外から渡す再生の状態。**位置は入れない。** 位置は毎コマ変わるので、props で受けると
 * 編集画面の全体が毎コマ描き直される。位置は外の持ち主が `PlayheadSecContext` で配り、
 * 再生ヘッドと時刻の表示だけが読む（`@/lib/playhead-sec`）。
 */
export type TimelinePlayback = {
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
  lyricCues,
  beatAlignment,
  loadErrors,
  playback,
  showMonitor = true,
  playheadMoving,
  initialSnapEnabled = true,
  collapseAuxiliary = false,
  posters,
  selectedShotId,
  onSelectShot,
  shotContextMenu,
  onTextClipContextMenu,
  onOpenTextClip,
  audioLane,
}: TimelineEditorProps) => {
  const api = useMemo(() => createTimelineApi(createRequester(resolveApiBaseUrl())), [])

  const router = useRouter()

  const [transitions, setTransitions] = useState(initialTransitions)
  const [clips, setClips] = useState(initialClips)
  /**
   * 読み直した一覧が届いたら差し替える。インスペクターで直した文字・時間・削除が、
   * 手元の古い一覧のまま帯に残らないように。最初の描画は初期値そのものなので数えない。
   */
  const lastInitialClips = useRef(initialClips)
  useEffect(() => {
    if (lastInitialClips.current === initialClips) return
    lastInitialClips.current = initialClips
    setClips(initialClips)
  }, [initialClips])
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC)
  /**
   * 再生位置を追う（制作者 2026-10-02「タイムラインも現在位置に合わせて追従するようにしたい。他画面に合わせチェックで追従ON/OFF」）。
   * 聴きながら切ると同じく既定で入れ、自分で横に送ったら切る。
   */
  const [followPlayhead, setFollowPlayhead] = useState(true)
  const stopFollowing = useCallback(() => {
    setFollowPlayhead(false)
  }, [])
  const [snapEnabled, setSnapEnabled] = useState(initialSnapEnabled)
  const [selectedClipId, setSelectedClipId] = useState<TimelineClipId | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  /** 掴んでいる最中の見た目（掴んだものと、付いてきた隣）。確定するまで本体は書き換えない。 */
  const [preview, setPreview] = useState<ReadonlyMap<string, TimeSpan>>(NO_PREVIEW)
  /** 掴んで止まった理由・吸着した先。**黙って丸めない。** */
  const [dragNotes, setDragNotes] = useState<readonly string[]>([])

  /** 再生ヘッド（PHASE 6.0）。モニターと帯が同じ値を見る。 */
  const [ownCurrentSec, setOwnCurrentSec] = useState(0)
  const [ownPlaying, setOwnPlaying] = useState(false)
  /** 目盛りを押した、という明示的な指示。モニターはこれが変わったときだけ飛ぶ（`program-monitor.ts`）。 */
  const [ownSeek, setOwnSeek] = useState<SeekCommand | null>(null)
  const document = initialDocument

  /** 外から渡されていればそちらが正。内部の状態は使わない。位置は外の `PlayheadSecContext` が正。 */
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
      ...(lyricCues === undefined ? {} : { lyricCues }),
    }),
    [shots, clips, beatSource, durationSec, lyricCues],
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

  // --- 帯の上の入力（`use-timeline-inline-forms.ts`） ---

  const forms = useTimelineInlineForms({
    api,
    projectId,
    shots,
    transitions,
    clips,
    setTransitions,
    setClips,
    durationSec,
    run,
    setActionError,
    onOpenTextClip,
    snapInsertAt: (atSec) =>
      snapPoint('開始', atSec, overviewCandidates, toleranceSec, snapEnabled).atSec,
  })
  const {
    open,
    draft,
    formIssues,
    openerRef,
    points,
    closeForm,
    openTransition,
    openTextInsert,
    openClip,
    submitTransition,
    submitTextClip,
  } = forms

  // --- 掴んで動かす ---

  const beginDrag = (clip: TimelineClip): ClipDragContext => {
    setDragNotes([])
    // 端を動かすと、同じ帯・同じ段で接している隣の端が付いてくる（制作者 2026-10-02「テロップも同じですね」）。
    const lane = (clips ?? []).filter((each) => each.track === clip.track && each.layer === clip.layer)
    const neighbors = edgeNeighbors(
      lane.map((each) => ({ id: each.id, span: each })),
      { id: clip.id, span: clip },
    )
    const touching = new Set(adjacentIds(neighbors))
    return {
      // **当人と、付いてくる隣を候補から外す。** 外し忘れると、その端（距離 0）に吸着して動かせない。
      candidates: candidatesForClipDrag(
        { ...snapSource, clips: snapSource.clips.filter((each) => !touching.has(each.id)) },
        clip.id,
      ),
      toleranceSec,
      snapEnabled,
      timelineEndSec: durationSec,
      neighbors,
      minNeighborSec: MIN_CLIP_DURATION_SEC,
      neighborNoun: clip.content.type === 'text' ? 'テロップ' : 'クリップ',
    }
  }

  const dragMove = (clip: TimelineClip, outcome: ClipDragOutcome): void => {
    setPreview(previewSpans(clip.id, outcome))
  }

  const dragEnd = (clip: TimelineClip, outcome: ClipDragOutcome): void => {
    setPreview(NO_PREVIEW)
    setDragNotes([
      ...outcome.limits.map((limit) => limit.message),
      ...outcome.snapNotices.filter((n) => n.state === 'snapped').map((n) => n.message),
    ])
    if (!outcome.moved) return
    const { neighbor } = outcome
    const neighborClip = neighbor === null ? undefined : (clips ?? []).find((each) => each.id === neighbor.id)
    const writes = shrinkFirst([
      { id: clip.id, from: clip, to: outcome.span },
      ...(neighbor === null || neighborClip === undefined
        ? []
        : [{ id: neighborClip.id, from: neighborClip, to: neighbor.span }]),
    ])
    void run(writes.length > 1 ? 'クリップの境目を更新' : 'クリップの位置と尺を更新', async () => {
      // 1 件ずつ順に書く（縮む側が先。同時に送ると順が保てない）。
      for (const write of writes) {
        const updated = await api.updateClip(write.id, {
          startSec: write.to.startSec,
          durationSec: write.to.durationSec,
        })
        setClips((current) =>
          current === null ? current : current.map((each) => (each.id === updated.id ? updated : each)),
        )
      }
    })
  }

  /** カットの端をつまんだ。自分と付いてくる隣の端を除いた吸着の候補（テロップと同じ規則）。 */
  const beginShotDrag = (excludeShotIds: ReadonlySet<string>): ClipDragContext => {
    setDragNotes([])
    return {
      candidates: buildSnapCandidates(
        { ...snapSource, shots: snapSource.shots.filter((shot) => !excludeShotIds.has(shot.id)) },
        { clipId: null },
      ),
      toleranceSec,
      snapEnabled,
      timelineEndSec: durationSec,
    }
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

  const body = (
    // 行の間は詰める。帯（本体）をできるだけ上に出す（制作者 2026-10-02）。
    <div className="space-y-3">
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

      {/*
        再生の状態と位置はズームの行に寄せる（制作者 2026-10-02「停止中と時間の表示が縦幅を占有してしまう」）。
        全体の尺は帯の左上（「尺 …」）にあるので出さない（同「冗長のため削除」）。
      */}
      <div className="flex flex-wrap items-center gap-3">
        {document !== null && (
          <span role="status" className="min-w-32 text-sm tabular-nums text-muted">
            {/*
              Space の説明を常設しない。キーの持ち主はフォーカスの場所で決まるようになり
              （`resolveKeyOwner`）、「Space で再生」と無条件に書くと嘘になる。
              割り当ては ヘルプ > キーボードショートカット が持つ。
            */}
            <PlaybackClock playing={playing} />
          </span>
        )}
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
        <label
          className="ml-auto flex items-center gap-1 text-sm text-text"
          title="鳴っている間は帯が流れ、止めている間は再生位置が画面から出たときだけ追いかけます"
        >
          <input
            type="checkbox"
            checked={followPlayhead}
            onChange={(event) => {
              setFollowPlayhead(event.target.checked)
            }}
            className="h-3.5 w-3.5"
          />
          再生位置を追う
        </label>
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
          <MonitorAtPlayhead
            document={document}
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
          clipPreviews={preview}
          onSelectClip={setSelectedClipId}
          onOpenTransition={openTransition}
          onOpenClip={openClip}
          onInsertText={openTextInsert}
          onClipDragBegin={beginDrag}
          onClipDragMove={dragMove}
          onClipDragEnd={dragEnd}
          shotEdges={{
            projectId,
            busy,
            begin: beginShotDrag,
            notify: setDragNotes,
            onApplied: () => {
              router.refresh()
            },
          }}
          showPlayhead={document !== null}
          follow={{ enabled: followPlayhead, moving: playheadMoving ?? playing, onUserScroll: stopFollowing }}
          {...(posters === undefined ? {} : { posters })}
          selectedShotId={selectedShotId ?? null}
          {...(onSelectShot === undefined ? {} : { onSelectShot })}
          {...(shotContextMenu === undefined ? {} : { shotContextMenu })}
          {...(onTextClipContextMenu === undefined
            ? {}
            : {
                onClipContextMenu: (clip: TimelineClip, at: MenuPoint, origin: HTMLElement) => {
                  if (clip.content.type !== 'text') return false
                  onTextClipContextMenu(clip.id, at, origin)
                  return true
                },
              })}
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

  // 外から位置を受けないときは、自分の位置を配る。受けるときは外の持ち主が配っている。
  return controlled ? body : <PlayheadSecContext.Provider value={ownCurrentSec}>{body}</PlayheadSecContext.Provider>
}

/** 位置を毎コマ読むのはこの末端だけ（`@/lib/playhead-sec`）。 */
const MonitorAtPlayhead = (props: Omit<ProgramMonitorProps, 'currentSec'>) => (
  <ProgramMonitor {...props} currentSec={usePlayheadSec()} />
)

const PlaybackClock = ({ playing }: { readonly playing: boolean }) => (
  <>{`${playing ? '再生中' : '停止中'} ${formatClock(usePlayheadSec())}`}</>
)

