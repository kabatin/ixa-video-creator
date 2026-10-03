'use client'

import type { MusicTrack, ProjectId } from '@ixa/domain'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { AudioTransport } from '@/components/audio-transport'
import { CutMarkList } from '@/components/cut-mark-list'
import { CutWaveformOverlay } from '@/components/cut-waveform-overlay'
import { LyricCueOverlay } from '@/components/lyric-cue-overlay'
import { Button } from '@/components/ui/button'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { HelpDisclosure } from '@/components/ui/help-disclosure'
import { describeCutEditorKeys } from '@/lib/cut-editor-keys'
import { centerView, isTimeInView, panView, zoomView } from '@/lib/cut-editor-pointer'
import {
  addMark,
  buildCutMarkCandidates,
  cutMarkToleranceSec,
  addLyricMarks,
  addSectionMarks,
  describeLyricMarks,
  describeSectionMarks,
  describeCuts,
  moveMark,
  nextMarkIndex,
  nudgeMarkAt,
  previousMarkIndex,
  removeMarkAt,
  snapMarkTime,
  type CutMark,
  type MarkChangeResult,
  type MarkRejection,
} from '@/lib/cut-marks'
import { formatClock } from '@/lib/format-time'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { AUDIO_URL_EXPIRES_IN_SEC, type SignedSource } from '@/lib/playback-state'
import { snapNoticeClassName, type BeatSource, type SnapNotice } from '@/lib/timeline-snap'
import { useAudioPlayback } from '@/lib/use-audio-playback'
import { useCutEditorSync, type TransportSyncPort } from '@/lib/use-cut-editor-sync'
import { useElementWidth } from '@/lib/use-element-width'
import { fetchWaveformPeaks, type WaveformPeaksResult } from '@/lib/waveform-api'
import { fullView, pixelsPerSecond, sectionBoundaries, type ViewRange } from '@/lib/waveform-draw'
import { useOptionalContextMenuHost } from '@/components/workbench/ui/context-menu'
import type { MenuPoint } from '@/components/workbench/use-context-menu'
import { toMenuItems } from '@/components/workbench/use-shot-menu'
import { cutMarkMenuEntries } from '@/lib/context-menus'
import { useCutEditorKeyboard } from '@/components/use-cut-editor-keyboard'
import { useCutSave } from '@/components/use-cut-save'
import { useWaveformFillHeight } from '@/components/use-waveform-fill-height'

/**
 * 音を鳴らしながら、波形の上で「ここからここまでが 1 カット」を決める画面（P56）。
 *
 * セクションを選んでカット数を入れる形は、音を聴かずに数字で決めさせていて
 * 絵コンテを作る操作になっていなかった。制作者の判断で作り直している。
 *
 * **自動のセクション分割は消していない。** 精度は低い（実データは 15 個すべて `verse` 判定）
 * が、波形の上に薄い目印として出すぶんには手がかりになる。一方**ビート検出は正確**
 * （拍間隔の標準偏差 0.019 秒）なので、吸着はビートを主役にしている。
 *
 * 区切りは N 個で N-1 カット。隣り合う 2 個がそのままカットの端になるので、
 * **隙間も重なりも構造的に作れない。**
 *
 * 波形の高さは `waveform-bands.ts` の既定（80px。PHASE 8.1 で 160px から半分に）。
 */

/** 歌詞の時刻が無いのに「歌い出しに区切りを置く」を押したとき。 */
const NEED_LYRICS_MESSAGE =
  '歌詞の時刻がまだありません。先に「歌詞を合わせる」で歌い出しに Enter を押して時刻を付けると、全部の歌い出しに区切りを置けます。'

/** 自分でフォーカスを受ける物。ここを押したときは入れ物が横取りしない。 */
const FOCUSABLE_SELECTOR =
  'a[href], button, input, select, textarea, [contenteditable="true"], [role="button"]'

