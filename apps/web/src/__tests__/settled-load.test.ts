import { describe, expect, it } from 'vitest'
import { loadedFromSettled } from '@/lib/settled-load'

/**
 * 素材の一覧をまとめて読み直す（取り消しの後）とき、**1 つ読めなくても他は反映する**（2026-10-19 のレビュー）。
 * 読めなかった一覧は「読めなかった」として理由を出す（黙って古いまま残さない・L-015）。
 */
describe('loadedFromSettled', () => {
  it('読めた一覧はそのまま反映する', () => {
    expect(loadedFromSettled('声', { status: 'fulfilled', value: [1, 2] })).toEqual({ state: 'ready', value: [1, 2] })
  })

  it('読めなかった一覧は、何が読めなかったかと理由を出す', () => {
    const loaded = loadedFromSettled('声', { status: 'rejected', reason: new Error('通信が切れました') })
    expect(loaded.state).toBe('error')
    expect(loaded.state === 'error' ? loaded.message : '').toMatch(/^声を読み込めませんでした: /)
  })
})
