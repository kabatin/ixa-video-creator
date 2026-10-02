import { TimelineClip, TimelineClipId, type ProjectId } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { resolveTextClipScope, textClipScopes, toStyleChange } from '@/lib/text-clip-scope'

/** テロップの見た目を変える範囲（制作者 2026-10-02「テロップをまとめて、サイズやスタイルや位置を変えられるようにしたい」）。 */

const PROJECT = '01ARZ3NDEKTSV4RRFFQ69G5FAW' as ProjectId
const textClip = (n: number, params: Record<string, unknown>) =>
  TimelineClip.parse({
    id: TimelineClipId.parse(`01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`),
    projectId: PROJECT,
    track: 'TEXT',
    startSec: n,
    durationSec: 1,
    layer: 0,
    content: { type: 'text', templateKey: 'plain', params },
    opacity: 1,
    createdAt: new Date(),
  })

const lyricA = textClip(1, { text: 'a', lyricLine: 0 })
const manual = textClip(2, { text: 'b' })
const clips = [lyricA, manual]

describe('resolveTextClipScope', () => {
  it('いまのテロップが入らない範囲は「このテロップだけ」に戻す', () => {
    const scopes = textClipScopes(clips, manual.id)

    expect(resolveTextClipScope(scopes, 'lyrics', manual.id).id).toBe('this')
    expect(resolveTextClipScope(scopes, 'all', manual.id).clipIds).toEqual([lyricA.id, manual.id])
  })
})

describe('toStyleChange', () => {
  it('undefined の項目は外し、ほかは上書き。範囲の外は投げる', () => {
    expect(toStyleChange({ size: 0.06, color: undefined })).toEqual({ set: { size: 0.06 }, unset: ['color'] })
    expect(() => toStyleChange({ size: 0.9 })).toThrow()
  })
})
