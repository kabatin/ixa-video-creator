import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { MediaAssetId } from '@ixa/domain'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SoloAudioProvider } from '@/components/workbench/solo-audio'
import { AudioSoloButton } from '@/components/workbench/ui/audio-solo-button'
import { SOLO_STOP_MARGIN_MS } from '@/lib/audio-solo'
import { STOPPED, renderInWorkbench } from './workbench-fixture'

/**
 * インスペクターの「この音だけ鳴らす」。`<audio>` は jsdom では鳴らないので、再生のフックを差し替えて
 * 「どこへ飛んで・いつ鳴らし・いつ止めたか」を記録する。位置はテストが進める。
 */
const fake = vi.hoisted(() => {
  const state: { log: string[]; setCurrent: (sec: number) => void } = { log: [], setCurrent: () => undefined }
  return state
})

vi.mock('@/lib/use-audio-playback', async () => {
  const React = await import('react')
  return {
    useAudioPlayback: ({ source }: { readonly source: unknown }) => {
      const [isPlaying, setPlaying] = React.useState(false)
      const [currentSec, setCurrentSec] = React.useState(0)
      fake.setCurrent = setCurrentSec
      const noop = (): void => undefined
      return {
        isPlaying,
        currentSec,
        durationSec: source === null ? 0 : 3,
        isLoading: false,
        error: null,
        notice: null,
        play: () => {
          fake.log.push('play')
          setPlaying(true)
        },
        pause: () => {
          fake.log.push('pause')
          setPlaying(false)
        },
        toggle: noop,
        seekTo: (sec: number) => {
          fake.log.push(`seek ${String(sec)}`)
          setCurrentSec(sec)
        },
        nudge: noop,
        volume: 1,
        muted: false,
        setVolume: noop,
        toggleMute: noop,
      }
    },
  }
})

const SOUND = MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FF1')
const api = { mediaUrl: vi.fn().mockResolvedValue({ url: 'https://example.invalid/a', expiresInSec: 3600 }) }
const RANGE = { inSec: 0.25, outSec: 0.65 }

const renderButton = (transport = STOPPED) => {
  fake.log = []
  return renderInWorkbench(
    <SoloAudioProvider api={api}>
      <AudioSoloButton mediaAssetId={SOUND} label="この効果音" range={RANGE} />
    </SoloAudioProvider>,
    {},
    {},
    transport,
  )
}

const press = async (): Promise<void> => {
  // 音が届くまで待つ（届く前は長さが出ない）。
  await screen.findByText('0.40s')
  fake.log = []
  fireEvent.click(screen.getByRole('button', { name: 'この効果音だけを鳴らす' }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AudioSoloButton', () => {
  it('押すと範囲の頭へ飛んでから鳴らし、URL は 1 回だけ取る', async () => {
    api.mediaUrl.mockClear()
    renderButton()
    await press()
    expect(fake.log).toEqual(['seek 0.25', 'play'])
    expect(screen.getByRole('button', { name: 'この効果音を止める' })).toBeInTheDocument()
    expect(api.mediaUrl).toHaveBeenCalledTimes(1)
  })

  it('範囲の終わりの少し手前の予約で止め、頭へ戻す（はみ出さない）', async () => {
    renderButton()
    await press()
    vi.useFakeTimers()
    fake.log = []
    act(() => {
      fake.setCurrent(0.45)
    })
    // 残り 0.20 秒。予約は終わりより少し早い。
    act(() => {
      vi.advanceTimersByTime(200 - SOLO_STOP_MARGIN_MS - 1)
    })
    expect(fake.log).toEqual([])
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(fake.log).toEqual(['pause', 'seek 0.25'])
  })

  it('予約が間に合わず終わりを過ぎていたら、すぐ止める', async () => {
    renderButton()
    await press()
    fake.log = []
    act(() => {
      fake.setCurrent(0.7)
    })
    expect(fake.log).toEqual(['pause', 'seek 0.25'])
  })

  it('押すたびに範囲の頭から（続きからにしない）', async () => {
    renderButton()
    await press()
    act(() => {
      fake.setCurrent(0.5)
    })
    fireEvent.click(screen.getByRole('button', { name: 'この効果音を止める' }))
    fake.log = []
    fireEvent.click(screen.getByRole('button', { name: 'この効果音だけを鳴らす' }))
    expect(fake.log).toEqual(['seek 0.25', 'play'])
  })

  it('取り外したら止める', async () => {
    const { unmount } = renderButton()
    await press()
    fake.log = []
    unmount()
    expect(fake.log).toContain('pause')
  })

  it('鳴り始めたら画面のほかの再生（プレビューなど）を止める', async () => {
    const { value } = renderButton({ ...STOPPED, playing: true, owner: 'monitor' })
    await press()
    await waitFor(() => {
      expect(value.transportControls.pause).toHaveBeenCalled()
    })
  })
})
