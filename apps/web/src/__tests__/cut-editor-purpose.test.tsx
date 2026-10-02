import { MusicTrack, MusicTrackId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CutEditor } from '@/components/cut-editor'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { MEDIA_ID, MUSIC_TRACK_ID, PROJECT_ID } from '@/__tests__/fixtures'

/**
 * 歌詞を合わせている間の「聴きながら切る」（制作者 2026-10-02「この画面すっごいわかりづらいなー」）。
 * 歌詞モードでも区切りの道具（区切りを置く・区切りの一覧・Shot にする）が下に丸ごと付いてきて、波形は画面の外だった。
 * 歌詞のときは再生と波形だけを出す。
 */

const audio = vi.hoisted(() => ({
  toggle: vi.fn(),
  nudge: vi.fn(),
  seekTo: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({
    mediaUrl: () => Promise.resolve({ url: 'https://example.invalid/a.mp3', expiresInSec: 3600 }),
  }),
}))

/** 波形は取れないままにする。canvas は jsdom で描けない。 */
vi.mock('@/lib/waveform-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/waveform-api')>()),
  fetchWaveformPeaks: () => new Promise(() => undefined),
}))

vi.mock('@/lib/use-audio-playback', () => ({
  useAudioPlayback: () => ({
    isPlaying: false,
    currentSec: 0,
    durationSec: 116,
    isLoading: false,
    error: null,
    notice: null,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: audio.toggle,
    seekTo: audio.seekTo,
    nudge: audio.nudge,
    volume: 1,
    muted: false,
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
  }),
}))

const analysis: WireMusicAnalysis = {
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

const track = MusicTrack.parse({
  id: MusicTrackId.parse(MUSIC_TRACK_ID),
  projectId: PROJECT_ID,
  mediaAssetId: MEDIA_ID,
  title: 'iXA CUP',
  isMaster: true,
  offsetSec: 0,
  volume: 1,
})

const renderEditor = async (purpose?: 'cut' | 'lyrics', lyricCues?: readonly number[]) => {
  render(
    <CutEditor
      projectId={PROJECT_ID as never}
      track={track}
      analysis={analysis}
      sequences={[]}
      {...(purpose === undefined ? {} : { purpose })}
      {...(lyricCues === undefined ? {} : { lyricCues })}
    />,
  )
  await waitFor(() => {
    expect(screen.getByText('波形を読み込んでいます…')).toBeInTheDocument()
  })
}

describe('CutEditor の使いみち', () => {
  it('既定（区切る）は区切りの道具を出す', async () => {
    await renderEditor()

    expect(screen.getByRole('button', { name: /ここに区切りを置く/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Shot にする' })).toBeInTheDocument()
    expect(screen.getByText('区切りがまだありません。')).toBeInTheDocument()
  })

  it('歌詞のときは区切りの道具を出さず、波形と表示の切り替えは出す', async () => {
    await renderEditor('lyrics')

    expect(screen.queryByRole('button', { name: /ここに区切りを置く/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /セクションの境目に区切りを置く/ })).toBeNull()
    expect(screen.queryByText('拍に吸着')).toBeNull()
    expect(screen.queryAllByText(/Shot にする/)).toHaveLength(0)
    expect(screen.queryByText('区切りがまだありません。')).toBeNull()
    expect(screen.queryByText('キーとホイールの割り当て')).toBeNull()
    expect(screen.getByRole('button', { name: '全体' })).toBeInTheDocument()
  })
})

/**
 * 歌い出しに区切りを置く（制作者 2026-10-02「テロップを置いたってことは時間が割とはっきりするので、区切りもつけやすくなる」）。
 */
describe('歌い出しに区切りを置く', () => {
  it('歌詞の時刻があれば、全部の歌い出しに区切りを置いて本数を言う', async () => {
    await renderEditor('cut', [3.5, 7])

    fireEvent.click(screen.getByRole('button', { name: '歌い出しに区切りを置く' }))

    expect(screen.getByText('歌い出しに区切りを 2 本置きました。')).toBeInTheDocument()
    expect(screen.queryByText('区切りがまだありません。')).toBeNull()
  })

  it('歌詞の時刻が無ければ押せない（理由は title に出す）', async () => {
    await renderEditor('cut')

    const button = screen.getByRole('button', { name: '歌い出しに区切りを置く' })
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('title')).toMatch(/歌詞を合わせる/)
  })
})
