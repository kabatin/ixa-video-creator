import type { TimelineDocument } from '@ixa/domain'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgramMonitorProps } from '@/components/program-monitor'
import { TakeCompare } from '@/components/take-compare'
import type { WireShotCompare } from '@/lib/take-compare'

/**
 * A/B を **1 つの位置に従わせる**ことを固定する（P61-2 / lessons L-023）。
 *
 * 2 つのモニターが互いに位置を報告し合うと、6.0 で潰した往復が戻ってくる。
 * ここでは **B が位置を報告しても何も動かない**ことを、最終状態ではなく
 * 「報告してから画面が変わったか」で確かめる。
 *
 * モニターそのもの（`@remotion/player`）は jsdom では動かないので差し替え、
 * **何が渡ったか**を見る。実際に絵が並ぶかは実機で確認する（L-011）。
 */

const captured = vi.hoisted(() => ({
  byUrl: new Map<string, unknown>(),
}))

vi.mock('@/components/program-monitor', () => ({
  ProgramMonitor: (props: ProgramMonitorProps) => {
    const url = props.document?.video1[0]?.mediaUrl ?? 'unknown'
    captured.byUrl.set(url, props)
    return <div data-testid={`monitor-${url}`} />
  },
}))

const monitor = (url: string): ProgramMonitorProps => {
  const found = captured.byUrl.get(url)
  if (found === undefined) throw new Error(`モニターが描かれていません: ${url}`)
  return found as ProgramMonitorProps
}

const SPAN = { startSec: 40, durationSec: 4, sourceInSec: 1.5 }

const makeDocument = (mediaUrl: string, withAudio: boolean): TimelineDocument => ({
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 116,
  video1: [
    { shotId: 'shot', startSec: 40, durationSec: 4, mediaUrl, inSec: 1.5 },
  ] as unknown as TimelineDocument['video1'],
  transitions: [],
  clips: [],
  audio: withAudio ? [{ mediaUrl: 'song.wav', startSec: 0, durationSec: 116, volume: 1 }] : [],
})

const makeCompare = (overrides: Partial<WireShotCompare> = {}): WireShotCompare =>
  ({
    shot: SPAN,
    a: { takeId: 'take-a', document: makeDocument('a.mp4', true) },
    b: { takeId: 'take-b', document: makeDocument('b.mp4', false) },
    beats: [39, 40, 41, 42, 43, 44, 45],
    beatState: 'available',
    reason: null,
    ...overrides,
  }) as unknown as WireShotCompare

beforeEach(() => {
  captured.byUrl = new Map()
})

describe('A/B は 1 つの位置に従う', () => {
  it('2 つのモニターに同じ seek と playing が渡る', () => {
    render(<TakeCompare compare={makeCompare()} />)

    fireEvent.click(screen.getByRole('button', { name: 'この Shot を再生' }))

    expect(monitor('a.mp4').playing).toBe(true)
    expect(monitor('b.mp4').playing).toBe(true)
    expect(monitor('a.mp4').seek).toBe(monitor('b.mp4').seek)
  })

  it('目盛りを押すと両方に同じ指示が届く', () => {
    render(<TakeCompare compare={makeCompare()} />)
    const ruler = screen.getByRole('button', { name: /拍の目盛り/ })
    ruler.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect

    fireEvent.click(ruler, { clientX: 50 })

    expect(monitor('a.mp4').seek?.sec).toBe(42)
    expect(monitor('b.mp4').seek?.sec).toBe(42)
  })

  it('同じ位置をもう一度押しても別の指示になる（serial が進む）', () => {
    render(<TakeCompare compare={makeCompare()} />)
    const ruler = screen.getByRole('button', { name: /拍の目盛り/ })
    ruler.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect

    fireEvent.click(ruler, { clientX: 50 })
    const first = monitor('a.mp4').seek?.serial ?? 0
    fireEvent.click(ruler, { clientX: 50 })

    expect(monitor('a.mp4').seek?.serial).toBe(first + 1)
  })
})

