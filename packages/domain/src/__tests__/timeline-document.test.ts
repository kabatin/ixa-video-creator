import { describe, expect, it } from 'vitest'
import { TimelineDocument } from '../timeline/timeline.js'

/**
 * VIDEO1 の 1 件が映すものの種類（制作者 2026-10-02。Take が無い Shot は絵コンテの画像を映す）。
 * 省略は video（採用 Take）。version は 1 のまま、これまでの書き出しの記録もそのまま読める。
 */

const documentWith = (entry: Record<string, unknown>) => ({
  version: 1,
  fps: 24,
  resolution: { width: 1920, height: 1080 },
  durationSec: 4,
  video1: [
    { shotId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', startSec: 0, durationSec: 4, mediaUrl: 'https://media.test/a', inSec: 0, ...entry },
  ],
  transitions: [],
  clips: [],
  audio: [],
})

describe('TimelineDocument の VIDEO1 の種類', () => {
  it('種類が無い文書（これまでの記録）も読める', () => {
    expect(TimelineDocument.safeParse(documentWith({})).success).toBe(true)
  })

  it.each(['video', 'image'])('%s を受け付ける', (kind) => {
    expect(TimelineDocument.safeParse(documentWith({ kind })).success).toBe(true)
  })

  it('知らない種類は受け付けない', () => {
    expect(TimelineDocument.safeParse(documentWith({ kind: 'audio' })).success).toBe(false)
  })
})
