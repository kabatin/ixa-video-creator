import type { TimelineDocument } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProgramMonitor } from '@/components/program-monitor'

/**
 * `@remotion/player` は jsdom では完全には動かない。
 * ここで確かめるのは **絵を出す前の分岐**だけ:
 * 「まだ読めていない」「Shot が 0 件」を別の文で出し、どちらも Player を読み込まないこと。
 * 実際に再生できるかは実機で確認する（L-011）。
 */

const noop = () => undefined

const makeDocument = (patch: Partial<TimelineDocument> = {}): TimelineDocument => ({
  version: 1,
  fps: 30,
  resolution: { width: 1920, height: 1080 },
  durationSec: 4,
  video1: [],
  transitions: [],
  clips: [],
  audio: [],
  ...patch,
})

describe('ProgramMonitor', () => {
  it('document が null なら「まだ読めていません」を status で出す', () => {
    render(
      <ProgramMonitor
        document={null}
        currentSec={0}
        seek={null}
        playing={false}
        onFrame={noop}
        onPlayingChange={noop}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('まだ読めていません')
  })

  it('Shot が 0 件のときは「読めていない」と違う文を出す', () => {
    render(
      <ProgramMonitor
        document={makeDocument({ video1: [] })}
        currentSec={0}
        seek={null}
        playing={false}
        onFrame={noop}
        onPlayingChange={noop}
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Shot がまだ 1 つもありません')
    expect(status).not.toHaveTextContent('まだ読めていません')
  })

  it('比は document の解像度に従う（縦のプロジェクトを 16:9 に押し込めない）', () => {
    const { container } = render(
      <ProgramMonitor
        document={makeDocument({ resolution: { width: 1080, height: 1920 } })}
        currentSec={0}
        seek={null}
        playing={false}
        onFrame={noop}
        onPlayingChange={noop}
      />,
    )

    const frame = container.querySelector('section > div')
    expect(frame).not.toBeNull()
    // jsdom は `0.5625` を `0.5625 / 1` に正規化するので、文字列ではなく数として見る。
    expect(Number.parseFloat((frame as HTMLElement).style.aspectRatio)).toBeCloseTo(1080 / 1920, 6)
  })

  it('読めていない間は onFrame も onPlayingChange も呼ばない', () => {
    const onFrame = vi.fn()
    const onPlayingChange = vi.fn()

    render(
      <ProgramMonitor
        document={null}
        currentSec={3}
        seek={null}
        playing={true}
        onFrame={onFrame}
        onPlayingChange={onPlayingChange}
      />,
    )

    expect(onFrame).not.toHaveBeenCalled()
    expect(onPlayingChange).not.toHaveBeenCalled()
  })
})
