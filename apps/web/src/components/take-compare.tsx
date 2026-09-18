'use client'

import { useCallback, useState } from 'react'
import { BeatRuler } from '@/components/beat-ruler'
import { ProgramMonitor } from '@/components/program-monitor'
import { nextSeekCommand, type SeekCommand } from '@/lib/program-monitor'
import {
  compareColumns,
  compareNoticeClassName,
  describeCompareState,
  spanEndSec,
  type CompareSpan,
  type WireComparedTake,
  type WireShotCompare,
} from '@/lib/take-compare'

/**
 * Take の A/B を**曲の拍の上で**比べる（P61-2）。
 *
 * ミュージックビデオの Take の良し悪しは「曲のどこで何が起きるか」で決まる。
 * 静止画を 2 枚並べても判断できないので、**同じ瞬間を、同じ拍の上で**並べる。
 *
 * **位置の流れは一方通行**（lessons L-023）。位置を報告するのは A だけで、
 * B は指示（`seek` / `playing`）を受け取るだけにする。2 つが互いに位置を
 * 報告し合うと、6.0 で潰した往復が戻ってくる。
 *
 * 既定は**この Shot の区間だけを繰り返す**。判断したいのはそこだけなので、
 * 曲の頭から流して待つ必要はない。
 */

/** B は位置も再生状態も報告しない。**同じ関数を渡し続ける**ため外に置く。 */
const ignore = () => {}

export type TakeCompareProps = {
  /** **null は「まだ読めていない」。** 比較するものが無いのとは別物（L-015 / L-021）。 */
  readonly compare: WireShotCompare | null
  /** 読み込みそのものに失敗したときの理由。 */
  readonly error?: string | null
  readonly labelA?: string
  readonly labelB?: string
}

export const TakeCompare = ({
  compare,
  error = null,
  labelA = '採用候補 A',
  labelB = '比較 B',
}: TakeCompareProps) => {
  if (error !== null) {
    return (
      <section aria-label="Take の比較" className="rounded-lg border border-line bg-surface p-4">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      </section>
    )
  }

  if (compare === null) {
    return (
      <section aria-label="Take の比較" className="rounded-lg border border-line bg-surface p-4">
        <p role="status" className="text-sm text-muted">
          比較の材料をまだ読めていません。
        </p>
      </section>
    )
  }

  return (
    <CompareBoard
      // Take が変わったら位置と再生状態を作り直す。前の Take の位置を持ち越さない。
      key={`${compare.a.takeId}:${compare.b?.takeId ?? 'none'}`}
      compare={compare}
      labelA={labelA}
      labelB={labelB}
    />
  )
}

type CompareBoardProps = {
  readonly compare: WireShotCompare
  readonly labelA: string
  readonly labelB: string
}

const CompareBoard = ({ compare, labelA, labelB }: CompareBoardProps) => {
  const span: CompareSpan = {
    startSec: compare.shot.startSec,
    durationSec: compare.shot.durationSec,
  }

  /** 位置は A の報告だけで動く。B は読むだけ。 */
  const [currentSec, setCurrentSec] = useState(span.startSec)
  const [playing, setPlaying] = useState(false)
  const [seek, setSeek] = useState<SeekCommand | null>(null)
  const [loop, setLoop] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)

  /** 利用者の明示的な指示。反射（`onFrame`）とは別の値として渡す（L-023）。 */
  const seekTo = useCallback((sec: number) => {
    setCurrentSec(sec)
    setSeek((previous) => nextSeekCommand(previous, sec))
  }, [])

  const notice = describeCompareState(compare.reason)
  const hasB = compare.b !== null

  /**
   * A の絵が出せないなら、並べるものが無い。
   *
   * **空の document をモニターへ渡さない。** モニターは Shot が 0 件のタイムラインと
   * 見分けがつかず、「Shot を並べると絵が出ます」という**この画面では嘘の案内**を
   * 素材が無いという報せの真下に出す（lessons L-015 / L-021）。
   */
  if (compare.reason === 'a_media_unresolved') {
    return (
      <section aria-label="Take の比較" className="rounded-lg border border-line bg-surface p-4">
        <p role="alert" className="text-sm text-danger">
          {notice?.headline}。{notice?.detail}
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Take の比較" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying((previous) => !previous)}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
        >
          {playing ? '停止' : '再生'}
        </button>

        <button
          type="button"
          onClick={() => seekTo(span.startSec)}
          className="rounded border border-line-strong px-3 py-1.5 text-sm text-text"
        >
          頭出し
        </button>

        <label className="flex items-center gap-1.5 text-sm text-muted">
          <input
            type="checkbox"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
            className="accent-accent"
          />
          この Shot の区間を繰り返す
        </label>
      </div>

      {notice !== null && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-xs ${compareNoticeClassName(notice.tone)}`}
        >
          {notice.headline}。{notice.detail}
        </p>
      )}

      <div
        className={`grid gap-3 ${compareColumns(hasB) === 2 ? 'lg:grid-cols-2' : 'grid-cols-1'}`}
      >
        <MonitorColumn
          label={labelA}
          take={compare.a}
          span={span}
          currentSec={currentSec}
          seek={seek}
          playing={playing}
          loop={loop}
          // **位置を報告するのは A だけ。** 2 つが報告し合うと往復が戻る（L-023）。
          onFrame={setCurrentSec}
          onPlayingChange={setPlaying}
          onError={setFailure}
        />

        {compare.b !== null && (
          <MonitorColumn
            label={labelB}
            take={compare.b}
            span={span}
            currentSec={currentSec}
            seek={seek}
            playing={playing}
            loop={loop}
            // B は指示を受けるだけ。位置も再生状態も返さない。
            onFrame={ignore}
            onPlayingChange={ignore}
            onError={setFailure}
          />
        )}
      </div>

      <BeatRuler
        beats={compare.beats}
        downbeats={compare.downbeats}
        beatState={compare.beatState}
        span={span}
        currentSec={currentSec}
        onSeek={seekTo}
      />

      {failure !== null && (
        <p role="alert" className="text-xs text-danger">
          {failure}
        </p>
      )}
    </section>
  )
}

type MonitorColumnProps = {
  readonly label: string
  readonly take: WireComparedTake
  readonly span: CompareSpan
  readonly currentSec: number
  readonly seek: SeekCommand | null
  readonly playing: boolean
  readonly loop: boolean
  readonly onFrame: (sec: number) => void
  readonly onPlayingChange: (playing: boolean) => void
  readonly onError: (message: string) => void
}

const MonitorColumn = ({
  label,
  take,
  span,
  currentSec,
  seek,
  playing,
  loop,
  onFrame,
  onPlayingChange,
  onError,
}: MonitorColumnProps) => (
  <section aria-label={label} className="flex flex-col gap-1">
    <h3 className="text-xs font-medium text-muted">{label}</h3>
    <ProgramMonitor
      document={take.document}
      currentSec={currentSec}
      seek={seek}
      playing={playing}
      inSec={span.startSec}
      outSec={spanEndSec(span)}
      loop={loop}
      onFrame={onFrame}
      onPlayingChange={onPlayingChange}
      onError={onError}
    />
  </section>
)
