import { Video as MediaVideo } from '@remotion/media'
import type { ReactElement } from 'react'
import { OffthreadVideo } from 'remotion'
import { describe, expect, it } from 'vitest'
import { ShotVideo } from '../compositions/shot-video.js'

/**
 * Shot の動画の部品（ADR-0027）。
 * プレビューは WebCodecs で canvas に描く（Safari で境目に黒が出ないため）。
 * 書き出しは今までどおり OffthreadVideo（絵を変えない）。
 */
const box = { position: 'absolute' as const, left: 0, top: 0, width: 1920, height: 1080 }
const shot = { mediaUrl: 'https://media.test/S1.mp4', startFrom: 12, playbackRate: 0.8 }

const elementOf = (rendering: boolean) =>
  ShotVideo({ shot, box, rendering }) as ReactElement<Record<string, unknown>>

describe('ShotVideo', () => {
  it('プレビューは @remotion/media の Video（WebCodecs）で描く', () => {
    const element = elementOf(false)

    expect(element.type).toBe(MediaVideo)
    expect(element.props).toMatchObject({
      src: shot.mediaUrl,
      trimBefore: 12,
      playbackRate: 0.8,
      muted: true,
      objectFit: 'contain',
      style: box,
    })
  })

  it('書き出しは OffthreadVideo のまま（同じ切り出し位置・速度・消音）', () => {
    const element = elementOf(true)

    expect(element.type).toBe(OffthreadVideo)
    expect(element.props).toMatchObject({
      src: shot.mediaUrl,
      startFrom: 12,
      playbackRate: 0.8,
      muted: true,
      style: { ...box, objectFit: 'contain' },
    })
  })
})