describe('位置を報告するのは A だけ', () => {
  it('A が進めば再生ヘッドが動く', () => {
    render(<TakeCompare compare={makeCompare()} />)

    act(() => {
      monitor('a.mp4').onFrame(41.5)
    })

    expect(screen.getByLabelText('拍の目盛り')).toHaveTextContent('0:41.50')
  })

  /**
   * **最終状態ではなく「報告してから変わったか」を見る**（L-022）。
   * B の報告を受け取ってしまうと、2 つが互いに位置を押し付け合う往復が戻る。
   */
  it('B が進めても再生ヘッドは動かない', () => {
    render(<TakeCompare compare={makeCompare()} />)

    act(() => {
      monitor('b.mp4').onFrame(43)
    })

    expect(screen.getByLabelText('拍の目盛り')).toHaveTextContent('0:40.00')
    expect(screen.getByLabelText('拍の目盛り')).not.toHaveTextContent('0:43.00')
  })

  it('B が停止を知らせても再生は止まらない', () => {
    render(<TakeCompare compare={makeCompare()} />)
    fireEvent.click(screen.getByRole('button', { name: 'この Shot を再生' }))

    act(() => {
      monitor('b.mp4').onPlayingChange(false)
    })

    expect(monitor('a.mp4').playing).toBe(true)
  })

  it('A が停止を知らせたら両方止まる', () => {
    render(<TakeCompare compare={makeCompare()} />)
    fireEvent.click(screen.getByRole('button', { name: 'この Shot を再生' }))

    act(() => {
      monitor('a.mp4').onPlayingChange(false)
    })

    expect(monitor('a.mp4').playing).toBe(false)
    expect(monitor('b.mp4').playing).toBe(false)
  })
})

describe('この Shot の区間だけを繰り返す', () => {
  it('両方に Shot の区間が渡る', () => {
    render(<TakeCompare compare={makeCompare()} />)

    for (const url of ['a.mp4', 'b.mp4']) {
      expect(monitor(url).inSec).toBe(40)
      expect(monitor(url).outSec).toBe(44)
      expect(monitor(url).loop).toBe(true)
    }
  })

  it('繰り返しを切ると両方に伝わる', () => {
    render(<TakeCompare compare={makeCompare()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /区間を繰り返す/ }))

    expect(monitor('a.mp4').loop).toBe(false)
    expect(monitor('b.mp4').loop).toBe(false)
  })
})

describe('B が無いとき', () => {
  it('A だけを出す', () => {
    render(<TakeCompare compare={makeCompare({ b: null, reason: 'b_not_requested' })} />)

    expect(screen.getByTestId('monitor-a.mp4')).toBeInTheDocument()
    expect(screen.queryByTestId('monitor-b.mp4')).toBeNull()
  })

  it('理由を出す（黙って 1 つだけ出さない）', () => {
    render(<TakeCompare compare={makeCompare({ b: null, reason: 'b_not_requested' })} />)

    expect(screen.getByRole('status')).toHaveTextContent('比較する Take を選んでいません')
  })

  it('素材を読めないときは警告ではなく強い報せにする', () => {
    render(<TakeCompare compare={makeCompare({ b: null, reason: 'b_media_unresolved' })} />)

    expect(screen.getByRole('alert')).toHaveTextContent('素材を読み込めません')
  })
})

describe('A の素材が読めないとき', () => {
  /**
   * 空の document をモニターへ渡すと「Shot を並べると絵が出ます」と案内される。
   * **この画面ではそれが嘘**で、素材が無いという報せの真下に並ぶ（L-015 / L-021）。
   */
  it('モニターを出さない（Shot が 0 件と読み違えさせない）', () => {
    render(<TakeCompare compare={makeCompare({ b: null, reason: 'a_media_unresolved' })} />)

    expect(captured.byUrl.size).toBe(0)
    expect(screen.getByRole('alert')).toHaveTextContent('採用候補の素材を読み込めません')
  })

  it('再生の操作盤も出さない（押しても何も映らない）', () => {
    render(<TakeCompare compare={makeCompare({ b: null, reason: 'a_media_unresolved' })} />)

    expect(screen.queryByRole('button', { name: 'この Shot を再生' })).toBeNull()
    expect(screen.queryByLabelText('拍の目盛り')).toBeNull()
  })
})

