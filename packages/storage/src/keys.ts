import type { StorageKey } from './port.js'

/**
 * storageKey の命名規約を関数として定義する。
 * 呼び出し側に文字列を手書きさせないことで、パス規約のずれを防ぐ。
 */

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/

/** id や拡張子として不正な文字列（空文字、`/`、`..` を含む等）を弾く */
const assertValidSegment = (value: string, label: string): void => {
  if (value.length === 0) {
    throw new Error(`${label} は空文字にできません`)
  }
  if (!SEGMENT_PATTERN.test(value)) {
    throw new Error(`${label} に不正な文字が含まれています: ${value}`)
  }
}

const padIndex = (index: number): string => {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`index は 0 以上の整数である必要があります: ${index}`)
  }
  return String(index).padStart(3, '0')
}

export const mediaKey = (workspaceId: string, mediaAssetId: string, ext: string): StorageKey => {
  assertValidSegment(workspaceId, 'workspaceId')
  assertValidSegment(mediaAssetId, 'mediaAssetId')
  assertValidSegment(ext, 'ext')
  return `media/${workspaceId}/${mediaAssetId}/original.${ext}`
}

export const proxyKey = (workspaceId: string, mediaAssetId: string): StorageKey => {
  assertValidSegment(workspaceId, 'workspaceId')
  assertValidSegment(mediaAssetId, 'mediaAssetId')
  return `media/${workspaceId}/${mediaAssetId}/proxy.mp4`
}

export const thumbnailKey = (workspaceId: string, mediaAssetId: string): StorageKey => {
  assertValidSegment(workspaceId, 'workspaceId')
  assertValidSegment(mediaAssetId, 'mediaAssetId')
  return `media/${workspaceId}/${mediaAssetId}/thumb.jpg`
}

export const posterKey = (workspaceId: string, mediaAssetId: string, index: number): StorageKey => {
  assertValidSegment(workspaceId, 'workspaceId')
  assertValidSegment(mediaAssetId, 'mediaAssetId')
  return `media/${workspaceId}/${mediaAssetId}/poster-${padIndex(index)}.jpg`
}

export const waveformKey = (projectId: string, musicTrackId: string): StorageKey => {
  assertValidSegment(projectId, 'projectId')
  assertValidSegment(musicTrackId, 'musicTrackId')
  return `music/${projectId}/${musicTrackId}/peaks.json`
}

export const renderKey = (projectId: string, renderJobId: string, ext: string): StorageKey => {
  assertValidSegment(projectId, 'projectId')
  assertValidSegment(renderJobId, 'renderJobId')
  assertValidSegment(ext, 'ext')
  return `renders/${projectId}/${renderJobId}/output.${ext}`
}

/** 最終フレーム。連続性の参照に使う（ARCHITECTURE.md §8）。 */
export const lastFrameKey = (workspaceId: string, mediaAssetId: string): StorageKey => {
  assertValidSegment(workspaceId, 'workspaceId')
  assertValidSegment(mediaAssetId, 'mediaAssetId')
  return `media/${workspaceId}/${mediaAssetId}/last-frame.jpg`
}
