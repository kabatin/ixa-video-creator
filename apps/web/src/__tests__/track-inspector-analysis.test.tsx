import { MusicTrack, MusicTrackId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TrackInspector } from '@/components/workbench/inspector/asset-inspectors'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { MEDIA_ID, MUSIC_TRACK_ID, PROJECT_ID } from './fixtures'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 楽曲のインスペクターの「解析」。以前は開いたときに 1 回だけ読み、解析が終わっても「まだ解析されていません。
 * 「再解析」で始めます。」のままだった（解析は登録した直後から自動で走っているのに、押させる文が出ていた）。
 * サーバを読み直したら読み直し、マスターの曲が解析中なら「解析しています」と言う。
 */

const api = vi.hoisted(() => ({ getAnalysis: vi.fn() }))
vi.mock('@/lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...original, createApiClient: () => api }
})

const analysis: WireMusicAnalysis = {
  musicTrackId: MUSIC_TRACK_ID,
  analyzerVersion: 'librosa-v1',
  durationSec: 116,
  bpm: 120,
  bpmConfidence: 0.9,
  beats: [0, 0.5, 1],
  downbeats: [0],
  sections: [{ start: 0, end: 116, label: 'intro', energy: 0.4 }],
  onsets: [0.01],
  drops: [],
  waveformPeaksUrl: 'https://example.invalid/peaks.json',
  createdAt: '2026-01-01T00:00:00.000Z',
}
const track = MusicTrack.parse({
  id: MusicTrackId.parse(MUSIC_TRACK_ID),
  projectId: PROJECT_ID,
  mediaAssetId: MEDIA_ID,
  title: 'iXA CUP',
  isMaster: true,
  offsetSec: 0,
  volume: 1,
})

describe('TrackInspector の解析', () => {
  it('マスターの曲がまだ解析中なら「解析しています」と言い、読み直したら結果を出す', async () => {
    api.getAnalysis.mockResolvedValueOnce(null).mockResolvedValue(analysis)
    const view = renderInWorkbench(
      <TrackInspector id={track.id} />,
      { track, analysis: null, serverEpoch: 0 },
      { tracks: { state: 'ready', value: [track] } },
    )

    expect(await screen.findByText(/解析しています/)).toBeTruthy()
    expect(screen.queryByText(/まだ解析されていません/)).toBeNull()

    view.rerenderWith({ analysis, serverEpoch: 1 })

    await waitFor(() => {
      expect(screen.getByText('120.0')).toBeTruthy()
    })
  })
})
