import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VOLUME } from '@/lib/playback-state'
import { PREFERENCES_STORAGE_KEY } from '@/lib/preferences'
import { useAudioPlayback } from '@/lib/use-audio-playback'

/**
 * **最初の描画は、サーバが描いたものと一致しなければならない。**
 *
 * この画面はサーバでも描かれる。サーバに `localStorage` は無いので音量は既定になる。
 * 最初の描画で覚え書きを読むと食い違い、React が木ごと作り直す。
 * 実際に「消音」と「消音を解除」で不一致が出た。
 */

const store = new Map<string, string>()

/** 環境設定の保存形式（PHASE 7.1）。音量は「再生」分類にある。 */
const SAVED = JSON.stringify({ playback: { volume: 0.3, muted: true, snapToBeat: true } })

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 描画のたびに音量を書き留める見張り。1 回目の値が要点。 */
const Probe = ({ seen }: { readonly seen: number[] }) => {
  const playback = useAudioPlayback({ source: null })
  seen.push(playback.volume)
  return <output>{String(playback.muted)}</output>
}

describe('覚えた音量の読み込み', () => {
  it('最初の描画では覚え書きを読まない', () => {
    store.set(PREFERENCES_STORAGE_KEY, SAVED)
    const seen: number[] = []

    render(<Probe seen={seen} />)

    // サーバは localStorage を見られないので既定で描く。ここが違うと不一致になる。
    expect(seen[0]).toBe(DEFAULT_VOLUME)
  })

  it('描画のあとで覚え書きが効く', () => {
    store.set(PREFERENCES_STORAGE_KEY, SAVED)
    const seen: number[] = []

    render(<Probe seen={seen} />)

    expect(seen.at(-1)).toBe(0.3)
    expect(screen.getByText('true')).toBeInTheDocument()
  })

  it('覚え書きが無ければ既定のまま', () => {
    const seen: number[] = []

    render(<Probe seen={seen} />)

    expect(seen.at(-1)).toBe(DEFAULT_VOLUME)
    expect(screen.getByText('false')).toBeInTheDocument()
  })

  /**
   * 読み込む前の既定値で覚え書きを潰さないこと。
   * 状態の変化に合わせて書くと、起動しただけで覚えた値が消える。
   */
  it('開いただけでは覚え書きを書き換えない', () => {
    store.set(PREFERENCES_STORAGE_KEY, SAVED)

    render(<Probe seen={[]} />)

    expect(store.get(PREFERENCES_STORAGE_KEY)).toBe(SAVED)
  })
})
