import { MusicTrack, MusicTrackId, ProjectId, Shot, ShotId } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoryboardPanel } from '@/components/workbench/panels/storyboard-panel'
import { TimelineEditor } from '@/components/timeline-editor'
import type { WireTimelineBeatAlignment } from '@/lib/beat-alignment-view'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { MEDIA_ID, MUSIC_TRACK_ID, PROJECT_ID, shotJson } from './fixtures'
import { renderInWorkbench } from './workbench-fixture'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

/**
 * **繋ぎ目だけが壊れる不具合**を止めるための検査（lessons L-021）。
 *
 * 部品のテストも型検査も素通りしたまま、親が値を渡していないだけで
 * 画面に何も出ない、という壊れ方をする。ここで確かめるのは 1 点だけ:
 * **ページが受け取った整列が、帯の要約まで届いているか。**
 */

const aShot = (startSec: number, index: number): Shot =>
  Shot.parse({
    ...shotJson,
    id: ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(index).padStart(2, '0')}`),
    code: `S01-${String(index).padStart(3, '0')}`,
    startSec,
    durationSec: 0.5,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
  })

const shots = [aShot(0, 1), aShot(1.4, 2)]

const alignment: WireTimelineBeatAlignment = {
  source: 'available',
  trackTitle: 'iXA CUP',
  shots: [
    { shotId: shots[0]?.id ?? ShotId.parse(shotJson.id), atSec: 0, nearestBeatSec: 0, driftSec: 0, alignment: 'on_downbeat' },
    { shotId: shots[1]?.id ?? ShotId.parse(shotJson.id), atSec: 1.4, nearestBeatSec: 1.5, driftSec: -0.1, alignment: 'off_beat' },
  ],
}

const renderEditor = (beatAlignment: WireTimelineBeatAlignment | null) =>
  render(
    <TimelineEditor
      projectId={ProjectId.parse(PROJECT_ID)}
      shots={shots}
      initialTransitions={[]}
      initialClips={[]}
      renderedShotIds={shots.map((shot) => shot.id)}
      initialIssues={[]}
      documentDurationSec={4}
      initialDocument={null}
      beatSource={{ state: 'no_track' }}
      beatAlignment={beatAlignment}
      loadErrors={[]}
    />,
  )

describe('タイムライン画面への配線', () => {
  it('サーバから来た整列が帯の要約まで届く', () => {
    renderEditor(alignment)
    expect(screen.getByText(/2 件中 1 件が拍から外れています/)).toBeTruthy()
  })

  it('整列を読めていないときは、色も要約も出さない', () => {
    // 読めなかった事実はページ側が `loadErrors` に載せる。ここで空に畳まない。
    renderEditor(null)
    expect(screen.queryByText(/拍から外れています/)).toBeNull()
  })
})

/**
 * ストーリーボードは解析を手元に持っているので、往復せずその場で判定する。
 * **経路が 2 本になっても、判定も楽曲の選び方も 1 箇所**（`alignBoundary` /
 * `pickMasterTrack`）なので、タイムラインと違う色が出ることはない。
 */
const anAnalysis: WireMusicAnalysis = {
  musicTrackId: MUSIC_TRACK_ID,
  analyzerVersion: 'librosa-v1',
  durationSec: 116,
  bpm: 120,
  bpmConfidence: 0.9,
  beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  downbeats: [0, 2],
  sections: [{ start: 0, end: 116, label: 'intro', energy: 0.4 }],
  onsets: [0.01],
  drops: [32.5],
  waveformPeaksUrl: 'https://example.invalid/peaks.json',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const aTrack = MusicTrack.parse({
  id: MusicTrackId.parse(MUSIC_TRACK_ID),
  projectId: PROJECT_ID,
  mediaAssetId: MEDIA_ID,
  title: 'iXA CUP',
  isMaster: true,
  offsetSec: 0,
  volume: 1,
})

describe('ストーリーボードのパネルへの配線（PHASE 7.1）', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {
          // 位置は測らない。
        }
        disconnect(): void {
          // 何もしない。
        }
      },
    )
    // 下書きの件数は取りに行かせない。取れなくてもカードは出る。
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('手元の解析から出した整列が、ストーリーボードの要約まで届く', async () => {
    renderInWorkbench(<StoryboardPanel />, { shots, track: aTrack, analysis: anAnalysis })

    await waitFor(() => {
      expect(screen.getByText(/2 件中 1 件が拍から外れています/)).toBeTruthy()
    })
    // **小節頭まで渡っていること。** 拍だけを渡すと `on_beat` に落ちるが、
    // 件数の文は変わらないので、要約だけでは気づけない。
    expect(screen.getByTitle(/小節頭に乗っています/)).toBeTruthy()
  })
})