describe('まだ読めていないとき', () => {
  /** 「読めていない」と「比較するものが無い」を混ぜない（L-015 / L-021）。 */
  it('null は「まだ読めていません」', () => {
    render(<TakeCompare compare={null} />)

    expect(screen.getByRole('status')).toHaveTextContent('まだ読めていません')
    expect(captured.byUrl.size).toBe(0)
  })

  it('読み込みに失敗したらその理由を出す', () => {
    render(<TakeCompare compare={null} error="比較の材料を取得できませんでした" />)

    expect(screen.getByRole('alert')).toHaveTextContent('比較の材料を取得できませんでした')
  })
})

describe('拍の目盛り', () => {
  it('この区間に入る拍だけを出す（隣の Shot の頭は出さない）', () => {
    const { container } = render(<TakeCompare compare={makeCompare()} />)
    const ruler = container.querySelector('[aria-label="拍の目盛り"] button')

    // 40 / 41 / 42 / 43 の 4 件。39 は手前、44 は次の Shot の頭。
    expect(ruler?.querySelectorAll('span.bg-line-strong')).toHaveLength(4)
    expect(screen.getByLabelText('拍の目盛り')).toHaveTextContent('拍 4 件')
  })

  it('解析が無いときは拍が 0 件である理由を出す', () => {
    render(<TakeCompare compare={makeCompare({ beats: [], beatState: 'no_analysis' })} />)

    expect(screen.getByLabelText('拍の目盛り')).toHaveTextContent('まだ解析されていません')
  })
})

/**
 * 他の再生器と**同時に鳴らない**。
 *
 * 以前は参加しておらず、「聴きながら切る」と一緒に鳴って、曲が 0.5 秒ずれて
 * 二重に聞こえた（実機で確認: original.mp3 が 3.01s、カッターが 3.49s）。
 */
describe('他の再生器と同時に鳴らない', () => {
  const port = (patch: Partial<{ othersPlaying: boolean; commandPlaying: boolean | null }> = {}) => ({
    othersPlaying: false,
    commandPlaying: null,
    onPlayingChange: vi.fn(),
    ...patch,
  })

  it('鳴り始めたら知らせる（他を止めるため）', () => {
    const exclusive = port()
    render(<TakeCompare compare={makeCompare()} exclusive={exclusive} />)

    fireEvent.click(screen.getByRole('button', { name: 'この Shot を再生' }))

    expect(exclusive.onPlayingChange).toHaveBeenCalledWith(true)
  })

  it('取り付けただけでは知らせない（他の再生を止めてしまう）', () => {
    const exclusive = port()
    render(<TakeCompare compare={makeCompare()} exclusive={exclusive} />)

    expect(exclusive.onPlayingChange).not.toHaveBeenCalled()
  })

  it('他が鳴り始めたら止まる', () => {
    const first = port()
    const view = render(<TakeCompare compare={makeCompare()} exclusive={first} />)
    fireEvent.click(screen.getByRole('button', { name: 'この Shot を再生' }))
    expect(monitor('a.mp4').playing).toBe(true)

    view.rerender(<TakeCompare compare={makeCompare()} exclusive={port({ othersPlaying: true })} />)

    expect(monitor('a.mp4').playing).toBe(false)
  })

  it('画面の ⏸ で止められたら止まる（持ち主のときの指示に従う）', () => {
    const view = render(<TakeCompare compare={makeCompare()} exclusive={port()} />)
    fireEvent.click(screen.getByRole('button', { name: 'この Shot を再生' }))

    view.rerender(<TakeCompare compare={makeCompare()} exclusive={port({ commandPlaying: false })} />)

    expect(monitor('a.mp4').playing).toBe(false)
  })
})

