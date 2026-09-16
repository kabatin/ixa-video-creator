import { describe, expect, it } from 'vitest'
import { mediaKey, posterKey, proxyKey, renderKey, thumbnailKey, waveformKey } from '../keys.js'

const WORKSPACE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const MEDIA_ASSET_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX'
const MUSIC_TRACK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY'
const RENDER_JOB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ'

describe('mediaKey', () => {
  it('workspaceId / mediaAssetId / 拡張子から key を組み立てる', () => {
    expect(mediaKey(WORKSPACE_ID, MEDIA_ASSET_ID, 'mp4')).toBe(
      `media/${WORKSPACE_ID}/${MEDIA_ASSET_ID}/original.mp4`,
    )
  })

  it('空文字は throw する', () => {
    expect(() => mediaKey('', MEDIA_ASSET_ID, 'mp4')).toThrow()
    expect(() => mediaKey(WORKSPACE_ID, '', 'mp4')).toThrow()
    expect(() => mediaKey(WORKSPACE_ID, MEDIA_ASSET_ID, '')).toThrow()
  })

  it('`/` を含む入力は throw する', () => {
    expect(() => mediaKey('a/b', MEDIA_ASSET_ID, 'mp4')).toThrow()
  })

  it('`..` を含む入力は throw する', () => {
    expect(() => mediaKey('..', MEDIA_ASSET_ID, 'mp4')).toThrow()
  })
})

describe('proxyKey', () => {
  it('proxy.mp4 になる', () => {
    expect(proxyKey(WORKSPACE_ID, MEDIA_ASSET_ID)).toBe(
      `media/${WORKSPACE_ID}/${MEDIA_ASSET_ID}/proxy.mp4`,
    )
  })

  it('不正な入力は throw する', () => {
    expect(() => proxyKey('a/b', MEDIA_ASSET_ID)).toThrow()
  })
})

describe('thumbnailKey', () => {
  it('thumb.jpg になる', () => {
    expect(thumbnailKey(WORKSPACE_ID, MEDIA_ASSET_ID)).toBe(
      `media/${WORKSPACE_ID}/${MEDIA_ASSET_ID}/thumb.jpg`,
    )
  })
})

describe('posterKey', () => {
  it('index が 3 桁ゼロ埋めされる', () => {
    expect(posterKey(WORKSPACE_ID, MEDIA_ASSET_ID, 0)).toBe(
      `media/${WORKSPACE_ID}/${MEDIA_ASSET_ID}/poster-000.jpg`,
    )
    expect(posterKey(WORKSPACE_ID, MEDIA_ASSET_ID, 7)).toBe(
      `media/${WORKSPACE_ID}/${MEDIA_ASSET_ID}/poster-007.jpg`,
    )
    expect(posterKey(WORKSPACE_ID, MEDIA_ASSET_ID, 123)).toBe(
      `media/${WORKSPACE_ID}/${MEDIA_ASSET_ID}/poster-123.jpg`,
    )
  })

  it('負の値や非整数は throw する', () => {
    expect(() => posterKey(WORKSPACE_ID, MEDIA_ASSET_ID, -1)).toThrow()
    expect(() => posterKey(WORKSPACE_ID, MEDIA_ASSET_ID, 1.5)).toThrow()
  })
})

describe('waveformKey', () => {
  it('peaks.json になる', () => {
    expect(waveformKey(PROJECT_ID, MUSIC_TRACK_ID)).toBe(
      `music/${PROJECT_ID}/${MUSIC_TRACK_ID}/peaks.json`,
    )
  })

  it('不正な入力は throw する', () => {
    expect(() => waveformKey('', MUSIC_TRACK_ID)).toThrow()
  })
})

describe('renderKey', () => {
  it('output.{ext} になる', () => {
    expect(renderKey(PROJECT_ID, RENDER_JOB_ID, 'mp4')).toBe(
      `renders/${PROJECT_ID}/${RENDER_JOB_ID}/output.mp4`,
    )
  })

  it('不正な入力は throw する', () => {
    expect(() => renderKey(PROJECT_ID, '..', 'mp4')).toThrow()
  })
})
