'use client'

import type { MediaAssetId } from '@ixa/domain'
import { useEffect, useId } from 'react'
import { Button } from '@/components/ui/button'
import { useSoloAudio } from '@/components/workbench/solo-audio'
import { resolveSoloRange, type SoloRange } from '@/lib/audio-solo'
import { formatClock, formatDuration, formatLongDuration } from '@/lib/format-time'

/** これより長い音は、長さに時計の形を併記する（秒だけだと読み取れない）。 */
const LONG_LENGTH_SEC = 60

/**
 * インスペクターの「この音だけ鳴らす」（制作者 2026-10-19）。プレビューの再生とは別に、この音源 1 本だけを鳴らす。
 *
 * - `range` を渡せばその範囲だけ（効果音のクリップ）。渡さなければ全体（楽曲）
 * - 押すたびに範囲の頭から。停止で止めて頭へ戻す（続きからにはしない）
 * - 鳴らすのはワークベンチに 1 つの再生器（`solo-audio`）。素材ビューアと重ならず、ほかの再生とも同時に鳴らない
 * - 取り外したら（別の物を選んだら）止める
 */
export const AudioSoloButton = ({
  mediaAssetId,
  label,
  range,
}: {
  readonly mediaAssetId: MediaAssetId
  /** 何を鳴らすか（ボタンの読み上げに使う）。 */
  readonly label: string
  readonly range?: SoloRange
}) => {
  const solo = useSoloAudio()
  const key = useId()
  const prepare = solo?.prepare
  const release = solo?.release

  // 押したらすぐ鳴るように読み込んでおく。取り外したら、自分が鳴らしていれば止める。
  useEffect(() => {
    prepare?.(mediaAssetId)
  }, [prepare, mediaAssetId])
  useEffect(
    () => () => {
      release?.(key)
    },
    [release, key],
  )

  if (solo === null) return null
  if (solo.sourceError !== null) {
    return (
      <p role="alert" className="text-xs text-danger">
        {`音源を読めませんでした: ${solo.sourceError}`}
      </p>
    )
  }

  const { playback } = solo
  const mine = solo.active?.key === key
  const playing = mine && playback.isPlaying
  const waiting = solo.pendingKey === key
  const resolved =
    solo.loadedId === mediaAssetId ? resolveSoloRange(range, playback.durationSec) : null
  const length = resolved === null ? null : resolved.outSec - resolved.inSec
  const long = length !== null && length >= LONG_LENGTH_SEC
  const lengthText = length === null ? '' : long ? formatLongDuration(length) : formatDuration(length)
  const elapsed =
    resolved === null || length === null ? 0 : Math.min(Math.max(playback.currentSec - resolved.inSec, 0), length)
  const elapsedText = long ? formatClock(elapsed) : formatDuration(elapsed)

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        aria-pressed={playing}
        aria-label={playing ? `${label}を止める` : `${label}だけを鳴らす`}
        onClick={() => {
          if (playing || waiting) solo.stop()
          else solo.playRange(key, mediaAssetId, range)
        }}
      >
        {playing ? '■ 止める' : '▶ この音だけ鳴らす'}
      </Button>
      <span className="text-xs tabular-nums text-muted">
        {waiting ? '読み込んでいます…' : playing ? `${elapsedText} / ${lengthText}` : lengthText}
      </span>
      {mine && playback.error !== null && (
        <span role="alert" className="text-xs text-danger">
          {playback.error}
        </span>
      )}
      {mine && playback.notice !== null && (
        <span role="status" className="text-xs text-muted">
          {playback.notice}
        </span>
      )}
    </div>
  )
}
