import { z } from 'zod'
import { DEFAULT_VOLUME, clampVolume } from '@/lib/playback-state'

/**
 * 環境設定（UI-WORKBENCH §3.4）。**Project に依らない、この端末のこのブラウザだけの設定。**
 * **React を含まない。**
 *
 * 制作データではないので DB に入れない。`localStorage` の 1 キーにまとめる。
 * 以前はテーマ（`ixa.theme`）と音量（`ixa.playback.*`）が別々のキーに散っていた。
 *
 * 形は「分類 → 項目」。**項目ごとに壊れていても既定へ倒し、残りは読む。**
 * 1 項目が壊れただけで全部が初期値に戻ると、利用者は何が起きたか分からない。
 * 知らない分類は黙って捨てる（後の版で足した分類を古い版が読むことがある）。
 *
 * **入れないもの**: API キー・Provider の接続先。シークレットは env のみ（規約 6）。
 */

export const PREFERENCES_STORAGE_KEY = 'ixa:preferences:v1'

/** 以前の保存先。最初の 1 回だけ読んで移し、消す。 */
export const LEGACY_THEME_KEY = 'ixa.theme'
export const LEGACY_VOLUME_KEY = 'ixa.playback.volume'
export const LEGACY_MUTED_KEY = 'ixa.playback.muted'

export const THEMES = ['dark', 'light'] as const
export type Theme = (typeof THEMES)[number]

export const FONT_SIZES = ['small', 'standard', 'large'] as const
export type FontSize = (typeof FONT_SIZES)[number]

export const DENSITIES = ['standard', 'relaxed'] as const
export type Density = (typeof DENSITIES)[number]

/**
 * 根元の文字の大きさ（px）。尺度はすべて rem なので、ここを動かすと
 * 表の行・タブ・メニューが一緒に伸び縮みする（§5.1）。
 */
export const ROOT_FONT_SIZE_PX: Readonly<Record<FontSize, number>> = Object.freeze({
  small: 15,
  standard: 16,
  large: 18,
})

export const FONT_SIZE_LABELS: Readonly<Record<FontSize, string>> = Object.freeze({
  small: '小',
  standard: '標準',
  large: '大',
})

export const DENSITY_LABELS: Readonly<Record<Density, string>> = Object.freeze({
  standard: '標準',
  relaxed: 'ゆったり',
})

const DisplayPreferences = z.object({
  theme: z.enum(THEMES).catch('dark'),
  fontSize: z.enum(FONT_SIZES).catch('standard'),
  density: z.enum(DENSITIES).catch('standard'),
})

const PlaybackPreferences = z.object({
  // 範囲外は丸め、数でないものは既定へ。音量 0 は正しい値なので残す。
  volume: z.number().catch(DEFAULT_VOLUME).transform(clampVolume),
  muted: z.boolean().catch(false),
  /** 聴きながら切る / タイムラインを開いたときの「拍に吸着」の初期値。 */
  snapToBeat: z.boolean().catch(true),
})

/**
 * 分類が丸ごと無い・壊れているときも既定へ倒す。
 * 分類がオブジェクトでなければ空として読み、項目ごとの `.catch` を効かせる。
 */
const category = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'object' && value !== null ? value : {}), schema)

const PreferencesSchema = z.object({
  display: category(DisplayPreferences),
  playback: category(PlaybackPreferences),
})

export type Preferences = z.infer<typeof PreferencesSchema>

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  display: Object.freeze({ theme: 'dark', fontSize: 'standard', density: 'standard' }),
  playback: Object.freeze({ volume: DEFAULT_VOLUME, muted: false, snapToBeat: true }),
})

/** 何を渡されても `Preferences` を返す。**例外を投げない。** */
export const parsePreferences = (raw: unknown): Preferences => {
  const parsed = PreferencesSchema.safeParse(
    typeof raw === 'object' && raw !== null ? raw : {},
  )
  return parsed.success ? parsed.data : DEFAULT_PREFERENCES
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** `localStorage` に触るだけで例外が出る環境がある。ここで包む。 */
const defaultStorage = (): PreferenceStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 旧キーから組み立てる。1 つも無ければ null（移すものが無い）。 */
const readLegacy = (storage: PreferenceStorage): Preferences | null => {
  const theme = storage.getItem(LEGACY_THEME_KEY)
  const volume = storage.getItem(LEGACY_VOLUME_KEY)
  const muted = storage.getItem(LEGACY_MUTED_KEY)
  if (theme === null && volume === null && muted === null) return null
  return parsePreferences({
    display: { theme },
    playback: {
      volume: volume === null ? undefined : Number.parseFloat(volume),
      muted: muted === 'true',
    },
  })
}

/** 消せなくても読んだ値は使う。旧キーが残るだけで、次も新しいキーが優先される。 */
const removeLegacy = (storage: PreferenceStorage): void => {
  try {
    storage.removeItem(LEGACY_THEME_KEY)
    storage.removeItem(LEGACY_VOLUME_KEY)
    storage.removeItem(LEGACY_MUTED_KEY)
  } catch {
    // 消せない保存がある。続ける。
  }
}

/**
 * 保存を読む。**最初の描画では呼ばないこと**（lessons L-019）。`useEffect` の中で読む。
 *
 * 新しいキーが無く旧キーがあれば、旧キーから組み立てて新しいキーへ移し、旧キーを消す。
 * 新しいキーがあるなら旧キーは読まずに消すだけ（古い値で上書きしない）。
 * 保存に触れない環境（プライベートウィンドウ等）では既定を返す。
 */
export const readPreferences = (storage: PreferenceStorage | null = defaultStorage()): Preferences => {
  if (storage === null) return DEFAULT_PREFERENCES
  try {
    const raw = storage.getItem(PREFERENCES_STORAGE_KEY)
    if (raw !== null) {
      removeLegacy(storage)
      return parsePreferences(parseJson(raw))
    }
    const legacy = readLegacy(storage)
    if (legacy === null) return DEFAULT_PREFERENCES
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(legacy))
    removeLegacy(storage)
    return legacy
  } catch {
    return DEFAULT_PREFERENCES
  }
}

/** 書けなくても何も起きない。覚えられないだけで、見た目の切り替え自体は効く。 */
export const writePreferences = (
  preferences: Preferences,
  storage: PreferenceStorage | null = defaultStorage(),
): void => {
  if (storage === null) return
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // 保存を止めているブラウザ設定がある。続ける。
  }
}

/** 1 項目だけ変えた新しい値を返す。元の値は変えない。 */
export const updateDisplay = (
  current: Preferences,
  patch: Partial<Preferences['display']>,
): Preferences => ({ ...current, display: { ...current.display, ...patch } })

export const updatePlayback = (
  current: Preferences,
  patch: Partial<Preferences['playback']>,
): Preferences => ({ ...current, playback: { ...current.playback, ...patch } })

/** `<html>` に付ける属性。部品は環境設定を直接読まず、これと CSS 変数だけを見る。 */
export const THEME_ATTRIBUTE = 'data-theme'
export const DENSITY_ATTRIBUTE = 'data-density'

/**
 * `<html>` に反映する。DOM が無い環境では何もしない。
 * **反映するのは属性と根元の文字の大きさだけ**（§3.4）。
 */
export const applyPreferences = (
  preferences: Preferences,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void => {
  if (root === null) return
  root.setAttribute(THEME_ATTRIBUTE, preferences.display.theme)
  root.setAttribute(DENSITY_ATTRIBUTE, preferences.display.density)
  root.style.fontSize = `${String(ROOT_FONT_SIZE_PX[preferences.display.fontSize])}px`
}
