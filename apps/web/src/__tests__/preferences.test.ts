import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCES,
  LEGACY_MUTED_KEY,
  LEGACY_THEME_KEY,
  LEGACY_VOLUME_KEY,
  PREFERENCES_STORAGE_KEY,
  ROOT_FONT_SIZE_PX,
  parsePreferences,
  readPreferences,
  updateDisplay,
  writePreferences,
  type PreferenceStorage,
} from '@/lib/preferences'

/**
 * 環境設定（UI-WORKBENCH §3.4 / §10）。
 * 壊れた値は既定、旧キーは移して消す、知らない分類は無視して残りを読む。
 */

const memoryStorage = (): PreferenceStorage & { readonly store: Map<string, string> } => {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
  }
}

describe('parsePreferences', () => {
  it.each([null, undefined, 'dark', 42, []])('形が違う値（%s）は既定', (raw) => {
    expect(parsePreferences(raw)).toEqual(DEFAULT_PREFERENCES)
  })

  it('1 項目が壊れていても残りは読む', () => {
    const parsed = parsePreferences({
      display: { theme: 'light', fontSize: 'huge', density: 'relaxed' },
      playback: { volume: 0.4, muted: 'yes', snapToBeat: false },
    })
    expect(parsed.display).toEqual({ theme: 'light', fontSize: 'standard', density: 'relaxed' })
    expect(parsed.playback).toEqual({ volume: 0.4, muted: false, snapToBeat: false })
  })

  it('知らない分類は無視して残りを読む', () => {
    const parsed = parsePreferences({
      shortcuts: { undo: 'z' },
      display: { theme: 'light', fontSize: 'large' },
    })
    expect(parsed.display.theme).toBe('light')
    expect(parsed.display.fontSize).toBe('large')
    expect(parsed).not.toHaveProperty('shortcuts')
  })

  it('分類が丸ごと壊れていても既定で埋める', () => {
    expect(parsePreferences({ display: 'light', playback: null })).toEqual(DEFAULT_PREFERENCES)
  })

  it('音量は範囲に丸め、0 は残す', () => {
    expect(parsePreferences({ playback: { volume: 9 } }).playback.volume).toBe(1)
    expect(parsePreferences({ playback: { volume: 0 } }).playback.volume).toBe(0)
  })
})

describe('readPreferences', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    storage = memoryStorage()
  })

  it('保存が無ければ既定', () => {
    expect(readPreferences(storage)).toEqual(DEFAULT_PREFERENCES)
  })

  it('壊れた JSON は既定', () => {
    storage.setItem(PREFERENCES_STORAGE_KEY, '{not json')
    expect(readPreferences(storage)).toEqual(DEFAULT_PREFERENCES)
  })

  it('書いたものを読み戻せる', () => {
    const next = updateDisplay(DEFAULT_PREFERENCES, { theme: 'light', fontSize: 'large' })
    writePreferences(next, storage)
    expect(readPreferences(storage)).toEqual(next)
  })

  it('旧キー ixa.theme があれば移して消す', () => {
    storage.setItem(LEGACY_THEME_KEY, 'light')
    storage.setItem(LEGACY_VOLUME_KEY, '0.3')
    storage.setItem(LEGACY_MUTED_KEY, 'true')

    const read = readPreferences(storage)

    expect(read.display.theme).toBe('light')
    expect(read.playback).toMatchObject({ volume: 0.3, muted: true })
    expect(storage.store.has(LEGACY_THEME_KEY)).toBe(false)
    expect(storage.store.has(LEGACY_VOLUME_KEY)).toBe(false)
    expect(storage.store.has(LEGACY_MUTED_KEY)).toBe(false)
    // 移した先から読み直しても同じ
    expect(readPreferences(storage)).toEqual(read)
  })

  it('新しいキーがあるなら旧キーで上書きしない', () => {
    writePreferences(updateDisplay(DEFAULT_PREFERENCES, { theme: 'dark' }), storage)
    storage.setItem(LEGACY_THEME_KEY, 'light')

    expect(readPreferences(storage).display.theme).toBe('dark')
    expect(storage.store.has(LEGACY_THEME_KEY)).toBe(false)
  })

  it('保存に触れなくても落ちない', () => {
    const broken: PreferenceStorage = {
      getItem: () => {
        throw new Error('保存は使えません')
      },
      setItem: () => {
        throw new Error('保存は使えません')
      },
      removeItem: () => undefined,
    }
    expect(readPreferences(broken)).toEqual(DEFAULT_PREFERENCES)
    expect(() => {
      writePreferences(DEFAULT_PREFERENCES, broken)
    }).not.toThrow()
  })
})

describe('文字の大きさ', () => {
  it('小 / 標準 / 大 = 15 / 16 / 18px', () => {
    expect(ROOT_FONT_SIZE_PX).toEqual({ small: 15, standard: 16, large: 18 })
  })
})
