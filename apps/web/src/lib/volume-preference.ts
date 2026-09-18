import { DEFAULT_VOLUME, clampVolume } from '@/lib/playback-state'
import { readPreferences, updatePlayback, writePreferences } from '@/lib/preferences'

/**
 * 音量の覚え書き。**この端末のこのブラウザにだけ残る。**
 *
 * 切る作業では画面を何度も開き直す。そのたびに音量が最大へ戻ると、
 * 不意に大きな音が出る。覚えておく価値はあるが、覚えられなくても作業は続けられるので、
 * 読み書きの失敗はすべて既定値に倒して黙って流す。
 *
 * **保存先は環境設定（`preferences.ts`）の「再生」分類。** 以前は専用のキーを持っていた。
 */

export type VolumePreference = {
  readonly volume: number
  readonly muted: boolean
}

export const DEFAULT_VOLUME_PREFERENCE: VolumePreference = {
  volume: DEFAULT_VOLUME,
  muted: false,
}

/** 読めなければ既定。**「保存が無い」と「読めない」を区別しない** — どちらも既定でよい。 */
export const readVolumePreference = (): VolumePreference => {
  const { volume, muted } = readPreferences().playback
  return { volume, muted }
}

/** 書けなくても何も起きない。音量が残らないだけで、再生には影響しない。 */
export const writeVolumePreference = (preference: VolumePreference): void => {
  writePreferences(
    updatePlayback(readPreferences(), {
      volume: clampVolume(preference.volume),
      muted: preference.muted,
    }),
  )
}
