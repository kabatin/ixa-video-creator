'use client'

import type { TimelineClip, TimelineClipId } from '@ixa/domain'
import { useState } from 'react'
import { TextField } from '@/components/form/text-field'
import { SnapNoticeList } from '@/components/timeline-snap-panel'
import {
  describeClipContent,
  formatTimeSpan,
  parseDurationSec,
  parseLayer,
  parseSeconds,
  sortClipsForDisplay,
} from '@/lib/timeline-display'
import type { SnapNotice, SnapSpanInput, SnapSpanOutcome } from '@/lib/timeline-snap'

/**
 * 置いてあるクリップの位置・尺・重ね順を数値で変える / 消す（P5-4）。
 *
 * **クリップが 0 件であることと、読み込めていないことを画面で区別する。**
 * 呼び出し側は読み込めなかったときに `clips` へ null を渡す（lessons L-015）。
 *
 * 確定時に開始と終了を吸着候補へ寄せる。**動かしている当のクリップ自身は候補から外す**
 * （自分の端は距離 0 の候補になり、そこへ吸着して動かせなくなるため）。
 * 除外は `onSnapSpan` に渡す `TimelineClipId` で呼び出し側が行う。
 */

export type ClipPatch = {
  readonly startSec: number
  readonly durationSec: number
  readonly layer: number
}

export type TimelineClipListProps = {
  /** null は「読み込めていない」。空配列（＝クリップが無い）と混同させない。 */
  readonly clips: readonly TimelineClip[] | null
  readonly busy: boolean
  readonly selectedClipId: TimelineClipId | null
  readonly onSelect: (id: TimelineClipId) => void
  readonly onUpdate: (id: TimelineClipId, patch: ClipPatch) => void
  readonly onRemove: (id: TimelineClipId) => void
  /**
   * 吸着の実行。**第 1 引数のクリップを候補から除外して**呼ぶこと。
   * 規則の正は `packages/timeline` 側にあり、この画面には置かない。
   */
  readonly onSnapSpan: (id: TimelineClipId, span: SnapSpanInput) => SnapSpanOutcome
}

type Errors = Partial<Record<'startSec' | 'durationSec' | 'layer', string>>

type ClipRowProps = {
  readonly clip: TimelineClip
  readonly busy: boolean
  readonly selected: boolean
  readonly onSelect: (id: TimelineClipId) => void
  readonly onUpdate: (id: TimelineClipId, patch: ClipPatch) => void
  readonly onRemove: (id: TimelineClipId) => void
  readonly onSnapSpan: (id: TimelineClipId, span: SnapSpanInput) => SnapSpanOutcome
}

const ClipRow = ({
  clip,
  busy,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onSnapSpan,
}: ClipRowProps) => {
  const [startRaw, setStartRaw] = useState(clip.startSec.toFixed(2))
  const [durationRaw, setDurationRaw] = useState(clip.durationSec.toFixed(2))
  const [layerRaw, setLayerRaw] = useState(String(clip.layer))
  const [errors, setErrors] = useState<Errors>({})
  const [notices, setNotices] = useState<readonly SnapNotice[] | null>(null)

  const submit = (): void => {
    const start = parseSeconds(startRaw)
    const duration = parseDurationSec(durationRaw)
    const layer = parseLayer(layerRaw)

    const next: Errors = {
      ...(start.ok ? {} : { startSec: start.message }),
      ...(duration.ok ? {} : { durationSec: duration.message }),
      ...(layer.ok ? {} : { layer: layer.message }),
    }
    setErrors(next)
    if (!start.ok || !duration.ok || !layer.ok) {
      setNotices(null)
      return
    }

    const snapped = onSnapSpan(clip.id, {
      startSec: start.value,
      durationSec: duration.value,
    })
    setNotices(snapped.notices)
    // 送る値を欄へ書き戻す。欄と送信値がずれたままだと何が起きたか読めない。
    setStartRaw(snapped.startSec.toFixed(3))
    setDurationRaw(snapped.durationSec.toFixed(3))

    onUpdate(clip.id, {
      startSec: snapped.startSec,
      durationSec: snapped.durationSec,
      layer: layer.value,
    })
  }

  return (
    <li
      className={`flex flex-wrap items-end gap-3 border-t border-slate-200 py-3 ${
        selected ? 'bg-sky-50' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => {
          onSelect(clip.id)
        }}
        aria-pressed={selected}
        className="min-w-56 flex-1 text-left"
      >
        <p className="text-sm font-medium text-slate-800">
          {`${clip.track} / layer ${String(clip.layer)}`}
        </p>
        <p className="text-xs text-slate-600">{describeClipContent(clip.content)}</p>
        <p className="text-xs text-slate-500">{formatTimeSpan(clip)}</p>
      </button>

      <div className="w-28">
        <TextField
          id={`clip-start-${clip.id}`}
          label="開始（秒）"
          value={startRaw}
          disabled={busy}
          error={errors.startSec}
          onChange={(value) => {
            setStartRaw(value)
            setNotices(null)
          }}
        />
      </div>
      <div className="w-28">
        <TextField
          id={`clip-duration-${clip.id}`}
          label="尺（秒）"
          value={durationRaw}
          disabled={busy}
          error={errors.durationSec}
          onChange={(value) => {
            setDurationRaw(value)
            setNotices(null)
          }}
        />
      </div>
      <div className="w-24">
        <TextField
          id={`clip-layer-${clip.id}`}
          label="layer"
          value={layerRaw}
          disabled={busy}
          error={errors.layer}
          onChange={setLayerRaw}
        />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        変える
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          onRemove(clip.id)
        }}
        className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
      >
        消す
      </button>

      <div className="w-full">
        <SnapNoticeList notices={notices} />
      </div>
    </li>
  )
}

export const TimelineClipList = ({
  clips,
  busy,
  selectedClipId,
  onSelect,
  onUpdate,
  onRemove,
  onSnapSpan,
}: TimelineClipListProps) => (
  <section className="rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-base font-semibold text-slate-900">置いてあるクリップ</h2>

    {clips === null ? (
      <p role="alert" className="mt-3 text-sm text-red-800">
        クリップを読み込めていません。「1 件も無い」ではなく「分からない」状態です。
      </p>
    ) : clips.length === 0 ? (
      <p role="status" className="mt-3 text-sm text-slate-600">
        読み込みは成功しました。クリップはまだ 1 件もありません。
      </p>
    ) : (
      <ul className="mt-2">
        {sortClipsForDisplay(clips).map((clip) => (
          <ClipRow
            key={clip.id}
            clip={clip}
            busy={busy}
            selected={clip.id === selectedClipId}
            onSelect={onSelect}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onSnapSpan={onSnapSpan}
          />
        ))}
      </ul>
    )}
  </section>
)
