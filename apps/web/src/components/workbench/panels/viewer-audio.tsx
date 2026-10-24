'use client'

import type { MediaAssetId, MusicTrackId, VoiceProfileId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { AudioTransport } from '@/components/audio-transport'
import { WaveformCanvas } from '@/components/waveform-canvas'
import { WaveformPlayhead } from '@/components/waveform-playhead'
import { readyOr, useAssets } from '@/components/workbench/asset-store'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { useSfxAssets } from '@/components/workbench/sfx-assets'
import { useSoloAudio } from '@/components/workbench/solo-audio'
import { VoicePreview } from '@/components/workbench/voice-preview'
import { createApiClient } from '@/lib/api-client'
import { formatSpan } from '@/lib/format-time'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { fetchWaveformPeaks, type WaveformPeaksResult } from '@/lib/waveform-api'
import { sectionBoundaries } from '@/lib/waveform-draw'

/**
 * 素材ビューアの音の素材（楽曲・声・効果音）。**聴いて確かめる場所。** 直すのは右のインスペクター。
 */

/** 素材ビューアの試聴が名乗る名前（インスペクターの「この音だけ鳴らす」と区別する）。 */
const VIEWER_KEY = 'viewer'

/**
 * 音源 1 本を鳴らす。鳴らすのはワークベンチに 1 つの再生器（`solo-audio`）で、インスペクターの
 * 「この音だけ鳴らす」と同じ `<audio>`・同じ URL を使う（重ならない・取り直しは 1 回）。
 * 再生ボタンはこの音源だけを鳴らす（プレビューの共通ボタンとは別。鳴らすとプレビューは止まる）。
 */
const AudioPreview = ({ mediaAssetId, label }: { readonly mediaAssetId: MediaAssetId; readonly label: string }) => {
  const solo = useSoloAudio()
  const prepare = solo?.prepare
  const release = solo?.release
  useEffect(() => {
    prepare?.(mediaAssetId)
  }, [prepare, mediaAssetId])
  useEffect(
    () => () => {
      release?.(VIEWER_KEY)
    },
    [release],
  )

  if (solo === null) return null
  if (solo.sourceError !== null) {
    return (
      <p role="alert" className="text-sm text-danger">
        {`音源を読めませんでした: ${solo.sourceError}`}
      </p>
    )
  }
  if (solo.loadedId !== mediaAssetId) return <p className="text-sm text-muted">音源を読み込んでいます…</p>
  const { playback } = solo
  // 鳴らすときは再生器に「素材ビューアが全体を鳴らす」と伝える（範囲の止めを外す）。
  const viewerPlayback = {
    ...playback,
    play: () => {
      solo.playFree(VIEWER_KEY, mediaAssetId)
    },
    toggle: () => {
      if (playback.isPlaying) playback.pause()
      else solo.playFree(VIEWER_KEY, mediaAssetId)
    },
  }
  // 空白キーはワークベンチ全体の再生に割り当て済み。ここでは奪わない。
  // 音量はステータスバーにひとつだけ置く（ここには出さない）。
  return (
    <AudioTransport
      playback={viewerPlayback}
      label={label}
      layout="inline"
      keyboardShortcuts={false}
      showVolume={false}
    />
  )
}

export const TrackView = ({ id }: { readonly id: MusicTrackId }) => {
  const api = useMemo(() => createApiClient(), [])
  const { tracks } = useAssets()
  const track = (tracks.state === 'ready' ? tracks.value : []).find((item) => item.id === id)
  const [analysis, setAnalysis] = useState<WireMusicAnalysis | null | 'loading'>('loading')
  const [peaks, setPeaks] = useState<WaveformPeaksResult>({ status: 'empty' })
  const solo = useSoloAudio()

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
          >
            {/* 鳴らしている音源がこの楽曲のときだけ線を引く（再生器はワークベンチに 1 つで、別の音のこともある）。 */}
            {solo !== null && solo.loadedId === track.mediaAssetId && (
              <WaveformPlayhead
                currentSec={solo.playback.currentSec}
                durationSec={analysis.durationSec}
                onSeek={solo.playback.seekTo}
              />
            )}
          </WaveformCanvas>
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

/** 効果音（ADR-0052）。音 1 本を頭から終わりまで聴く。置いた位置を添える（直すのは置いたクリップ）。 */
export const SfxView = ({ id }: { readonly id: MediaAssetId }) => {
  const sfx = useSfxAssets()
  if (sfx === null || sfx.state === 'loading') return <p className="text-sm text-muted">効果音を読み込んでいます…</p>
  if (sfx.state === 'error') return <PanelEmpty title="効果音を読めませんでした" hint={sfx.message} />
  const item = sfx.value.find((candidate) => candidate.mediaAssetId === id)
  if (item === undefined) return <PanelEmpty title="この効果音は見つかりません" />
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-text">{item.label}</h2>
      <AudioPreview mediaAssetId={item.mediaAssetId} label={item.label} />
      <p className="text-sm text-muted">
        {item.placements.length === 0
          ? 'タイムラインにはまだ置いていません。'
          : `置いた位置: ${item.placements.map((placement) => formatSpan(placement.startSec, placement.durationSec)).join('、')}`}
      </p>
    </div>
  )
}
