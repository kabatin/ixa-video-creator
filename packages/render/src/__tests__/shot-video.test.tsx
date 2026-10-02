import type { ReactElement } from 'react'
import { Img, OffthreadVideo } from 'remotion'
import { describe, expect, it, vi } from 'vitest'
import { PreviewShotVideo, ShotVideo, copyFrameTo } from '../compositions/shot-video.js'

/**
 * Shot の動画（ADR-0027）。書き出しは OffthreadVideo だけ。プレビューは同じ動画の下に、
 * 直近に描いたコマを写した canvas を敷く（Safari が切り替わりの瞬間に動画を描かず、黒が見えたため）。
 */
const box = { position: 'absolute' as const, left: 0, top: 0, width: 1920, height: 1080 }
const shot = { mediaUrl: 'https://media.test/S1.mp4', startFrom: 12, playbackRate: 0.8, kind: 'video' as const }

type Element = ReactElement<Record<string, unknown>>
const call = (element: Element): Element =>
  (element.type as (props: Record<string, unknown>) => Element)(element.props)

describe('ShotVideo', () => {
  it('書き出しは OffthreadVideo だけ（下敷きもコマの写しも無い）', () => {
    const video = call(ShotVideo({ shot, box, rendering: true }) as Element)

    expect(video.type).toBe(OffthreadVideo)
    expect(video.props).toMatchObject({
      src: shot.mediaUrl,
      startFrom: 12,
      playbackRate: 0.8,
      muted: true,
      style: { ...box, objectFit: 'contain' },
    })
    expect(video.props.onVideoFrame).toBeUndefined()
  })

  it('プレビューは下敷き付きの部品にする（同じ Shot・同じ枠）', () => {
    const element = ShotVideo({ shot, box, rendering: false }) as Element

    expect(element.type).toBe(PreviewShotVideo)
    expect(element.props).toEqual({ shot, box })
  })
})

/**
 * Take が無い Shot の絵コンテの画像（制作者 2026-10-02「画像しかない場合、プレビューでは画像が出るんじゃなかったっけ？」）。
 * 書き出しもプレビューも同じ `<Img>`（読み込みを待ってからコマを出すので、書き出しで空のコマにならない）。
 */
describe('ShotVideo の絵', () => {
  const still = { mediaUrl: 'https://media.test/S2.png', startFrom: 0, playbackRate: 1, kind: 'image' as const }

  it.each([true, false])('書き出し=%s でも、絵を同じ枠に収めて出す', (rendering) => {
    const element = ShotVideo({ shot: still, box, rendering }) as Element

    expect(element.type).toBe(Img)
    expect(element.props).toMatchObject({ src: still.mediaUrl, style: { ...box, objectFit: 'contain' } })
  })
})

describe('copyFrameTo', () => {
  const canvasOf = () => {
    const drawImage = vi.fn()
    const canvas = { width: 300, height: 150, getContext: vi.fn(() => ({ drawImage })) }
    return { canvas, drawImage }
  }
  const frameOf = (videoWidth: number, videoHeight: number) =>
    ({ videoWidth, videoHeight, addEventListener: vi.fn() })

  it('素材の大きさに合わせてコマを写す', () => {
    const { canvas, drawImage } = canvasOf()
    const frame = frameOf(1280, 720)

    copyFrameTo(canvas, frame)

    expect([canvas.width, canvas.height]).toEqual([1280, 720])
    expect(drawImage).toHaveBeenCalledWith(frame, 0, 0, 1280, 720)
  })

  it('まだコマが無い動画では触らない（下敷きを空で上書きしない）', () => {
    const { canvas, drawImage } = canvasOf()

    copyFrameTo(canvas, frameOf(0, 0))

    expect(drawImage).not.toHaveBeenCalled()
    expect([canvas.width, canvas.height]).toEqual([300, 150])
  })

  it('画像（書き出しで来るもの）や canvas が無いときは何もしない', () => {
    const { canvas, drawImage } = canvasOf()

    copyFrameTo(canvas, { width: 10, height: 10 })
    copyFrameTo(null, frameOf(1280, 720))

    expect(drawImage).not.toHaveBeenCalled()
  })
})
