'use client'

import type { ReactNode } from 'react'
import { usePlayheadSec } from '@/lib/playhead-sec'
import { ZOOM_LEVELS, zoomLabel } from '@/lib/timeline-display'

/**
 * タイムラインのツールバー（1 行）。**見出し付きの 3 つの群**に分ける（制作者 2026-10-19）。
 *
 * - 表示：ズーム（全体／フレーズ／小節／拍／細かく）
 * - 追加：＋テロップ ＋エフェクト（再生位置に置く）
 * - 右寄せ：拍に吸着・再生位置を追う
 *
 * 再生の状態と位置は左端に寄せる（制作者 2026-10-02「停止中と時間の表示が縦幅を占有してしまう」）。
 */

export type TimelineToolbarProps = {
  /** 左端の再生の状態と位置。読めていなければ出さない。 */
  readonly clock: ReactNode
  readonly pxPerSec: number
  readonly onZoom: (pxPerSec: number) => void
  /** 「追加」の群に並べるボタン。 */
  readonly additions: ReactNode
  readonly snapEnabled: boolean
  readonly onSnapChange: (enabled: boolean) => void
  readonly followPlayhead: boolean
  readonly onFollowChange: (enabled: boolean) => void
}

/** 群の小さな見出し。ボタンと同じ行に置き、縦を食わない。 */
const GroupLabel = ({ children }: { readonly children: string }) => (
  <span className="text-xs text-muted">{children}</span>
)

const ZOOM_BUTTON = 'rounded px-2 py-0.5 text-xs ring-1'

/**
 * 再生位置にテロップを置く（制作者 2026-10-19「＋テロップが欲しい」）。
 * 位置は押した瞬間だけ読む。毎コマ読むのはこの末端だけ（`@/lib/playhead-sec`）。
 */
export const AddTextButton = ({
  busy,
  onAdd,
}: {
  readonly busy: boolean
  readonly onAdd: (atSec: number) => void
}) => {
  const playheadSec = usePlayheadSec()
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        onAdd(playheadSec)
      }}
      className="rounded bg-surface px-2 py-0.5 text-xs text-text ring-1 ring-line-strong hover:bg-surface-2 disabled:opacity-50"
      title="再生位置にテロップを置き、インスペクターで文字を打てるようにします"
    >
      ＋ テロップ
    </button>
  )
}

export const TimelineToolbar = ({
  clock,
  pxPerSec,
  onZoom,
  additions,
  snapEnabled,
  onSnapChange,
  followPlayhead,
  onFollowChange,
}: TimelineToolbarProps) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1" role="toolbar" aria-label="タイムラインの操作">
    {clock}
    <div className="flex items-center gap-1" role="group" aria-label="表示">
      <GroupLabel>表示</GroupLabel>
      {ZOOM_LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={level === pxPerSec}
          onClick={() => {
            onZoom(level)
          }}
          className={`${ZOOM_BUTTON} ${
            level === pxPerSec
              ? 'bg-accent text-accent-fg ring-accent'
              : 'bg-surface text-text ring-line-strong hover:bg-surface-2'
          }`}
        >
          {zoomLabel(level)}
        </button>
      ))}
    </div>
    <div className="flex items-center gap-1" role="group" aria-label="追加">
      <GroupLabel>追加</GroupLabel>
      {additions}
    </div>
    <div className="ml-auto flex items-center gap-3">
      <label
        className="flex items-center gap-1 text-xs text-text"
        title="置く・動かす位置を、近くの拍・Shot の境目・歌い出しへ寄せます。候補の内訳は「検査」のタブにあります"
      >
        <input
          type="checkbox"
          checked={snapEnabled}
          onChange={(event) => {
            onSnapChange(event.target.checked)
          }}
          className="h-3.5 w-3.5"
        />
        拍に吸着
      </label>
      <label
        className="flex items-center gap-1 text-xs text-text"
        title="鳴っている間は帯が流れ、止めている間は再生位置が画面から出たときだけ追いかけます"
      >
        <input
          type="checkbox"
          checked={followPlayhead}
          onChange={(event) => {
            onFollowChange(event.target.checked)
          }}
          className="h-3.5 w-3.5"
        />
        再生位置を追う
      </label>
    </div>
  </div>
)