export type CutEditorProps = {
  readonly projectId: ProjectId
  readonly track: MusicTrack
  readonly analysis: WireMusicAnalysis
  /** 「拍に吸着」の初期値。環境設定の既定を渡す（UI-WORKBENCH §3.4）。 */
  readonly initialSnapEnabled?: boolean
  /**
   * 打鍵を聞き取るか（PHASE 7.2 ワークベンチ）。
   *
   * **「取るかどうか」はここでは決まらない。** 実際に受けるのは
   * **フォーカスがこの画面の入れ物の中にあるとき**だけで、判定は `resolveKeyOwner`
   * がワークベンチ側と共通で持つ。ここは「そもそも聞き耳を立てるか」だけ
   * （裏のタブやダイアログを開いている間は立てない。lessons L-018）。
   */
  readonly keyboardShortcuts?: boolean
  /**
   * フォーカスが外にあっても Enter / S で区切りを置くか（制作者 2026-10-03「テロップのように Enter とかで置けるようにしたい」）。
   * ワークベンチでは区切るモードが見えている間だけ true（`keyboardShortcuts` と同じ条件）。
   */
  readonly placeKeyAnywhere?: boolean
  /** 歌詞の時刻が無いのに「歌い出しに区切りを置く」を押したとき、歌詞を合わせるへ行く口。 */
  readonly onNeedLyrics?: () => void
  /** ワークベンチの再生位置と繋ぐ口（PHASE 7.2）。渡さなければ単独で動く。 */
  readonly sync?: CutEditorSync
  /**
   * 再生ボタンをこの画面に出すか。既定は出す。
   * ワークベンチでは**見えているプレイヤーの直下にひとつだけ**なので、
   * プレビューが開いているときは false（`transport-bar.tsx`）。
   */
  readonly showPlay?: boolean
  /** 再生ボタンの差し替え（`audio-transport.tsx` の `playButton`）。 */
  readonly playButton?: ReactNode
  /** 操作の行に足すもの（「セクションから割る…」など。PHASE 8.4）。 */
  readonly toolbarExtra?: ReactNode
  /**
   * 何のために聴くか。`lyrics`（歌詞を合わせる）では再生と波形だけを出し、区切りの道具は出さない
   * （制作者 2026-10-02「この画面すっごいわかりづらいなー」。歌詞のときも区切りの画面が丸ごと付いてきた）。
   */
  readonly purpose?: 'cut' | 'lyrics'
  /** 歌詞の歌い出しの時刻。`lyrics` のとき波形に印を出す（見るだけ）。 */
  readonly lyricCues?: readonly number[]
}

/** 再生位置の共有（UI-WORKBENCH §7.2）。形と規則は `use-cut-editor-sync.ts`。 */
export type CutEditorSync = TransportSyncPort

/** 歌詞の時刻が無いとき。描くたびに新しい配列を作ると、吸着の候補が毎回作り直される。 */
const NO_LYRIC_CUES: readonly number[] = []

