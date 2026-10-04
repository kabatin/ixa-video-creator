import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LyricCueList, LyricSync, type LyricSyncProps } from '@/components/lyric-sync'

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
      onTogglePlay={props.onTogglePlay ?? vi.fn()}
      snapAt={props.snapAt ?? ((sec) => sec)}
      onPlaceTelops={props.onPlaceTelops ?? vi.fn()}
      {...(props.onAlignShots === undefined ? {} : { onAlignShots: props.onAlignShots })}
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

  it('「歌詞をテロップにする」を呼べる', async () => {
    const onPlaceTelops = vi.fn()
    render(<Harness at={5} cues={[1, 3]} onPlaceTelops={onPlaceTelops} />)

    await userEvent.click(screen.getByRole('button', { name: /歌詞をテロップにする/ }))
    expect(onPlaceTelops).toHaveBeenCalledTimes(1)
  })
})

/**
 * わかりづらかった所を直す（制作者 2026-10-02「この画面すっごいわかりづらいなー」）。
 * 手順が書いていない・再生の口が 2 つ・テロップのボタンが押せない理由が出ない、を直す。
 */
describe('LyricSync の案内', () => {
  it('手順を 1 行で出し、いま・次に押す・その次を見出し付きで出す', () => {
    render(<Harness at={2} cues={[1]} />)

    expect(screen.getByText(/① .*曲を流す.*② .*Enter.*③ .*テロップにする/)).toBeTruthy()
    expect(screen.getByText('いま')).toBeTruthy()
    expect(screen.getByText('次に押す')).toBeTruthy()
    expect(screen.getByText('その次')).toBeTruthy()
    expect(screen.getByTestId('next-lyric').textContent).toBe('二行目')
  })

  it('鳴らすボタンは置かない（再生は下の操作列と Space だけ）', () => {
    const onTogglePlay = vi.fn()
    render(<Harness at={0} onTogglePlay={onTogglePlay} />)

    expect(screen.queryByRole('button', { name: /鳴らす|止める/ })).toBeNull()
    fireEvent.keyDown(window, { key: ' ' })
    expect(onTogglePlay).toHaveBeenCalledTimes(1)
  })

  it('時刻がまだ無ければテロップのボタンは押せず、理由を出す。1 つ付けば押せる', () => {
    render(<Harness at={1} />)
    expect(screen.getByRole('button', { name: /歌詞をテロップにする/ })).toHaveProperty('disabled', true)
    expect(screen.getByText('時刻を 1 つ付けると押せます')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.getByRole('button', { name: /歌詞をテロップにする/ })).toHaveProperty('disabled', false)
    expect(screen.queryByText('時刻を 1 つ付けると押せます')).toBeNull()
  })

  it('フレーズの一覧は頭に出さない（下の LyricCueList に分ける）', () => {
    render(<Harness at={5} cues={[1, 3]} />)

    expect(screen.queryByRole('button', { name: /二行目 の歌い出し/ })).toBeNull()
  })
})

describe('LyricSync の「Shot の境目を揃える」', () => {
  it('渡されたときだけ出し、時刻が付いていれば押せる', async () => {
    const onAlignShots = vi.fn()
    const { unmount } = render(<Harness at={0} cues={[1]} onAlignShots={onAlignShots} />)

    await userEvent.click(screen.getByRole('button', { name: 'Shot の境目を揃える…' }))
    expect(onAlignShots).toHaveBeenCalledTimes(1)
    unmount()

    render(<Harness at={0} />)
    expect(screen.queryByRole('button', { name: 'Shot の境目を揃える…' })).toBeNull()
  })
})

describe('LyricCueList', () => {
  it('畳んでおき、開くと時刻の付いた行を押してその時刻へ飛べる。まだの行に「— まだ」を書かない', async () => {
    const onSeek = vi.fn()
    render(<LyricCueList lyrics={LYRICS} cues={[1, 3]} currentSec={5} onSeek={onSeek} />)

    const summary = screen.getByText(/フレーズの一覧（2 \/ 3。押すとその時刻へ）/)
    expect(summary.closest('details')?.open).toBe(false)

    await userEvent.click(summary)
    await userEvent.click(screen.getByRole('button', { name: /二行目 の歌い出し 0:03/ }))

    expect(onSeek).toHaveBeenCalledWith(3)
    expect(screen.getByText(/三行目/).textContent).not.toMatch(/まだ/)
  })
})

/**
 * 歌詞の打鍵は先に（capture で）受けるので、部品の打鍵と 2 重に動かないよう外す場所を決める（レビューで見つけた）。
 * メニュー項目・ほかのパネルのボタン・開いている確認の中では、その部品が受ける。
 */
describe('LyricSync: 打鍵を取らない場所', () => {
  it('メニュー項目・ほかのパネルのボタン・確認の中の Enter では打たない', () => {
    const onCuesChange = vi.fn()
    render(
      <>
        <button type="button" role="menuitem">
          メニュー項目
        </button>
        <button type="button">ほかのパネルのボタン</button>
        <dialog open>
          <button type="button">確認のボタン</button>
        </dialog>
        <Harness at={1} onCuesChange={onCuesChange} />
      </>,
    )

    for (const name of ['メニュー項目', 'ほかのパネルのボタン', '確認のボタン']) {
      const target = screen.getByRole(name === 'メニュー項目' ? 'menuitem' : 'button', { name })
      target.focus()
      fireEvent.keyDown(target, { key: 'Enter' })
    }

    expect(onCuesChange).not.toHaveBeenCalled()
  })

  it('聴きながら切るのパネルの中のボタン（▶ など）の上なら打つ', () => {
    const onCuesChange = vi.fn()
    render(
      <div data-cutter-panel="">
        <button type="button">▶</button>
        <Harness at={1} onCuesChange={onCuesChange} />
      </div>,
    )
    const play = screen.getByRole('button', { name: '▶' })
    play.focus()
    fireEvent.keyDown(play, { key: 'Enter' })

    expect(onCuesChange).toHaveBeenCalledWith([1])
  })
})
