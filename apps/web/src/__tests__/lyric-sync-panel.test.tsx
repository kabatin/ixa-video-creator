import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LyricSync, type LyricSyncProps } from '@/components/lyric-sync'

/**
 * 歌詞を合わせる（ADR-0033。制作者 2026-10-01「聴きながら打つ」）。曲を流し、フレーズの歌い出しで Enter。
 * 次に押すフレーズを大きく出す。Backspace で 1 つ戻す。押した時刻は拍へ寄せる（寄せ方は呼び出し側）。
 */

const LYRICS = '一行目\n二行目\n三行目'

const Harness = (props: Partial<LyricSyncProps> & { readonly at: number }) => {
  const [cues, setCues] = useState<readonly number[]>(props.cues ?? [])
  return (
    <LyricSync
      lyrics={LYRICS}
      cues={cues}
      onCuesChange={(next) => {
        setCues(next)
        props.onCuesChange?.(next)
      }}
      currentSec={props.at}
      playing={false}
      onTogglePlay={props.onTogglePlay ?? vi.fn()}
      onSeek={props.onSeek ?? vi.fn()}
      snapAt={props.snapAt ?? ((sec) => sec)}
      onPlaceTelops={props.onPlaceTelops ?? vi.fn()}
      onOpenConcept={vi.fn()}
      keyboard
    />
  )
}

describe('LyricSync', () => {
  it('次に押すフレーズを大きく出し、Enter でその時刻を打つ（拍へ寄せた値で）', () => {
    const onCuesChange = vi.fn()
    render(<Harness at={1.23} onCuesChange={onCuesChange} snapAt={() => 1.25} />)

    expect(screen.getByTestId('next-lyric')).toHaveTextContent('一行目')
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onCuesChange).toHaveBeenLastCalledWith([1.25])
    expect(screen.getByTestId('next-lyric')).toHaveTextContent('二行目')
  })

  it('Backspace で 1 つ戻す', () => {
    const onCuesChange = vi.fn()
    render(<Harness at={5} cues={[1, 3]} onCuesChange={onCuesChange} />)

    fireEvent.keyDown(window, { key: 'Backspace' })

    expect(onCuesChange).toHaveBeenLastCalledWith([1])
  })

  it('前のフレーズより前では打たず、理由を言う', () => {
    const onCuesChange = vi.fn()
    render(<Harness at={2} cues={[3]} onCuesChange={onCuesChange} />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onCuesChange).not.toHaveBeenCalled()
    expect(screen.getByText(/前のフレーズより後で/)).toBeTruthy()
  })

  it('Space で鳴らす・止める', () => {
    const onTogglePlay = vi.fn()
    render(<Harness at={0} onTogglePlay={onTogglePlay} />)

    fireEvent.keyDown(window, { key: ' ' })

    expect(onTogglePlay).toHaveBeenCalledTimes(1)
  })

  it('欄に打っている間は打鍵を横取りしない', () => {
    const onCuesChange = vi.fn()
    render(
      <>
        <input aria-label="ほかの欄" />
        <Harness at={1} onCuesChange={onCuesChange} />
      </>,
    )

    fireEvent.keyDown(screen.getByLabelText('ほかの欄'), { key: 'Enter' })

    expect(onCuesChange).not.toHaveBeenCalled()
  })

  it('打った時刻の行を押すとそこへ飛び、「歌詞をテロップにする」を呼べる', async () => {
    const onSeek = vi.fn()
    const onPlaceTelops = vi.fn()
    render(<Harness at={5} cues={[1, 3]} onSeek={onSeek} onPlaceTelops={onPlaceTelops} />)

    await userEvent.click(screen.getByRole('button', { name: /二行目 の歌い出し 0:03/ }))
    expect(onSeek).toHaveBeenCalledWith(3)

    await userEvent.click(screen.getByRole('button', { name: /歌詞をテロップにする/ }))
    expect(onPlaceTelops).toHaveBeenCalledTimes(1)
  })
})
