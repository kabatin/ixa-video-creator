import { MusicTrack, MusicTrackId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CutEditor } from '@/components/cut-editor'
import { ContextMenuHost } from '@/components/workbench/ui/context-menu'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { MEDIA_ID, MUSIC_TRACK_ID, PROJECT_ID } from '@/__tests__/fixtures'

/**
 * 区切って Shot にする（制作者 2026-10-03）。
 * - 「ここに区切りを置く」もテロップのように Enter で置きたい（波形を押してフォーカスを入れなくても）
 * - 区切りの一覧が縦幅を取りすぎ。肝心の「N カットを Shot にする」が一番下で、しかも黒ボタンで分かりづらい
 * - Sequence の意味が分からない（作る画面が無い）
 */

const audio = vi.hoisted(() => ({ currentSec: 30 }))
const api = vi.hoisted(() => ({
  createCuts: vi.fn(() => Promise.resolve({ createdCount: 2, warnings: [] as string[] })),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/api-client', () => ({
  createApiClient: () => ({
    mediaUrl: () => Promise.resolve({ url: 'https://example.invalid/a.mp3', expiresInSec: 3600 }),
    createCuts: api.createCuts,
  }),
}))
vi.mock('@/lib/waveform-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/waveform-api')>()),
  fetchWaveformPeaks: () => new Promise(() => undefined),
}))
vi.mock('@/lib/use-audio-playback', () => ({
  useAudioPlayback: () => ({
    isPlaying: false,
    currentSec: audio.currentSec,
    durationSec: 116,
    isLoading: false,
    error: null,
    notice: null,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    seekTo: vi.fn(),
    nudge: vi.fn(),
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
  beats: [],
  downbeats: [],
  sections: [{ start: 0, end: 116, label: 'intro', energy: 0.4 }],
  onsets: [],
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

const show = (props: { lyricCues?: readonly number[]; onNeedLyrics?: () => void } = {}) =>
  render(
    <ContextMenuHost>
      <input aria-label="ほかの入力欄" />
      <CutEditor
        projectId={PROJECT_ID as never}
        track={track}
        analysis={analysis}
        initialSnapEnabled={false}
        placeKeyAnywhere
        {...props}
      />
    </ContextMenuHost>,
  )

const saveButton = () => screen.getByRole('button', { name: /Shot にする/ })

beforeEach(() => {
  audio.currentSec = 30
  api.createCuts.mockClear()
})

describe('区切って Shot にする', () => {
  it('「Shot にする」は区切りを置くボタンと同じ列にあり、区切りが無いうちは押せない', () => {
    show()
    const toolbar = screen.getByRole('toolbar', { name: '区切りの道具' })
    expect(within(toolbar).getByRole('button', { name: /ここに区切りを置く/ })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: /Shot にする/ })).toBeDisabled()
  })

  it('フォーカスが波形の外にあっても、Enter で区切りを置ける（主ボタンになる）', () => {
    show()
    document.body.focus()

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(saveButton()).toHaveTextContent('2 カットを Shot にする')
    expect(saveButton()).not.toBeDisabled()
    expect(saveButton().className).toContain('bg-accent')
  })

  it('文字を打っている間の Enter では置かない', () => {
    show()
    const field = screen.getByRole('textbox', { name: 'ほかの入力欄' })
    field.focus()

    fireEvent.keyDown(field, { key: 'Enter' })

    expect(saveButton()).toBeDisabled()
  })

  it('Shot にしたら区切りを空にする（2 回押して重なった Shot を作らない）', async () => {
    show()
    fireEvent.keyDown(window, { key: 'Enter' })

    await userEvent.click(saveButton())

    await waitFor(() => {
      expect(api.createCuts).toHaveBeenCalledTimes(1)
    })
    expect(api.createCuts).toHaveBeenCalledWith(PROJECT_ID, { boundariesSec: [0, 30, 116], sequenceId: null })
    expect(await screen.findByText(/2 個の Shot を作りました/)).toBeTruthy()
    expect(saveButton()).toBeDisabled()
  })

  it('Sequence の欄は出さない', () => {
    show()
    expect(screen.queryByText('Sequence')).toBeNull()
  })

  it('区切りは下書きで、Shot にすると保存されると言う', () => {
    show()
    expect(screen.getByText(/区切りは下書きです/)).toBeTruthy()
  })
})

describe('区切りの一覧', () => {
  it('既定は畳んであり、1 行は「カット・区間・時刻・✕」だけ（「動かす」は無い）', async () => {
    show()
    fireEvent.keyDown(window, { key: 'Enter' })

    const summary = screen.getByText(/区切り 1 個 → カット 2 個/)
    expect(summary.closest('details')?.open).toBe(false)
    await userEvent.click(summary)

    expect(screen.queryByRole('button', { name: '動かす' })).toBeNull()
    expect(screen.getByRole('button', { name: '区切り 1 を消す' })).toBeTruthy()
  })

  it('時刻を押すとその場で直せる（Enter で確定）', async () => {
    show()
    fireEvent.keyDown(window, { key: 'Enter' })
    await userEvent.click(screen.getByText(/区切り 1 個 → カット 2 個/))

    await userEvent.click(screen.getByRole('button', { name: '区切り 1 の時刻を直す' }))
    const field = screen.getByRole('textbox', { name: '区切り 1 の時刻（秒）' })
    await userEvent.clear(field)
    await userEvent.type(field, '40{Enter}')

    expect(screen.getByRole('button', { name: '区切り 1 の時刻を直す' })).toHaveTextContent('0:40.00')
  })
})

describe('歌い出しに区切りを置く（歌詞の時刻が無いとき）', () => {
  it('押せて、先に歌詞を合わせるよう確かめる。選べば歌詞を合わせるへ', async () => {
    const onNeedLyrics = vi.fn()
    show({ onNeedLyrics })

    await userEvent.click(screen.getByRole('button', { name: '歌い出しに区切りを置く' }))
    expect(screen.getByText(/歌詞の時刻がまだありません/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '歌詞を合わせる' }))

    expect(onNeedLyrics).toHaveBeenCalledTimes(1)
  })
})

/**
 * 1 回の Enter で 2 つの操作を起こさない（レビューで見つけた）。ほかの部品が受けた Enter・ほかのパネルのボタン・
 * 開いている確認の中の Enter では区切りを置かない。
 */
describe('区切りを置かない Enter', () => {
  it('ほかのパネルのボタンの上の Enter では置かない（そのボタンが受ける）', () => {
    render(
      <>
        <button type="button">素材の行</button>
        <CutEditor projectId={PROJECT_ID as never} track={track} analysis={analysis} initialSnapEnabled={false} placeKeyAnywhere />
      </>,
    )
    const other = screen.getByRole('button', { name: '素材の行' })
    other.focus()
    fireEvent.keyDown(other, { key: 'Enter' })
    expect(saveButton()).toBeDisabled()
  })

  it('先に受けた部品が既定の動きを止めた Enter では置かない', () => {
    render(
      <>
        <div tabIndex={0} data-testid="row" onKeyDown={(event) => event.preventDefault()}>
          行
        </div>
        <CutEditor projectId={PROJECT_ID as never} track={track} analysis={analysis} initialSnapEnabled={false} placeKeyAnywhere />
      </>,
    )
    const row = screen.getByTestId('row')
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(saveButton()).toBeDisabled()
  })

  it('開いている確認の中の Enter では置かない', () => {
    render(
      <>
        <dialog open>
          <button type="button">このまま作る</button>
        </dialog>
        <CutEditor projectId={PROJECT_ID as never} track={track} analysis={analysis} initialSnapEnabled={false} placeKeyAnywhere />
      </>,
    )
    const inDialog = screen.getByRole('button', { name: 'このまま作る' })
    inDialog.focus()
    fireEvent.keyDown(inDialog, { key: 'Enter' })
    expect(saveButton()).toBeDisabled()
  })
})
