import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AudioTransport } from '@/components/audio-transport'
import type { AudioPlayback } from '@/lib/use-audio-playback'

/**
 * 操作盤が**実際に押せて、実際にキーで効く**ことを確かめる。
 *
 * **jsdom には音の再生が無い。** `HTMLMediaElement.play` は未実装で、
 * `currentTime` を進める仕組みも無い。よってここで確かめられるのは
 * 「操作が正しい呼び出しに変換されるか」「画面を離れたら受け付けなくなるか」まで。
 * 音が鳴ること・印が滑らかに動くことはブラウザで確かめるしかない。
 */
const createPlayback = (
  overrides: Partial<AudioPlayback> = {},
): { readonly playback: AudioPlayback } => ({
  playback: {
    isPlaying: false,
    currentSec: 0,
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
    ...overrides,
  },
})

describe('AudioTransport', () => {
  it('キーの割り当てを画面に出す', () => {
    // 隠れた操作は無いのと同じ。
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} />)

    expect(screen.getByText('Space')).toBeInTheDocument()
    expect(screen.getByText('Shift + ← / →')).toBeInTheDocument()
    expect(screen.getByText('Home / End')).toBeInTheDocument()
  })

  /**
   * 一覧は「このとおりに効く」という約束であって、飾りではない。
   *
   * 打鍵を受けていないのに一覧だけ出すと、画面を組む側が別の割り当てを持っている場合に
   * **同じキーに 2 つの説明が並び、片方が必ず嘘になる。** 実際に「聴きながら切る」画面で
   * 矢印キーが重なり、この一覧だけが「1 秒 戻る / 進む」と古い説明を出していた。
   */
  it('打鍵を受けないときは一覧を出さない', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} keyboardShortcuts={false} />)

    expect(screen.queryByText('Space')).not.toBeInTheDocument()
    expect(screen.queryByText('← / →')).not.toBeInTheDocument()
    expect(screen.queryByText('Home / End')).not.toBeInTheDocument()
  })

  it('打鍵を受けないときは実際にキーも効かない。一覧と振る舞いを揃える', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} keyboardShortcuts={false} />)

    fireEvent.keyDown(window, { key: ' ' })

    expect(playback.toggle).not.toHaveBeenCalled()
  })

  it('音量を動かすと呼び出しに変換される', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} />)

    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '0.4' } })

    expect(playback.setVolume).toHaveBeenCalledWith(0.4)
  })

  it('消音を切り替えられる', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} />)

    fireEvent.click(screen.getByRole('button', { name: '消音' }))

    expect(playback.toggleMute).toHaveBeenCalled()
  })

  /**
   * 消音したまま音量だけ動かしても音は出ない。**動かした人は鳴らしたい**ので、
   * 同時に消音を解く。解かないと「上げたのに鳴らない」画面になる。
   */
  it('消音中に音量を動かすと消音も解く', () => {
    const { playback } = createPlayback({ muted: true })
    render(<AudioTransport playback={playback} />)

    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '0.6' } })

    expect(playback.toggleMute).toHaveBeenCalled()
    expect(playback.setVolume).toHaveBeenCalledWith(0.6)
  })

  it('消音中はボタンの文言が変わる', () => {
    const { playback } = createPlayback({ muted: true })
    render(<AudioTransport playback={playback} />)

    expect(screen.getByRole('button', { name: '消音を解除' })).toBeInTheDocument()
  })

  it('波形編集用レイアウトでは再生位置と音量を同じ操作列へまとめる', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} layout="inline" />)

    const controls = screen.getByRole('group', { name: '再生位置と音量' })
    expect(controls).toContainElement(screen.getByRole('button', { name: '再生' }))
    expect(controls).toContainElement(screen.getByRole('slider', { name: '再生位置' }))
    expect(controls).toContainElement(screen.getByRole('button', { name: '消音' }))
    expect(controls).toContainElement(screen.getByRole('slider', { name: '音量' }))
    expect(controls).toHaveTextContent('100%')
  })

  it('ボタンで再生と一時停止を切り替える', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} />)

    fireEvent.click(screen.getByRole('button', { name: '再生' }))

    expect(playback.toggle).toHaveBeenCalledTimes(1)
  })

  it('鳴っている間は一時停止として見せる', () => {
    const { playback } = createPlayback({ isPlaying: true })
    render(<AudioTransport playback={playback} />)

    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('再生中')
  })

  it('スペースで再生と一時停止を切り替える', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} />)

    fireEvent.keyDown(window, { key: ' ' })

    expect(playback.toggle).toHaveBeenCalledTimes(1)
  })

  it('左右で少し動かす', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowLeft', shiftKey: true })

    expect(playback.nudge).toHaveBeenNthCalledWith(1, 1)
    expect(playback.nudge).toHaveBeenNthCalledWith(2, -5)
  })

  it('Home と End で端へ飛ぶ', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} />)

    fireEvent.keyDown(window, { key: 'Home' })
    fireEvent.keyDown(window, { key: 'End' })

    expect(playback.seekTo).toHaveBeenNthCalledWith(1, 0)
    expect(playback.seekTo).toHaveBeenNthCalledWith(2, 116)
  })

  it('文字を打っている最中のスペースで鳴り出さない', () => {
    // これが無いと、題名を入力するだけで曲が鳴ったり止まったりする。
    const { playback } = createPlayback()
    render(
      <>
        <input aria-label="題名" />
        <AudioTransport playback={playback} />
      </>,
    )

    fireEvent.keyDown(screen.getByRole('textbox', { name: '題名' }), { key: ' ' })

    expect(playback.toggle).not.toHaveBeenCalled()
  })

  it('キー操作を切ると反応しない', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} keyboardShortcuts={false} />)

    fireEvent.keyDown(window, { key: ' ' })

    expect(playback.toggle).not.toHaveBeenCalled()
  })

  it('画面を離れたらキー操作を受け付けない', () => {
    // 後始末を忘れると、別の画面の打鍵で鳴っていない音源を操作し続ける。
    const { playback } = createPlayback()
    const view = render(<AudioTransport playback={playback} />)

    view.unmount()
    fireEvent.keyDown(window, { key: ' ' })

    expect(playback.toggle).not.toHaveBeenCalled()
  })

  it('シークバーを動かすとその秒へ飛ぶ', () => {
    const { playback } = createPlayback()
    render(<AudioTransport playback={playback} />)

    fireEvent.change(screen.getByRole('slider', { name: '再生位置' }), {
      target: { value: '42.5' },
    })

    expect(playback.seekTo).toHaveBeenCalledWith(42.5)
  })

  it('尺が分かるまでシークさせない', () => {
    const { playback } = createPlayback({ durationSec: 0, isLoading: true })
    render(<AudioTransport playback={playback} />)

    expect(screen.getByRole('slider', { name: '再生位置' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('読み込んで')
  })

  it('取り直している間は、その理由を読み上げ領域に出す', () => {
    // 黙って直すと、音が一瞬途切れた理由がどこにも残らない。
    const { playback } = createPlayback({
      notice: '音源の一時 URL の期限が切れました。取り直します。',
      isPlaying: false,
    })
    render(<AudioTransport playback={playback} />)

    expect(screen.getByRole('status')).toHaveTextContent('期限が切れました')
    // 直せる見込みがあるうちは操作を取り上げない。
    expect(screen.getByRole('button', { name: '再生' })).toBeEnabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('失敗は警告として出し、再生を止める', () => {
    const { playback } = createPlayback({ error: '再生用の URL の期限が切れました。' })
    render(<AudioTransport playback={playback} />)

    expect(screen.getByRole('alert')).toHaveTextContent('期限が切れました')
    expect(screen.getByRole('button', { name: '再生' })).toBeDisabled()
  })

  it('現在位置と全体の尺を時計で出す', () => {
    const { playback } = createPlayback({ currentSec: 42.375, durationSec: 116 })
    render(<AudioTransport playback={playback} />)

    expect(screen.getByText('0:42.38')).toBeInTheDocument()
    expect(screen.getByText('1:56.00')).toBeInTheDocument()
  })
})
