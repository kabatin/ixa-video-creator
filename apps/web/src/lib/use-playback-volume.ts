'use client'

import { useCallback, useMemo } from 'react'
import { usePreferences } from '@/components/preferences-root'
import { clampVolume } from '@/lib/playback-state'
import { updatePlayback } from '@/lib/preferences'

/**
 * 音量と消音。**画面にひとつだけ。**
 *
 * 以前は「聴きながら切る」の `<audio>` が自分で持ち、環境設定へ直接読み書きしていた。
 * プレビュー（Remotion Player）はそれを一度も見ていなかったので、
 * **音量を 15% にしてもプレビューは 100% で鳴った**（実測）。
 * 曲を聴きながら切る道具で不意に最大音量が出るのは、作業として通らない。
 *
 * 持ち主を環境設定（`PreferencesRoot`）に一本化して、鳴らす側は全員ここから引く。
 * 片方だけ直す余地を残さないため、**引く口はこの 1 つにする**。
 */
export type PlaybackVolume = {
  readonly volume: number
  readonly muted: boolean
  readonly setVolume: (value: number) => void
  readonly toggleMute: () => void
  /** 要素にそのまま入れる実効音量。消音なら 0。`<audio>`/Player の両方がこれを使う。 */
  readonly effectiveVolume: number
}

export const usePlaybackVolume = (): PlaybackVolume => {
  const { preferences, setPreferences } = usePreferences()
  const { volume, muted } = preferences.playback

  const setVolume = useCallback(
    (value: number): void => {
      // 丸めてから持つ。範囲外のまま持つと、要素へ入れる側で毎回考えることになる。
      setPreferences(updatePlayback(preferences, { volume: clampVolume(value) }))
    },
    [preferences, setPreferences],
  )

  const toggleMute = useCallback((): void => {
    setPreferences(updatePlayback(preferences, { muted: !muted }))
  }, [muted, preferences, setPreferences])

  return useMemo(
    () => ({
      volume,
      muted,
      setVolume,
      toggleMute,
      effectiveVolume: muted ? 0 : clampVolume(volume),
    }),
    [muted, setVolume, toggleMute, volume],
  )
}
