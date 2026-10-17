import { THUMBNAIL_MAX_BYTES } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  THUMBNAIL_RENDER_FAILED_MESSAGE,
  decideStillSize,
  thumbnailRenderError,
  withoutUrls,
} from '../thumbnail-renderer.js'

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

describe('thumbnailRenderError', () => {
  it('画面に出る文は決まった日本語 1 文だけ。英語の詳細・画質・URL は cause にだけ残す', () => {
    const raw = new Error('Error: net::ERR_CONNECTION_REFUSED loading http://127.0.0.1:9000/a.png?X-Amz-Signature=abc')
    const error = thumbnailRenderError(raw)
    expect(error.message).toBe(THUMBNAIL_RENDER_FAILED_MESSAGE)
    expect(error.message).not.toMatch(/画質|http|Error|net::/)
    expect(error.cause).toBe(raw)
  })
})
