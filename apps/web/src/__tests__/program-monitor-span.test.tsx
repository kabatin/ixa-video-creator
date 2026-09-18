import type { TimelineDocument } from '@ixa/domain'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgramMonitorPlayer } from '@/components/program-monitor-player'

/**
 * 「この Shot の区間だけを繰り返す」を Player の props まで確かめる（P61-2）。
 *
 * **`outFrame` は最後に再生するフレームで、その番号自体を再生する**
 * （`@remotion/player` の `use-playback` が `actualLastFrame` として使う）。
 * 区間の終わりの秒をそのままフレームに直して渡すと、繰り返すたびに
 * **次の Shot の頭が 1 フレーム映る**。目盛りと絵が 1 フレームだけ食い違うと、
 * 原因が絵からは分からない。
 */

const captured = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}))

vi.mock('@ixa/render/composition', () => ({
  TimelineComposition: () => null,
  totalFrames: (durationSec: number, fps: number) => Math.max(1, Math.round(durationSec * fps)),
}))

vi.mock('@remotion/player', () => ({
  Player: (props: Record<string, unknown>) => {
    captured.props = props
    return <div />
  },
}))

const FPS = 30

const makeDocument = (durationSec = 10): TimelineDocument => ({
  version: 1,
  fps: FPS,
  resolution: { width: 1920, height: 1080 },
  durationSec,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
})

const noop = () => undefined

const renderPlayer = (span: { inSec?: number; outSec?: number; loop?: boolean }) =>
  render(
    <ProgramMonitorPlayer
      document={makeDocument()}
      initialSec={0}
      seek={null}
      playing={false}
      onFrame={noop}
      onPlayingChange={noop}
      onFatalError={noop}
      onMediaError={noop}
      {...span}
    />,
  )

beforeEach(() => {
  captured.props = null
})

describe('区間の指定', () => {
  it('終端の秒は再生しない（outFrame は 1 つ手前）', () => {
    renderPlayer({ inSec: 2, outSec: 4 })

    expect(captured.props?.inFrame).toBe(60)
    expect(captured.props?.outFrame).toBe(119)
  })

  it('区間を指定しなければ尺いっぱいのまま（null を渡す）', () => {
    renderPlayer({})

    expect(captured.props?.inFrame).toBeNull()
    expect(captured.props?.outFrame).toBeNull()
  })

  it('先頭だけを指定したら終わりは尺のまま', () => {
    renderPlayer({ inSec: 2 })

    expect(captured.props?.inFrame).toBe(60)
    expect(captured.props?.outFrame).toBeNull()
  })

  it('尺の外へはみ出した区間は尺の中へ丸める', () => {
    renderPlayer({ inSec: 20, outSec: 30 })

    expect(captured.props?.inFrame).toBe(299)
    expect(captured.props?.outFrame).toBe(299)
  })

  it('負の位置も尺の中へ丸める', () => {
    renderPlayer({ inSec: -5, outSec: 1 })

    expect(captured.props?.inFrame).toBe(0)
    expect(captured.props?.outFrame).toBe(29)
  })

  /** 尺 0 の Shot でも Player を壊さない。終わりが先頭より前に来ない。 */
  it('先頭と終わりが同じ秒なら 1 フレームだけの区間にする', () => {
    renderPlayer({ inSec: 4, outSec: 4 })

    expect(captured.props?.outFrame).toBe(captured.props?.inFrame)
  })
})

describe('繰り返し', () => {
  it('既定では繰り返さない（既存のタイムラインの挙動を変えない）', () => {
    renderPlayer({})

    expect(captured.props?.loop).toBe(false)
  })

  it('指定すれば繰り返す', () => {
    renderPlayer({ loop: true })

    expect(captured.props?.loop).toBe(true)
  })
})
