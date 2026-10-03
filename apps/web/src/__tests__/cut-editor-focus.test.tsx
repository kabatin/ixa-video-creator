import { MusicTrack, MusicTrackId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CutEditor } from '@/components/cut-editor'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { CUT_EDITOR_ATTRIBUTE } from '@/lib/playback-state'
import { MEDIA_ID, MUSIC_TRACK_ID, PROJECT_ID } from '@/__tests__/fixtures'

/**
 * 「聴きながら切る」がキーを取るのは、**フォーカスが自分の中にあるときだけ**（B2 / B3）。
 *
 * 見えているかで決めていた頃は、Tab でボタンへ移って Enter を押すと
 * ボタンが押されず区切りだけが増えた。波形は canvas でフォーカスを受けないので、
 * 入れ物が代わりに受ける必要がある。ここではその配線を確かめる。
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

const NO_MARKS = /区切りがまだありません。/
// 区切りが 1 個置かれたことだけを見る。0 秒に置くと曲の頭と重なるのでカット数は変わる。
const ONE_MARK = /区切り 1 個 → カット/

const renderEditor = async (): Promise<HTMLElement> => {
  render(
    <CutEditor
      projectId={PROJECT_ID as never}
      track={track}
      analysis={analysis}
    />,
  )
  await waitFor(() => {
    expect(screen.getByText(NO_MARKS)).toBeInTheDocument()
  })
  const container = document.querySelector<HTMLElement>(`[${CUT_EDITOR_ATTRIBUTE}]`)
  expect(container).not.toBeNull()
  return container as HTMLElement
}

const placeMarkButton = (): HTMLElement => screen.getByRole('button', { name: /ここに区切りを置く/ })

beforeEach(() => {
  audio.toggle.mockClear()
  audio.nudge.mockClear()
  audio.seekTo.mockClear()
})

describe('キーの持ち主を決める入れ物', () => {
  it('目印が付いていて、自分でフォーカスを受けられる', async () => {
    const container = await renderEditor()

    expect(container.getAttribute('tabindex')).toBe('-1')
  })

  it('波形のあたりを押すと入れ物にフォーカスが移る（canvas は受けないため）', async () => {
    const container = await renderEditor()

    fireEvent.pointerDown(screen.getByText('波形を読み込んでいます…'))

    expect(document.activeElement).toBe(container)
  })

  it('中のボタンを押したときは入れ物が横取りしない', async () => {
    await renderEditor()
    const button = placeMarkButton()

    fireEvent.pointerDown(button)

    expect(document.activeElement).not.toBe(document.querySelector(`[${CUT_EDITOR_ATTRIBUTE}]`))
  })
})

describe('フォーカスが入れ物の中にあるとき', () => {
  it('Space は再生の入り切り', async () => {
    const container = await renderEditor()
    container.focus()

    fireEvent.keyDown(container, { key: ' ' })

    expect(audio.toggle).toHaveBeenCalledTimes(1)
  })

  it('Enter は区切りを置く', async () => {
    const container = await renderEditor()
    container.focus()

    fireEvent.keyDown(container, { key: 'Enter' })

    expect(await screen.findByText(ONE_MARK)).toBeInTheDocument()
  })
})

describe('フォーカスがボタンにあるとき', () => {
  it('Enter で区切りが増えない（ボタンの打鍵を横取りしない）', async () => {
    await renderEditor()
    const button = placeMarkButton()
    button.focus()

    fireEvent.keyDown(button, { key: 'Enter' })

    expect(screen.getByText(NO_MARKS)).toBeInTheDocument()
  })

  it('Space で再生が切り替わらない', async () => {
    await renderEditor()
    const button = placeMarkButton()
    button.focus()

    fireEvent.keyDown(button, { key: ' ' })

    expect(audio.toggle).not.toHaveBeenCalled()
  })
})

describe('フォーカスが入れ物の外にあるとき', () => {
  it('Space も Enter も取らない（ワークベンチのもの）', async () => {
    await renderEditor()

    fireEvent.keyDown(document.body, { key: ' ' })
    fireEvent.keyDown(document.body, { key: 'Enter' })

    expect(audio.toggle).not.toHaveBeenCalled()
    expect(screen.getByText(NO_MARKS)).toBeInTheDocument()
  })
})
