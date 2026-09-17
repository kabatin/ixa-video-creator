'use client'

import type { MusicTrack, ProjectId, Sequence, SequenceId } from '@ixa/domain'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AudioTransport } from '@/components/audio-transport'
import { CutMarkList } from '@/components/cut-mark-list'
import { CutWaveformOverlay } from '@/components/cut-waveform-overlay'
import { SelectField } from '@/components/form/select-field'
import { Button } from '@/components/ui/button'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { resolveCutEditorCommand, describeCutEditorKeys } from '@/lib/cut-editor-keys'
import {
  ZOOM_STEP,
  canFollowPlayhead,
  centerView,
  isTimeInView,
  panView,
  zoomView,
} from '@/lib/cut-editor-pointer'
import {
  addMark,
  buildCutMarkCandidates,
  cutMarkToleranceSec,
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
import { fetchWaveformPeaks, type WaveformPeaksResult } from '@/lib/waveform-api'
import { fullView, pixelsPerSecond, sectionBoundaries, type ViewRange } from '@/lib/waveform-draw'

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
 */

const NO_SEQUENCE_VALUE = 'none'
const WAVEFORM_HEIGHT_PX = 160
/** 窓を横へ送る量。見えている幅に対する割合で決める。 */
const PAN_RATIO = 0.25

export type CutEditorProps = {
  readonly projectId: ProjectId
  readonly track: MusicTrack
  readonly analysis: WireMusicAnalysis
  readonly sequences: readonly Sequence[]
}

type SaveOutcome = {
  readonly createdCount: number
  readonly warnings: readonly string[]
}

export const CutEditor = ({ projectId, track, analysis, sequences }: CutEditorProps) => {
  const router = useRouter()

  const [marks, setMarks] = useState<readonly CutMark[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [rejection, setRejection] = useState<MarkRejection | null>(null)
  const [snapNotice, setSnapNotice] = useState<SnapNotice | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)

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
  const [widthPx, setWidthPx] = useState(0)

  const [sequenceId, setSequenceId] = useState<string>(NO_SEQUENCE_VALUE)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null)

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

  const playback = useAudioPlayback({ source, onRefreshSource: loadSource })

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

  const candidates = useMemo(
    () => buildCutMarkCandidates(beatSource, durationSec),
    [beatSource, durationSec],
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
    setOutcome(null)
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

  // --- キーボード ---

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target =
        event.target instanceof HTMLElement
          ? { tagName: event.target.tagName, isContentEditable: event.target.isContentEditable }
          : null
      const resolved = resolveCutEditorCommand({
        key: event.key,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        target,
      })
      if (resolved === null) return
      event.preventDefault()

      if (resolved.source === 'playback') {
        const command = resolved.command
        if (command.kind === 'toggle') playback.toggle()
        else if (command.kind === 'nudge') playback.nudge(command.deltaSec)
        else playback.seekTo(command.edge === 'start' ? 0 : durationSec)
        return
      }

      const command = resolved.command
      switch (command.type) {
        case 'place_mark':
          placeMarkAt(playback.currentSec)
          return
        case 'remove_previous_mark': {
          const index = previousMarkIndex(marks, playback.currentSec)
          if (index < 0) {
            setRejection({ reason: 'missing', message: '再生位置より前に区切りがありません。' })
            return
          }
          removeAt(index)
          return
        }
        case 'remove_selected_mark':
          removeAt(selectedIndex)
          return
        case 'select_previous_mark':
          selectAndSeek(previousMarkIndex(marks, playback.currentSec))
          return
        case 'select_next_mark':
          selectAndSeek(nextMarkIndex(marks, playback.currentSec))
          return
        case 'nudge_selected_mark':
          applyChange(nudgeMarkAt(marks, selectedIndex, command.deltaSec))
          return
        case 'toggle_snap':
          setSnapEnabled((current) => !current)
          setSnapNotice(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  // --- 保存 ---

  const cuts = describeCuts(marks)

  const save = async (): Promise<void> => {
    if (cuts.state !== 'cuts') return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await createApiClient().createCuts(projectId, {
        boundariesSec: marks.map((mark) => mark.atSec),
        sequenceId: sequenceId === NO_SEQUENCE_VALUE ? null : (sequenceId as SequenceId),
      })
      setOutcome({ createdCount: result.createdCount, warnings: result.warnings })
      // 他の画面の先読み内容を捨てる。作ったのに「ありません」と出るのを防ぐ。
      router.refresh()
    } catch (caught) {
      setSaveError(describeError(caught))
      setOutcome(null)
    } finally {
      setSaving(false)
    }
  }

  const keyHelp = describeCutEditorKeys()
  const sectionBoundarySec = sectionBoundaries(analysis.sections)

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">聴きながら切る</h2>
          <p className="text-sm text-slate-600">
            {`BPM ${analysis.bpm.toFixed(1)} / 拍 ${String(analysis.beats.length)} 個 / 小節 ${String(analysis.downbeats.length)} 個`}
          </p>
        </div>

        {sourceError !== null && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {`音源を読み込めませんでした: ${sourceError}`}
          </p>
        )}

        <div ref={(node) => setWidthPx(node?.clientWidth ?? 0)} className="mt-4">
          {peaks === null ? (
            <p role="status" className="text-sm text-slate-600">
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
              heightPx={WAVEFORM_HEIGHT_PX}
            >
              <CutWaveformOverlay
                marks={marks}
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
              />
            </WaveformCanvas>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setView((current) => zoomView(current, playback.currentSec, ZOOM_STEP, durationSec))
            }}
          >
            寄る
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setView((current) =>
                zoomView(current, playback.currentSec, 1 / ZOOM_STEP, durationSec),
              )
            }}
          >
            引く
          </Button>
          <Button
            size="sm"
            onClick={() => {
              panBy(-PAN_RATIO)
            }}
          >
            ← 左へ
          </Button>
          <Button
            size="sm"
            onClick={() => {
              panBy(PAN_RATIO)
            }}
          >
            右へ →
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setView(fullView(durationSec))
            }}
          >
            全体
          </Button>
          <span className="text-sm text-slate-600">
            {`表示 ${formatClock(view.startSec)} 〜 ${formatClock(view.endSec)}`}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={followPlayhead}
              onChange={(event) => {
                setFollowPlayhead(event.target.checked)
              }}
              className="h-4 w-4 rounded border-slate-400"
            />
            再生位置を中央に保つ
          </label>

          {/**
           * **効いていないのか、効いた上で動く必要が無いのかを区別して出す**（L-015）。
           * 曲全体を映している窓では中央へ寄せても押し戻されるので、何も起きない。
           * 黙っていると設定が壊れているように見える。
           */}
          <span className="text-sm text-slate-600">
            {!followPlayhead
              ? '窓は動かしません。「← 左へ」「右へ →」で自分で送ってください。'
              : !canFollowPlayhead(view, durationSec)
                ? '曲全体を表示しているので動きません。「寄る」で拡大すると中央に保ちます。'
                : '鳴っている間は窓が流れます。止めている間は、再生位置が画面から出たときだけ追いかけます。'}
          </span>
        </div>
      </section>

      <AudioTransport playback={playback} label={track.title} keyboardShortcuts={false} />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            tone="primary"
            onClick={() => {
              placeMarkAt(playback.currentSec)
            }}
            disabled={saving}
          >
            {`ここに区切りを置く（${formatClock(playback.currentSec)}）`}
          </Button>

          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={snapEnabled}
              disabled={saving}
              onChange={(event) => {
                setSnapEnabled(event.target.checked)
                setSnapNotice(null)
              }}
              className="h-4 w-4 rounded border-slate-400"
            />
            拍に吸着させる
          </label>
        </div>

        {snapNotice !== null && (
          <p role="status" className={`mt-3 text-sm ${snapNoticeClassName(snapNotice.state)}`}>
            {snapNotice.message}
          </p>
        )}

        {/**
         * **キーの一覧はこの画面に 1 つだけ置く。**
         *
         * `CutMarkKeyHelp`（区切り側）も `AudioTransport` の `KEY_HINTS`（再生側）も
         * それぞれ自前の一覧を持っているが、この画面では両者の割り当てが
         * `←` `→` で重なっており、並べると同じキーに 2 つの説明が出る。
         * 実際に一度そうなり、再生側だけが「1 秒 戻る / 進む」と嘘を出していた。
         * ここでは `describeCutEditorKeys` が**実際の行き先から作った一覧**だけを出す。
         */}
        <h3 className="mt-4 text-sm font-semibold text-slate-900">キーの割り当て</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {keyHelp.map((entry) => (
            <div key={entry.keys} className="flex justify-between gap-3">
              <dt className="font-mono text-slate-800">{entry.keys}</dt>
              <dd className="text-right text-slate-600">{entry.action}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-slate-600">
          文字を打っている間はこれらのキーは効きません。
        </p>
      </section>

      <CutMarkList
        marks={marks}
        busy={saving}
        selectedIndex={selectedIndex}
        onSelect={selectAndSeek}
        onRemove={removeAt}
        onMove={(index, atSec) => {
          moveMarkTo(index, atSec, false)
        }}
        rejection={rejection}
      />

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Shot にする</h2>

        <div className="mt-3 max-w-sm">
          <SelectField
            id="cutSequenceId"
            label="Sequence"
            value={sequenceId}
            disabled={saving}
            options={[
              { value: NO_SEQUENCE_VALUE, label: '（Sequence に入れない）' },
              ...sequences.map((sequence) => ({ value: sequence.id, label: sequence.name })),
            ]}
            onChange={setSequenceId}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            tone="primary"
            disabled={saving || cuts.state !== 'cuts'}
            onClick={() => {
              void save()
            }}
          >
            {saving
              ? '作成中…'
              : cuts.state === 'cuts'
                ? `${String(cuts.cuts.length)} カットを Shot にする`
                : 'Shot にする'}
          </Button>

          {cuts.state !== 'cuts' && (
            <p className="text-sm text-slate-600">
              {cuts.state === 'single_mark'
                ? '区切りが 1 個だけです。カットは隣り合う 2 個の区切りで決まります。'
                : '区切りがまだありません。'}
            </p>
          )}
        </div>

        {saveError !== null && (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {saveError}
          </p>
        )}

        {outcome !== null && (
          <div className="mt-3">
            <p role="status" className="text-sm text-slate-800">
              {`${String(outcome.createdCount)} 個の Shot を作りました。`}
            </p>
            {outcome.warnings.length > 0 && (
              <ul role="alert" className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                {outcome.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