export const CutEditor = ({
  projectId,
  track,
  analysis,
  initialSnapEnabled = true,
  keyboardShortcuts = true,
  placeKeyAnywhere = false,
  onNeedLyrics,
  sync,
  showPlay = true,
  playButton,
  toolbarExtra,
  purpose = 'cut',
  lyricCues = NO_LYRIC_CUES,
}: CutEditorProps) => {
  const cutting = purpose === 'cut'

  /**
   * キーの持ち主を決める入れ物。
   *
   * **波形は `<canvas>` でフォーカスを受けない。** 目印（`data-cut-editor`）と
   * `tabIndex={-1}` を入れ物に付け、中で `pointerdown` が起きたらここへフォーカスを移す。
   * これが無いと、波形をクリックしても持ち主が変わらない。
   */
  const containerRef = useRef<HTMLDivElement>(null)

  const [marks, setMarks] = useState<readonly CutMark[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [rejection, setRejection] = useState<MarkRejection | null>(null)
  const [snapNotice, setSnapNotice] = useState<SnapNotice | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(initialSnapEnabled)

  const [view, setView] = useState<ViewRange>(() => fullView(analysis.durationSec))
  /**
   * 再生位置を窓の中央に置いて、曲のほうを流す。
   *
   * 寄って見ているとき、再生に合わせて自分で窓を送るのは現実的ではない。
   * 鳴っている間は毎フレーム中央へ寄せる。**止めている間は、再生位置が
   * 窓から出たときだけ連れ戻す。** 止めている間も寄せ続けると、自分で送った窓が
   * すぐ引き戻されて動かせない。かといって何もしないと、シークした先が窓の外のまま
   * 再生位置がどこにも見えなくなる。
   */
  const [followPlayhead, setFollowPlayhead] = useState(true)
  /** 区切りを掴んでいる間。掴んだ場所が指の下から逃げないよう、追従を止める。 */
  const [dragging, setDragging] = useState(false)
  const [peaks, setPeaks] = useState<WaveformPeaksResult | null>(null)

  /** 波形の高さ（パネルの余りをもらう）と幅。幅は大きさが変わったときだけ測る。 */
  const { waveBoxRef, waveHeightPx } = useWaveformFillHeight()
  const widthPx = useElementWidth(waveBoxRef)

  // Shot にしたら区切りを空にする（下書きは保存されたので。残すと 2 回押して Shot が重なる）。
  const cutSave = useCutSave(projectId, () => {
    setMarks([])
    setSelectedIndex(-1)
  })
  const saving = cutSave.saving

  // --- 材料 ---

  /**
   * 音源の署名付き URL。**期限を明示して取る。**
   * API の既定は 5 分で、切る作業はそれより確実に長い。
   */
  const loadSource = useCallback(
    async (): Promise<SignedSource> =>
      createApiClient().mediaUrl(track.mediaAssetId, AUDIO_URL_EXPIRES_IN_SEC),
    [track.mediaAssetId],
  )

  const [source, setSource] = useState<SignedSource | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadSource()
      .then((next) => {
        if (!cancelled) setSource(next)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setSourceError(describeError(caught))
      })
    return () => {
      cancelled = true
    }
  }, [loadSource])

  useEffect(() => {
    const controller = new AbortController()
    void fetchWaveformPeaks(analysis.waveformPeaksUrl, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setPeaks(result)
      },
    )
    return () => {
      controller.abort()
    }
  }, [analysis.waveformPeaksUrl])

  // 利用者の操作で飛んだ位置は共有の位置へも伝える（`useCutEditorSync`）。
  const playback = useCutEditorSync(useAudioPlayback({ source, onRefreshSource: loadSource }), sync)

  /** 尺はメタデータが読めるまで 0 なので、解析側の値を控えに使う。 */
  const durationSec = playback.durationSec > 0 ? playback.durationSec : analysis.durationSec

  // --- 吸着 ---

  const beatSource: BeatSource = useMemo(
    () =>
      analysis.beats.length === 0
        ? { state: 'no_beats', trackTitle: track.title }
        : {
            state: 'available',
            trackTitle: track.title,
            beats: analysis.beats,
            sections: analysis.sections,
            drops: analysis.drops,
          },
    [analysis.beats, analysis.sections, analysis.drops, track.title],
  )

  // 歌い出しにも寄せる（制作者 2026-10-02。歌詞の時刻を区切る前に付けておけば、区切りが歌い出しに揃う）。
  const candidates = useMemo(
    () => buildCutMarkCandidates(beatSource, durationSec, lyricCues),
    [beatSource, durationSec, lyricCues],
  )

  /** 許容距離は画面上の距離で一定にする。寄るほど秒では厳しくなる。 */
  const toleranceSec = cutMarkToleranceSec(
    widthPx > 0 ? pixelsPerSecond(view, widthPx) : pixelsPerSecond(fullView(durationSec), 1000),
  )

  // --- 区切りの操作 ---

  /** 断られたか通ったかを 1 箇所で畳む。断られた理由は必ず画面に出す。 */
  const applyChange = (result: MarkChangeResult): boolean => {
    if (!result.ok) {
      setRejection(result)
      return false
    }
    setMarks(result.marks)
    setSelectedIndex(result.index)
    setRejection(null)
    cutSave.clearOutcome()
    return true
  }

  const placeMarkAt = (atSec: number): void => {
    const snapped = snapMarkTime(atSec, candidates, toleranceSec, snapEnabled)
    setSnapNotice(snapped.notice)
    applyChange(addMark(marks, snapped.mark))
  }

  const moveMarkTo = (index: number, atSec: number, snap: boolean): void => {
    const snapped = snapMarkTime(atSec, candidates, toleranceSec, snap && snapEnabled)
    setSnapNotice(snapped.notice)
    applyChange(moveMark(marks, index, snapped.mark))
  }

  // 区切りの右クリック（長押し）のメニュー（2026-09-30）。ワークベンチの外で単独に描くときは出さない。
  const menuHost = useOptionalContextMenuHost()
  const openMarkMenu =
    menuHost === null
      ? undefined
      : (index: number, at: MenuPoint, origin: HTMLElement): void => {
          setSelectedIndex(index)
          menuHost.open({
            label: `区切り ${String(index + 1)} の操作`,
            items: toMenuItems(cutMarkMenuEntries(), {
              remove: () => {
                removeAt(index)
              },
            }),
            at,
            origin,
          })
        }

  const removeAt = (index: number): void => {
    applyChange(removeMarkAt(marks, index))
  }

  /**
   * 区切りを選ぶと、そこへ聴く位置も動かす。
   *
   * **矢印キーは再生側の割り当てと重なっていて、区切り側が取っている**
   * （`cut-editor-keys`）。移動手段として失われないよう、選ぶ操作に再生位置を連れて行かせる。
   */
  const selectAndSeek = (index: number): void => {
    const mark = marks[index]
    if (mark === undefined) return
    setSelectedIndex(index)
    setRejection(null)
    playback.seekTo(mark.atSec)
  }

  // --- 再生位置への追従 ---

  /**
   * **`view` を依存に入れないこと。** 入れると、窓を動かす→再実行→また動かす、で回り続ける。
   * 引き金は再生位置の変化だけでよく、いまの窓は `setView` の引数として受け取る。
   */
  useEffect(() => {
    if (!followPlayhead || dragging) return
    setView((current) =>
      // 止めている間は、見えているうちは触らない。窓を自分で送った直後に
      // 引き戻されないようにするため。外へ出たときだけ連れ戻す。
      !playback.isPlaying && isTimeInView(playback.currentSec, current, durationSec)
        ? current
        : centerView(current, playback.currentSec, durationSec),
    )
  }, [followPlayhead, playback.isPlaying, playback.currentSec, dragging, durationSec])

  /** 自分で窓を送ったら追従は切る。切らないと、送った先から即座に引き戻される。 */
  const panBy = (ratio: number): void => {
    setFollowPlayhead(false)
    setView((current) => panView(current, (current.endSec - current.startSec) * ratio, durationSec))
  }

  // --- キーボード（行き先は `use-cut-editor-keyboard`）---

  useCutEditorKeyboard({
    enabled: keyboardShortcuts,
    placeAnywhere: placeKeyAnywhere,
    containerRef,
    handlers: {
      placeMark: () => {
        placeMarkAt(playback.currentSec)
      },
      removePreviousMark: () => {
        const index = previousMarkIndex(marks, playback.currentSec)
        if (index < 0) {
          setRejection({ reason: 'missing', message: '再生位置より前に区切りがありません。' })
          return
        }
        removeAt(index)
      },
      removeSelectedMark: () => {
        removeAt(selectedIndex)
      },
      selectPreviousMark: () => {
        selectAndSeek(previousMarkIndex(marks, playback.currentSec))
      },
      selectNextMark: () => {
        selectAndSeek(nextMarkIndex(marks, playback.currentSec))
      },
      nudgeSelectedMark: (deltaSec) => {
        applyChange(nudgeMarkAt(marks, selectedIndex, deltaSec))
      },
      toggleSnap: () => {
        setSnapEnabled((current) => !current)
        setSnapNotice(null)
      },
      togglePlay: playback.toggle,
      nudgePlayhead: playback.nudge,
      seekEdge: (edge) => {
        playback.seekTo(edge === 'start' ? 0 : durationSec)
      },
    },
  })

  // --- 保存 ---

  const cuts = describeCuts(marks, durationSec)

  /**
   * 中を押したら入れ物がフォーカスを受け取る。
   *
   * **自分でフォーカスを受ける物の上では譲る。** ボタンや入力欄まで奪うと、
   * Tab で移れるのに押した瞬間にフォーカスが外れ、Enter が別の意味になる。
   */
  const grabFocus = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof HTMLElement)) return
    if (event.target.closest(FOCUSABLE_SELECTOR) !== null) return
    containerRef.current?.focus({ preventScroll: true })
  }

  const keyHelp = describeCutEditorKeys()
  const sectionBoundarySec = sectionBoundaries(analysis.sections)

  /**
   * 青い線（セクションの境目）すべてに区切りを置く（制作者の要望 2026-09-26）。
   * 1 本ずつ置いていた操作をまとめるだけ。置いたあとは普通の区切りなので消せる。
   */
  const placeSectionMarks = (): void => {
    const result = addSectionMarks(marks, sectionBoundarySec, durationSec)
    setMarks(result.marks)
    setRejection(null)
    cutSave.clearOutcome()
    setSnapNotice({ state: 'none', label: '区切り', message: describeSectionMarks(result) })
  }

  /**
   * 歌い出しすべてに区切りを置く（制作者 2026-10-02）。置いたあとは普通の区切りなので消せる。
   * 歌詞の時刻がまだ無ければ、先に歌詞を合わせるよう確かめる（制作者 2026-10-03「手順を飛び越えて…警告ダイアログ」）。
   */
  const placeLyricMarks = (): void => {
    if (lyricCues.length === 0) {
      if (menuHost !== null && onNeedLyrics !== undefined) {
        menuHost.perform({
          kind: 'item',
          id: 'need-lyrics',
          label: '歌い出しに区切りを置く',
          disabledReason: null,
          confirm: NEED_LYRICS_MESSAGE,
          confirmTone: 'primary',
          confirmLabel: '歌詞を合わせる',
          run: onNeedLyrics,
        })
      } else {
        setSnapNotice({ state: 'none', label: '区切り', message: NEED_LYRICS_MESSAGE })
      }
      return
    }
    const result = addLyricMarks(marks, lyricCues, durationSec)
    setMarks(result.marks)
    setRejection(null)
    cutSave.clearOutcome()
    setSnapNotice({ state: 'none', label: '区切り', message: describeLyricMarks(result) })
  }

  /** 仕上げのボタンの言葉。区切りが揃えば件数を言う。 */
  const saveLabel = saving
    ? '作成中…'
    : cuts.state === 'cuts'
      ? `${String(cuts.cuts.length)} カットを Shot にする`
      : 'Shot にする'

  return (
    <div
      ref={containerRef}
      // ワークベンチ側はこの目印を `closest` で探す。名前の正は `CUT_EDITOR_ATTRIBUTE`
      // で、食い違えば `cut-editor-focus.test.tsx` がこの要素を見つけられず落ちる。
      data-cut-editor=""
      tabIndex={-1}
      onPointerDown={grabFocus}
      className="space-y-2 outline-none"
    >
      {/**
       * ワークベンチのパネルの中（UI-WORKBENCH-2 §6）。**タブと同じ見出しを繰り返さない。箱に箱を入れない。**
       * 1 行目 = 再生、2 行目 = 区切りの道具と仕上げ（Shot にする）、3 行目 = 案内と表示の切り替え。
       */}
      <AudioTransport
        playback={playback}
        /**
         * ワークベンチでは操作列（`TransportButtons`）を `playButton` で差し込む（`transport-bar.tsx` の経緯）。
         * 音量はステータスバーにひとつだけ置くので、ここには出さない。
         */
        showPlay={showPlay}
        playButton={playButton}
        showVolume={sync === undefined}
        label={track.title}
        keyboardShortcuts={false}
        layout="inline"
      />

      {cutting && (
        <div role="toolbar" aria-label="区切りの道具" className="flex flex-wrap items-center gap-2">
          <Button
            tone="primary"
            size="sm"
            onClick={() => {
              placeMarkAt(playback.currentSec)
            }}
            disabled={saving}
          >
            {/**
             * 秒が変わるたびにボタンの幅が動くと、置こうとしている的が揺れる。
             * 数字は等幅（`tabular-nums`）にし、桁が増えても動かないよう幅を決め打つ。
             */}
            <span className="inline-block w-[13.5rem] text-center tabular-nums">
              {`ここに区切りを置く（${formatClock(playback.currentSec)}）`}
            </span>
          </Button>
          <label className="flex items-center gap-1.5 text-sm text-text">
            <input
              type="checkbox"
              checked={snapEnabled}
              disabled={saving}
              onChange={(event) => {
                setSnapEnabled(event.target.checked)
                setSnapNotice(null)
              }}
              className="h-3.5 w-3.5"
            />
            拍に吸着
          </label>
          <Button size="sm" disabled={saving} onClick={placeSectionMarks}>
            セクションの境目に区切りを置く
          </Button>
          <Button
            size="sm"
            disabled={saving}
            title={
              lyricCues.length === 0
                ? '先に「歌詞を合わせる」で歌い出しに時刻を付けると使えます'
                : '波形の番号付きの線（歌い出し）すべてに区切りを置きます'
            }
            onClick={placeLyricMarks}
          >
            歌い出しに区切りを置く
          </Button>
          {toolbarExtra}
          {/**
           * 仕上げ（制作者 2026-10-03「肝心の「N カットを Shot にする」ボタンが一番下にあり、しかも黒ボタンなので
           * 導線が分かりづらい」）。道具の列の右端に置き、区切りが揃ったら主ボタンになる（揃うまでは押せない）。
           */}
          <span className="ml-auto">
            <Button
              tone="primary"
              size="sm"
              disabled={saving || cuts.state !== 'cuts'}
              title={cuts.state === 'cuts' ? undefined : '区切りを置くと Shot にできます'}
              onClick={() => {
                if (cuts.state === 'cuts') void cutSave.save(marks, durationSec)
              }}
            >
              {saveLabel}
            </Button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {cutting && (
          <span>区切りは下書きです。「Shot にする」で Shot として保存されます（保存すると区切りは空に戻ります）。</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="tabular-nums">
            {`BPM ${analysis.bpm.toFixed(1)}・表示 ${formatClock(view.startSec)}〜${formatClock(view.endSec)}`}
          </span>
          <Button
            size="sm"
            onClick={() => {
              setView(fullView(durationSec))
            }}
          >
            全体
          </Button>
          <label
            className="flex items-center gap-1"
            title="鳴っている間は窓が流れ、止めている間は再生位置が画面から出たときだけ追いかけます"
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
        </span>
      </div>

      {cutting && cutSave.error !== null && (
        <p role="alert" className="text-sm text-danger">
          {cutSave.error}
        </p>
      )}
      {cutting && cutSave.outcome !== null && (
        <div>
          <p role="status" className="text-sm text-ok">
            {`${String(cutSave.outcome.createdCount)} 個の Shot を作りました。次は絵コンテです（流れの帯の ⑥）。`}
          </p>
          {cutSave.outcome.warnings.length > 0 && (
            <ul role="alert" className="mt-1 list-disc space-y-1 pl-5 text-sm text-warn">
              {cutSave.outcome.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sourceError !== null && (
        <p role="alert" className="text-sm text-danger">
          {`音源を読み込めませんでした: ${sourceError}`}
        </p>
      )}

      <div ref={waveBoxRef}>
        {peaks === null ? (
          <p role="status" className="text-sm text-muted">
            波形を読み込んでいます…
          </p>
        ) : (
          <WaveformCanvas
            peaks={peaks}
            durationSec={durationSec}
            view={view}
            beats={analysis.beats}
            downbeats={analysis.downbeats}
            drops={analysis.drops}
            sectionBoundarySec={sectionBoundarySec}
            heightPx={waveHeightPx}
          >
            <CutWaveformOverlay
              {...(openMarkMenu === undefined ? {} : { onMarkContextMenu: openMarkMenu })}
              // 歌詞のときは区切りの印を出さない（押す・ずらす・拡大はそのまま使う）。
              marks={cutting ? marks : []}
              selectedIndex={selectedIndex}
              currentSec={playback.currentSec}
              durationSec={durationSec}
              view={view}
              disabled={saving}
              onSeek={playback.seekTo}
              onSelectMark={setSelectedIndex}
              onDragStart={() => {
                setDragging(true)
              }}
              onMoveMark={(index, sec) => {
                moveMarkTo(index, sec, false)
              }}
              onDragEnd={() => {
                setDragging(false)
                const mark = marks[selectedIndex]
                if (mark !== undefined) moveMarkTo(selectedIndex, mark.atSec, true)
              }}
              onZoom={(anchorSec, factor) => {
                setView((current) => zoomView(current, anchorSec, factor, durationSec))
              }}
              onPan={(ratio) => {
                panBy(ratio)
              }}
            />
            {/* 歌い出しの印は区切るときも出す。区切りを歌い出しに合わせやすくする（制作者 2026-10-02）。 */}
            {lyricCues.length > 0 && <LyricCueOverlay cues={lyricCues} view={view} />}
          </WaveformCanvas>
        )}
      </div>

      {/* ここから下は区切りの道具。歌詞を合わせている間は出さない。 */}
      {cutting && (
        <>
          {snapNotice !== null && (
            <p role="status" className={`text-sm ${snapNoticeClassName(snapNotice.state)}`}>
              {snapNotice.message}
            </p>
          )}

          <CutMarkList
            {...(openMarkMenu === undefined ? {} : { onMarkContextMenu: openMarkMenu })}
            marks={marks}
            songDurationSec={durationSec}
            busy={saving}
            selectedIndex={selectedIndex}
            onSelect={selectAndSeek}
            onRemove={removeAt}
            onMove={(index, atSec) => {
              moveMarkTo(index, atSec, false)
            }}
            rejection={rejection}
          />

          {/**
           * **キーの一覧はこの画面に 1 つだけ置く**（`describeCutEditorKeys` が実際の行き先から作る）。
           * 既定では畳む。拡大 / 縮小は ⌘・Ctrl + ホイール、横送りは Shift + ホイール。
           */}
          <HelpDisclosure label="キーとホイールの割り当て">
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {keyHelp.map((entry) => (
                <div key={entry.keys} className="flex justify-between gap-3">
                  <dt className="font-mono text-text">{entry.keys}</dt>
                  <dd className="text-right text-muted">{entry.action}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-text">⌘ / Ctrl + ホイール</dt>
                <dd className="text-right text-muted">拡大 / 縮小</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-text">Shift + ホイール</dt>
                <dd className="text-right text-muted">横に送る</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted">
              Enter と S は、波形の外を押していても区切りを置きます。文字を打っている間はこれらのキーは効きません。
            </p>
          </HelpDisclosure>
        </>
      )}
    </div>
  )
}
