import { THUMBNAIL_MAX_BYTES } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import { decideStillSize, withoutUrls } from '../thumbnail-renderer.js'

/** サムネイルの JPEG の大きさの扱い（ADR-0051）。YouTube は 2 MB **未満**しか受け付けない。 */

describe('decideStillSize', () => {
  it('2 MB 未満ならそのまま', () => {
    expect(decideStillSize(THUMBNAIL_MAX_BYTES - 1, 90)).toEqual({ kind: 'accept' })
  })

  it('ちょうど 2 MB は超えた扱いで、次の画質で描き直す', () => {
    expect(decideStillSize(THUMBNAIL_MAX_BYTES, 90)).toEqual({ kind: 'retry', jpegQuality: 80 })
    expect(decideStillSize(THUMBNAIL_MAX_BYTES + 1, 80)).toEqual({ kind: 'retry', jpegQuality: 70 })
  })

  it('いちばん低い画質でも超えたら失敗（大きいまま返さない）', () => {
    expect(decideStillSize(THUMBNAIL_MAX_BYTES, 70)).toEqual({ kind: 'too_big' })
  })
})

describe('withoutUrls', () => {
  it('例外の文から署名付き URL を落とす', () => {
    const message = withoutUrls('Error loading image with src: http://127.0.0.1:9000/bucket/a.png?X-Amz-Signature=abc failed')
    expect(message).not.toContain('X-Amz-Signature')
    expect(message).not.toContain('http')
    expect(message).toContain('failed')
  })
})
