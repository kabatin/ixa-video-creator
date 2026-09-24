'use client'

import { describeVolume } from '@/lib/playback-state'
import { usePlaybackVolume } from '@/lib/use-playback-volume'

/**
 * 音量と消音。**画面にひとつだけ、上の帯の右側に置く。**
 *
 * 持ち主は環境設定（`usePlaybackVolume`）で、鳴らす側（聴きながら切るの `<audio>` と
 * プレビューの Player）は両方ともそこから引く。以前は「聴きながら切る」だけが持っていて、
 * 15% にしてもプレビューは 100% で鳴った。
 *
 * 置き場所は一度ステータスバーにしたが、画面の最下段は目が行かない。
 * 作業中に何度も触るものではないので、上の帯の端にひとつあれば足りる。
 */
export const VolumeControl = () => {
  const { volume, muted, setVolume, toggleMute } = usePlaybackVolume()

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        aria-pressed={muted}
        aria-label={muted ? '消音を解除' : '消音'}
        title={muted ? '消音を解除' : '消音'}
        onClick={toggleMute}
        className="inline-flex h-6 min-w-6 items-center justify-center rounded hover:bg-surface-2 hover:text-text"
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        aria-label="音量"
        aria-valuetext={describeVolume(volume, muted)}
        onChange={(event) => {
          // 消音したまま音量を動かしたら、鳴らしたいということ。消音を解く。
          if (muted) toggleMute()
          setVolume(Number.parseFloat(event.target.value))
        }}
        className="h-1 w-20 accent-accent"
      />
    </span>
  )
}
