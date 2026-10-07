import path from 'node:path'
import type { StorageKey } from './port.js'

/**
 * storageKey を手元のファイルの場所へ直す（ADR-0041）。
 *
 * **ここは URL から来た key を受ける門でもある。** 画面や worker が作る key は
 * `keys.ts` が組み立てているが、配信ルートの key は利用者が書き換えられるので、
 * 信用せずにこの関数を通す。
 */

/**
 * セグメントに使える形。**先頭は英数字に限る。**
 * これで `..`（親へ戻る）と `.DS_Store` のような隠しファイルを同時に弾ける。
 */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_KEY_LENGTH = 1024
const MAX_SEGMENT_LENGTH = 255

/** key の形が受け取れないときに throw される。**key 自体はメッセージに入れない**（そのままログや画面に出さない）。 */
export class InvalidStorageKeyError extends Error {
  constructor(
    readonly key: StorageKey,
    readonly reason: string,
  ) {
    super(`storageKey として受け取れません: ${reason}`)
    this.name = 'InvalidStorageKeyError'
  }
}

/**
 * 解決した場所が根の中かどうか。
 *
 * `SEGMENT_PATTERN` が `..` を弾くので普段ここで止まることはないが、**2 重の柵**として置く
 * （ADR-0036 と同じ考え方）。柵そのものを試験できるよう、独立した関数にしている。
 */
export const isInsideRoot = (root: string, candidate: string): boolean => {
  const normalizedRoot = path.resolve(root)
  const normalized = path.resolve(candidate)
  return normalized.startsWith(normalizedRoot + path.sep) && normalized.length > normalizedRoot.length + 1
}

/** key の形だけを検証する（ファイルの有無は見ない）。不正なら InvalidStorageKeyError。 */
export const assertValidStorageKey = (key: StorageKey): void => {
  if (key.length === 0) throw new InvalidStorageKeyError(key, '空です')
  if (key.length > MAX_KEY_LENGTH) throw new InvalidStorageKeyError(key, '長すぎます')
  if (key.includes('\\')) throw new InvalidStorageKeyError(key, '逆向きの区切りは使えません')
  if (key.includes('\0')) throw new InvalidStorageKeyError(key, '制御文字は使えません')
  if (path.isAbsolute(key)) throw new InvalidStorageKeyError(key, '絶対パスは使えません')

  for (const segment of key.split('/')) {
    if (segment.length > MAX_SEGMENT_LENGTH) {
      throw new InvalidStorageKeyError(key, '区切りが長すぎます')
    }
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new InvalidStorageKeyError(key, `使えない区切りがあります: ${JSON.stringify(segment)}`)
    }
  }
}

/**
 * 根と key から絶対パスを作る。根の外へ出る形は InvalidStorageKeyError。
 * **シンボリックリンクはここでは見ない**（実体を触る直前に `fs.realpath` で確かめる。fs-storage 側）。
 */
export const resolveStoragePath = (root: string, key: StorageKey): string => {
  if (!path.isAbsolute(root)) {
    throw new Error('ストレージの根は絶対パスで渡してください')
  }
  assertValidStorageKey(key)

  const resolved = path.resolve(root, key)
  if (!isInsideRoot(root, resolved)) {
    throw new InvalidStorageKeyError(key, '根の外を指しています')
  }
  return resolved
}
