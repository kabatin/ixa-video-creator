'use client'

import type { MusicTrackId } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { fetchWaveformPeaks, type WaveformPeaksResult } from '@/lib/waveform-api'

/**
 * 波形の点を、**取る直前に発行した URL で**取る（2026-10-18）。
 *
 * 以前はワークベンチのページを描いたときの解析（`waveformPeaksUrl`、期限 300 秒）を持ち回し、
 * タイムラインと聴きながら切るが開いたときにその URL で取っていた。ページを開いて 5 分を過ぎてから
 * パネルを開くと 403 になり、タイムラインの波形の帯が黙って消えた。
 * 楽曲を見る画面（`viewer-audio.tsx`）は解析を引き直してから取っており、そちらに揃える。
 *
 * **取れなかったら 1 回だけ、新しい URL で取り直す。** 発行と取得の間に切れることはまず無いが、
 * 通信の瞬断で帯ごと消すのは割に合わない。2 回目も駄目なら理由を返す（回り続けない）。
 */

export type FreshPeaksPorts = {
  /** その場で発行した URL。解析がまだ無ければ null。 */
  readonly issueUrl: () => Promise<string | null>
  readonly fetchPeaks: (url: string, signal: AbortSignal) => Promise<WaveformPeaksResult>
}

/** 解析が無い・取れないときの文。帯を出さない理由として残す（L-015）。 */
export const NO_ANALYSIS_MESSAGE = '楽曲の解析が見つかりませんでした。'

const attemptOnce = async (ports: FreshPeaksPorts, signal: AbortSignal): Promise<WaveformPeaksResult> => {
  let url: string | null
  try {
    url = await ports.issueUrl()
  } catch (caught) {
    return { status: 'failed', message: `楽曲の解析を読めませんでした — ${describeError(caught)}` }
  }
  if (url === null) return { status: 'failed', message: NO_ANALYSIS_MESSAGE }
  return ports.fetchPeaks(url, signal)
}

export const fetchFreshWaveformPeaks = async (
  ports: FreshPeaksPorts,
  signal: AbortSignal,
): Promise<WaveformPeaksResult> => {
  const first = await attemptOnce(ports, signal)
  if (first.status !== 'failed' || signal.aborted) return first
  return attemptOnce(ports, signal)
}

/**
 * 楽曲の波形の点。`trackId` が null なら取らない。
 * `analysisKey` が変わったら（解析し直したら）取り直す。**取得中は null。**
 */
export const useFreshWaveformPeaks = (
  trackId: MusicTrackId | null,
  analysisKey: string | null,
): WaveformPeaksResult | null => {
  /** どの楽曲・解析の点か。**取り直している間は前の楽曲の点を返さない**（違う曲の波形を描かない）。 */
  const key = `${trackId ?? ''}|${analysisKey ?? ''}`
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly result: WaveformPeaksResult } | null>(null)
  useEffect(() => {
    if (trackId === null) return undefined
    const controller = new AbortController()
    const api = createApiClient()
    const ports: FreshPeaksPorts = {
      issueUrl: async () => (await api.getAnalysis(trackId))?.waveformPeaksUrl ?? null,
      fetchPeaks: (url, signal) => fetchWaveformPeaks(url, { signal }),
    }
    void fetchFreshWaveformPeaks(ports, controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoaded({ key, result })
    })
    return () => {
      controller.abort()
    }
  }, [trackId, analysisKey, key])
  return loaded?.key === key ? loaded.result : null
}
