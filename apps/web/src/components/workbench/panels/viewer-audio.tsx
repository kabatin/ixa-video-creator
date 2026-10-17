'use client'

import type { MediaAssetId, MusicTrackId, VoiceProfileId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AudioTransport } from '@/components/audio-transport'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { VoicePreview } from '@/components/workbench/voice-preview'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { AUDIO_URL_EXPIRES_IN_SEC, type SignedSource } from '@/lib/playback-state'
import { useAudioPlayback } from '@/lib/use-audio-playback'
import { fetchWaveformPeaks, type WaveformPeaksResult } from '@/lib/waveform-api'
import { sectionBoundaries } from '@/lib/waveform-draw'

/**
 * 素材ビューアの音の素材（楽曲・声）。**聴いて確かめる場所。** 直すのは右のインスペクター。
 */

/**
 * 音源 1 本を鳴らす。URL は期限を明示して取り、切れたら取り直す（規約 7）。
 * 再生ボタンはこの音源だけを鳴らす（プレビューの共通ボタンとは別）。
 */
const AudioPreview = ({ mediaAssetId, label }: { readonly mediaAssetId: MediaAssetId; readonly label: string }) => {
  const loadSource = useCallback(
    async (): Promise<SignedSource> => createApiClient().mediaUrl(mediaAssetId, AUDIO_URL_EXPIRES_IN_SEC),
    [mediaAssetId],
  )
  const [source, setSource] = useState<SignedSource | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSource(null)
    setSourceError(null)
    loadSource()
      .then((next) => {
        if (!cancelled) setSource(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setSourceError(describeForPerson(cause))
      })
    return () => {
      cancelled = true
    }
  }, [loadSource])

  const playback = useAudioPlayback({ source, onRefreshSource: loadSource })
  if (sourceError !== null) {
    return (
      <p role="alert" className="text-sm text-danger">
        {`音源を読めませんでした: ${sourceError}`}
      </p>
    )
  }
  // 空白キーはワークベンチ全体の再生に割り当て済み。ここでは奪わない。
  // 音量はステータスバーにひとつだけ置く（ここには出さない）。
  return (
    <AudioTransport playback={playback} label={label} layout="inline" keyboardShortcuts={false} showVolume={false} />
  )
}

export const TrackView = ({ id }: { readonly id: MusicTrackId }) => {
  const api = useMemo(() => createApiClient(), [])
  const { tracks } = useAssets()
  const track = (tracks.state === 'ready' ? tracks.value : []).find((item) => item.id === id)
  const [analysis, setAnalysis] = useState<WireMusicAnalysis | null | 'loading'>('loading')
  const [peaks, setPeaks] = useState<WaveformPeaksResult>({ status: 'empty' })

  useEffect(() => {
    let cancelled = false
    setAnalysis('loading')
    api
      .getAnalysis(id)
      .then(async (loaded) => {
        if (cancelled) return
        setAnalysis(loaded)
        if (loaded !== null) {
          const result = await fetchWaveformPeaks(loaded.waveformPeaksUrl)
          if (!cancelled) setPeaks(result)
        }
      })
      .catch(() => {
        if (!cancelled) setAnalysis(null)
      })
    return () => {
      cancelled = true
    }
  }, [api, id])

  if (track === undefined) return <PanelEmpty title="この楽曲は見つかりません" />
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-text">
        {track.title}
        {track.isMaster && <span className="ml-2 text-xs text-muted">マスター</span>}
      </h2>
      <AudioPreview mediaAssetId={track.mediaAssetId} label={track.title} />
      {analysis === 'loading' && <p className="text-sm text-muted">解析を読み込んでいます…</p>}
      {analysis === null && (
        <p className="text-sm text-muted">
          まだ解析されていません。右のインスペクターから解析できます。
        </p>
      )}
      {analysis !== null && analysis !== 'loading' && (
        <>
          <WaveformCanvas
            peaks={peaks}
            durationSec={analysis.durationSec}
            beats={analysis.beats}
            downbeats={analysis.downbeats}
            drops={analysis.drops}
            sectionBoundarySec={sectionBoundaries(analysis.sections)}
            heightPx={120}
          />
          <p className="text-sm text-muted">
            {`BPM ${analysis.bpm.toFixed(1)}（信頼度 ${analysis.bpmConfidence.toFixed(2)}）・拍 ${String(analysis.beats.length)}・小節 ${String(analysis.downbeats.length)}・セクション ${String(analysis.sections.length)}・ドロップ ${String(analysis.drops.length)}`}
          </p>
        </>
      )}
    </div>
  )
}

/** 声（ADR-0038）。声そのものに音源は無いので、好きな一文を読ませて聴く。 */
export const VoiceView = ({ id }: { readonly id: VoiceProfileId }) => {
  const { voices } = useAssets()
  const voice = readyOr(voices).find((item) => item.id === id)
  if (voice === undefined) return <PanelEmpty title="この声は見つかりません" />
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-text">{voice.name}</h2>
      <VoicePreview voiceId={id} />
    </div>
  )
}
