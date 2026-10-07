import type { StorageKey } from './port.js'

/**
 * 拡張子から Content-Type を決める。
 *
 * **fs ドライバはメタデータを別に持たない。** 置いたものがそのまま Finder から見える形で
 * いてほしいので、`.meta.json` のような付き添いのファイルを並べない（ADR-0041）。
 * そのため `put` で渡された contentType は保存せず、読むときに拡張子から決め直す。
 * `storageKey` の拡張子は `packages/storage/src/keys.ts` と
 * `apps/api` の取り込みが決めているので、素材・書き出し・波形はこの表で足りる。
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  json: 'application/json',
  srt: 'application/x-subrip',
  txt: 'text/plain',
}

/** 拡張子が分からないときに返す型。 */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/** key の拡張子に対応する Content-Type。分からなければ `application/octet-stream`。 */
export const contentTypeForKey = (key: StorageKey): string => {
  const dot = key.lastIndexOf('.')
  const slash = key.lastIndexOf('/')
  if (dot <= 0 || dot < slash || dot === key.length - 1) return DEFAULT_CONTENT_TYPE
  return CONTENT_TYPES[key.slice(dot + 1).toLowerCase()] ?? DEFAULT_CONTENT_TYPE
}
