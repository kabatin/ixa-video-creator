import type { MusicTrackId } from '@ixa/domain'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFreshWaveformPeaks } from '@/lib/fresh-waveform-peaks'
import type { WaveformPeaksResult } from '@/lib/waveform-api'

/** 楽曲を替えたら、取り直している間は前の楽曲の波形を返さない（違う曲の波形を描かない）。 */

const peaksByUrl = vi.hoisted(() => new Map<string, (result: WaveformPeaksResult) => void>())
vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({
    getAnalysis: (trackId: string) => Promise.resolve({ waveformPeaksUrl: `https://example.invalid/${trackId}` }),
  }),
}))
vi.mock('@/lib/waveform-api', () => ({
  fetchWaveformPeaks: (url: string) =>
    new Promise<WaveformPeaksResult>((resolve) => {
      peaksByUrl.set(url, resolve)
    }),
}))

const A = 'track-a' as MusicTrackId
const B = 'track-b' as MusicTrackId
const PEAKS_A: WaveformPeaksResult = { status: 'ok', peaks: [0.1], bands: null }

const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useFreshWaveformPeaks', () => {
  it('楽曲を替えたら、新しい点が届くまで null（前の楽曲の点を返さない）', async () => {
    const { result, rerender } = renderHook(({ id }) => useFreshWaveformPeaks(id, 'analysis'), {
      initialProps: { id: A },
    })
    await settle()
    await act(async () => {
      peaksByUrl.get('https://example.invalid/track-a')?.(PEAKS_A)
      await Promise.resolve()
    })
    expect(result.current).toEqual(PEAKS_A)

    rerender({ id: B })

    expect(result.current).toBeNull()
  })
})
