import { MusicTrack, MusicTrackId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PreferencesRoot } from '@/components/preferences-root'
import { LyricSyncSection } from '@/components/workbench/panels/lyric-sync-section'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import { WorkbenchContext, type WorkbenchContextValue } from '@/components/workbench/workbench-context'
import { WorkbenchTransportProvider } from '@/components/workbench/workbench-transport-provider'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { MEDIA_ID, MUSIC_TRACK_ID, PROJECT_ID } from './fixtures'
import { STOPPED, aProject, workbenchValue } from './workbench-fixture'

/**
 * 区切る ⇄ 歌詞を合わせる を替えても、波形の部品（CutEditor）を作り直さない。
 * 作り直すと、まだ Shot にしていない区切りと再生の状態が消える（2026-10-02 の作り直しで入りかけた）。
 */

const api = vi.hoisted(() => ({ updateProject: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

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

const mounts = { count: 0 }
const Probe = () => {
  useEffect(() => {
    mounts.count += 1
  }, [])
  return <p>波形</p>
}

const tree = (value: WorkbenchContextValue, active: boolean) => (
  <PreferencesRoot>
    <WorkbenchContext.Provider value={value}>
      <WorkbenchTransportProvider transport={STOPPED}>
        <ContextMenuHost>
          <LyricSyncSection track={track} analysis={analysis} keyboard active={active}>
            {() => <Probe />}
          </LyricSyncSection>
        </ContextMenuHost>
      </WorkbenchTransportProvider>
    </WorkbenchContext.Provider>
  </PreferencesRoot>
)

describe('LyricSyncSection のモード', () => {
  it('替えても波形の部品は作り直さず、案内と一覧だけを出し入れする', () => {
    mounts.count = 0
    const value = workbenchValue({ project: { ...aProject, lyrics: '一行目\n二行目' } })
    const { rerender } = render(tree(value, false))
    expect(screen.queryByRole('region', { name: '歌詞を合わせる' })).toBeNull()

    rerender(tree(value, true))
    expect(screen.getByRole('region', { name: '歌詞を合わせる' })).toBeTruthy()
    expect(screen.getByText(/フレーズの一覧/)).toBeTruthy()

    rerender(tree(value, false))
    expect(screen.queryByText(/フレーズの一覧/)).toBeNull()
    expect(mounts.count).toBe(1)
  })

  it('打ってから区切るへ替えたら、作品を読み直す（作品の方針の「時刻は n フレーズまで」が追いつく）', async () => {
    const value = workbenchValue({ project: { ...aProject, lyrics: '一行目\n二行目' } })
    const { rerender } = render(tree(value, true))

    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => {
      expect(api.updateProject).toHaveBeenCalled()
    })
    rerender(tree(value, false))

    expect(value.refresh).toHaveBeenCalledTimes(1)
  })
})
