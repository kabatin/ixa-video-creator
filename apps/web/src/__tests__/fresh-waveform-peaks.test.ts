import { describe, expect, it, vi } from 'vitest'
import { NO_ANALYSIS_MESSAGE, fetchFreshWaveformPeaks, type FreshPeaksPorts } from '@/lib/fresh-waveform-peaks'
import type { WaveformPeaksResult } from '@/lib/waveform-api'

/**
 * 波形の点は取る直前に発行した URL で取る（2026-10-18）。ページを描いたときの URL（5 分）を持ち回すと、
 * 5 分を過ぎてから開いたパネルで 403 になり、タイムラインの波形の帯が黙って消えた。
 */

const OK: WaveformPeaksResult = { status: 'ok', peaks: [0.5], bands: null }
const FAILED: WaveformPeaksResult = { status: 'failed', message: '波形データの取得に失敗しました（HTTP 403）。' }

const portsWith = (urls: readonly (string | null)[], results: readonly WaveformPeaksResult[]) => {
  const issueUrl = vi.fn<FreshPeaksPorts['issueUrl']>()
  urls.forEach((url) => issueUrl.mockResolvedValueOnce(url))
  const fetchPeaks = vi.fn<FreshPeaksPorts['fetchPeaks']>()
  results.forEach((result) => fetchPeaks.mockResolvedValueOnce(result))
  return { issueUrl, fetchPeaks }
}

describe('fetchFreshWaveformPeaks', () => {
  it('その場で発行した URL で取る', async () => {
    const ports = portsWith(['https://example.invalid/fresh'], [OK])

    const result = await fetchFreshWaveformPeaks(ports, new AbortController().signal)

    expect(result).toEqual(OK)
    expect(ports.issueUrl).toHaveBeenCalledTimes(1)
    expect(ports.fetchPeaks.mock.calls[0]?.[0]).toBe('https://example.invalid/fresh')
  })

  it('取れなければ 1 回だけ新しい URL で取り直す', async () => {
    const ports = portsWith(['https://example.invalid/1', 'https://example.invalid/2'], [FAILED, OK])

    const result = await fetchFreshWaveformPeaks(ports, new AbortController().signal)

    expect(result).toEqual(OK)
    expect(ports.issueUrl).toHaveBeenCalledTimes(2)
    expect(ports.fetchPeaks.mock.calls[1]?.[0]).toBe('https://example.invalid/2')
  })

  it('2 回目も駄目なら理由を返し、それ以上は叩かない', async () => {
    const ports = portsWith(['https://example.invalid/1', 'https://example.invalid/2'], [FAILED, FAILED])

    const result = await fetchFreshWaveformPeaks(ports, new AbortController().signal)

    expect(result).toEqual(FAILED)
    expect(ports.fetchPeaks).toHaveBeenCalledTimes(2)
  })

  it('解析が無ければ取らずに理由を返す', async () => {
    const ports = portsWith([null, null], [])

    const result = await fetchFreshWaveformPeaks(ports, new AbortController().signal)

    expect(result).toEqual({ status: 'failed', message: NO_ANALYSIS_MESSAGE })
    expect(ports.fetchPeaks).not.toHaveBeenCalled()
  })

  it('解析を引けなかった理由を残す（黙って帯を消さない）', async () => {
    const issueUrl = vi.fn<FreshPeaksPorts['issueUrl']>().mockRejectedValue(new Error('HTTP 500'))
    const fetchPeaks = vi.fn<FreshPeaksPorts['fetchPeaks']>()

    const result = await fetchFreshWaveformPeaks({ issueUrl, fetchPeaks }, new AbortController().signal)

    expect(result.status).toBe('failed')
    expect(result.status === 'failed' ? result.message : '').toContain('HTTP 500')
  })

  it('画面を離れたあとは取り直さない', async () => {
    const controller = new AbortController()
    const ports = portsWith(['https://example.invalid/1'], [FAILED])
    ports.fetchPeaks.mockReset()
    ports.fetchPeaks.mockImplementationOnce(() => {
      controller.abort()
      return Promise.resolve(FAILED)
    })

    await fetchFreshWaveformPeaks(ports, controller.signal)

    expect(ports.issueUrl).toHaveBeenCalledTimes(1)
  })
})
