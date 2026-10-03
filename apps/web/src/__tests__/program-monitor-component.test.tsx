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
    expect(status).toHaveTextContent('まだ映すものがありません')
    expect(status).not.toHaveTextContent('まだ読めていません')
  })

  /** 制作者 2026-10-03「テロップがあるだけではプレビューが再生できず…黒画面で問題ない」。プレビューだけが許す。 */
  it('絵が無くても音があり、黒い画面で流すと言われていれば、そう添えて流す', () => {
    const audio = [{ mediaUrl: 'https://example.invalid/song.wav', startSec: 0, durationSec: 60, volume: 1 }]
    const { rerender } = render(
      <ProgramMonitor
        document={makeDocument({ video1: [], audio, durationSec: 60 })}
        currentSec={0}
        seek={null}
        playing={false}
        onFrame={noop}
        onPlayingChange={noop}
        withoutPictures
      />,
    )
    expect(screen.getByText(/音とテロップだけを流しています/)).toBeTruthy()

    rerender(
      <ProgramMonitor
        document={makeDocument({ video1: [], audio, durationSec: 60 })}
        currentSec={0}
        seek={null}
        playing={false}
        onFrame={noop}
        onPlayingChange={noop}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('まだ映すものがありません')
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

  /**
   * パネルを縦に縮めたときに絵がはみ出さないこと。
   * jsdom は寸法を計算しないので、**高さが幅の決定に入っていること**を式で確かめる。
   * 実際に収まるかは実機で見る（L-011）。
   */
  describe('fit', () => {
    const renderFit = (fit?: 'width' | 'contain') =>
      render(
        <ProgramMonitor
          document={makeDocument({ resolution: { width: 1920, height: 1080 } })}
          currentSec={0}
          seek={null}
          playing={false}
          onFrame={noop}
          onPlayingChange={noop}
          {...(fit === undefined ? {} : { fit })}
        />,
      )

    it('contain では幅が高さからも決まる（縦に縮めても絵が全部見える）', () => {
      const { container } = renderFit('contain')

      const stage = container.querySelector('section > div')
      expect(stage).not.toBeNull()
      expect((stage as HTMLElement).style.containerType).toBe('size')

      const frame = stage?.firstElementChild as HTMLElement
      // 高さ（cqh）が式に入っていないと、幅だけで決まり下へはみ出す。
      // jsdom は `calc(100cqh * 1.777…)` を `177.77…cqh` に畳むので、単位で見る。
      expect(frame.style.width).toMatch(/cqh/)
      expect(frame.style.width).toMatch(/cqw/)
      expect(frame.style.width).toMatch(/^min\(/)
      expect(Number.parseFloat(frame.style.aspectRatio)).toBeCloseTo(1920 / 1080, 6)
    })

    it('contain では絵の枠が縦に伸び縮みできる', () => {
      const { container } = renderFit('contain')

      const section = container.querySelector('section')
      expect(section?.className).toContain('h-full')
      expect(container.querySelector('section > div')?.className).toContain('flex-1')
    })

    it('既定（width）は高さを見ない。横に 2 枚並べる比較を縦に潰さない', () => {
      const { container } = renderFit()

      const frame = container.querySelector('section > div') as HTMLElement
      // 既定では入れ物が大きさのコンテナにならず、幅は class の w-full に任せる。
      expect(frame.style.containerType).toBe('')
      expect(frame.style.width).toBe('')
      expect(frame.className).toContain('w-full')
      expect(container.querySelector('section')?.className).not.toContain('h-full')
    })
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
