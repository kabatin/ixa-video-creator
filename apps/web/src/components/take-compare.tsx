'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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

/**
 * 画面の他の再生器と**同時に鳴らない**ための口。
 * 渡さなければ自分だけで完結する（単体で置くとき）。
 */
export type ExclusivePlayback = {
  /** 他が鳴っている。真になったら自分は止まる。 */
  readonly othersPlaying: boolean
  /** 自分が鳴り始めた・止まったことを知らせる。鳴り始めたら他が止まる。 */
  readonly onPlayingChange: (playing: boolean) => void
  /**
   * 「自分が鳴っているべきか」の指示。自分が持ち主のときだけ値を持ち、それ以外は `null`。
   * 画面の ⏸ や Space で止められたとき、ここで止まる（`othersPlaying` だけだと止まらない）。
   */
  readonly commandPlaying: boolean | null
}

export type TakeCompareProps = {
  /** **null は「まだ読めていない」。** 比較するものが無いのとは別物（L-015 / L-021）。 */
  readonly compare: WireShotCompare | null
  readonly exclusive?: ExclusivePlayback
  /** 読み込みそのものに失敗したときの理由。 */
  readonly error?: string | null
  readonly labelA?: string
  readonly labelB?: string
}

export const TakeCompare = ({
  compare,
  exclusive,
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
      exclusive={exclusive}
    />
  )
}

type CompareBoardProps = {
  readonly compare: WireShotCompare
  readonly labelA: string
  readonly labelB: string
  readonly exclusive: ExclusivePlayback | undefined
}

const CompareBoard = ({ compare, labelA, labelB, exclusive }: CompareBoardProps) => {
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

  /**
   * 他と同時に鳴らない。**鳴り始め・止まりを知らせ、他が鳴ったら止まる。**
   * 知らせは変化のときだけ（取り付け時の「止まっている」を知らせると、他の再生を止めてしまう）。
   */
  const reportRef = useRef(exclusive?.onPlayingChange)
  reportRef.current = exclusive?.onPlayingChange
  const wasPlayingRef = useRef(playing)
  useEffect(() => {
    if (wasPlayingRef.current === playing) return
    wasPlayingRef.current = playing
    reportRef.current?.(playing)
  }, [playing])

  const othersPlaying = exclusive?.othersPlaying ?? false
  useEffect(() => {
    if (othersPlaying) setPlaying(false)
  }, [othersPlaying])

  // 外からの指示に従う。すでにその状態なら何もしない（自分の知らせが返ってくるため）。
  const commandPlaying = exclusive?.commandPlaying ?? null
  useEffect(() => {
    if (commandPlaying === null) return
    setPlaying((current) => (current === commandPlaying ? current : commandPlaying))
  }, [commandPlaying])

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
    <section aria-label="Take の比較" className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying((previous) => !previous)}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
        >
          {/*
            「再生」とだけ書くと、画面の再生ボタンと区別がつかない。
            ここは**この Shot の区間だけ**を鳴らす別の操作なので、言葉で分ける。
          */}
          {playing ? '停止' : 'この Shot を再生'}
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

      {/* 絵が残りの高さを全部使う。拍の目盛りと知らせは下に固定する。 */}
      <div
        className={`grid min-h-0 flex-1 gap-3 ${
          compareColumns(hasB) === 2 ? 'lg:grid-cols-2' : 'grid-cols-1'
        }`}
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
  <section aria-label={label} className="flex min-h-0 flex-col gap-1">
    <h3 className="shrink-0 text-xs font-medium text-muted">{label}</h3>
    {/**
      * **絵の高さはここで決める。** `fit="contain"` は入れ物の高さが決まっていることを
      * 前提にしている。親から高さが降ってこない置き方をすると `100cqh` の相手が無くなり、
      * コンポジションの実寸（1920×1080）で描かれて画面の外へ出る（実際に出た）。
      * 上下を切って、狭い窓でも 2 枚が横に並んだまま見えるようにする。
      */}
    <div className="h-[clamp(9rem,26vh,18rem)] min-h-0">
      <ProgramMonitor
        // 横に 2 枚並ぶが、縦もこの枠に収める。幅だけで決めると下へはみ出す。
        fit="contain"
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
    </div>
  </section>
)
