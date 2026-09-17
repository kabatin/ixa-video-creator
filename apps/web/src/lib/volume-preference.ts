import { DEFAULT_VOLUME, clampVolume } from '@/lib/playback-state'

/**
 * 音量の覚え書き。**この端末のこのブラウザにだけ残る。**
 *
 * 切る作業では画面を何度も開き直す。そのたびに音量が最大へ戻ると、
 * 不意に大きな音が出る。覚えておく価値はあるが、覚えられなくても作業は続けられるので、
 * 読み書きの失敗はすべて既定値に倒して黙って流す。
 *
 * プライベートウィンドウや保存を止めている設定では `localStorage` に
 * 触るだけで例外が出る。**必ず try/catch で包むこと。**
 */

const VOLUME_KEY = 'ixa.playback.volume'
const MUTED_KEY = 'ixa.playback.muted'

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
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_VOLUME_PREFERENCE
    const raw = localStorage.getItem(VOLUME_KEY)
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw)
    return {
      // 壊れた値は `clampVolume` が既定へ倒す。0 は正しい値なので残す。
      volume: clampVolume(parsed),
      muted: localStorage.getItem(MUTED_KEY) === 'true',
    }
  } catch {
    return DEFAULT_VOLUME_PREFERENCE
  }
}

/** 書けなくても何も起きない。音量が残らないだけで、再生には影響しない。 */
export const writeVolumePreference = (preference: VolumePreference): void => {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(VOLUME_KEY, String(clampVolume(preference.volume)))
    localStorage.setItem(MUTED_KEY, preference.muted ? 'true' : 'false')
  } catch {
    // 保存できないブラウザ設定がある。覚えられないだけなので続ける。
  }
}
