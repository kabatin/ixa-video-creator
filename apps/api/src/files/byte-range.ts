/**
 * `Range` ヘッダの読み取り（純粋関数。ADR-0041）。
 *
 * 動画のシークはこれに乗っている。**自分で書く以上、境目を試験で固定する。**
 * Safari は再生の前に `bytes=0-1` のような小さな範囲を投げるので、
 * 「頭の 2 バイトだけ」を正しく 206 で返せないと再生が始まらない。
 *
 * 読めない形・扱わない形（単位違い・複数範囲・逆向き）は **全体を返す**（RFC 9110 は
 * 不正な `Range` を無視してよいと決めている）。断るのは「範囲として筋が通っているが
 * ファイルの外」のときだけ（416）。
 */

export type ByteRange = {
  readonly start: number
  /** 最後のバイトの位置（この位置も含む）。 */
  readonly end: number
}

export type RangeRequest =
  /** 全体を返す（`Range` が無い・読めない・扱わない形）。 */
  | { readonly kind: 'full' }
  | { readonly kind: 'partial'; readonly range: ByteRange }
  /** 範囲としては筋が通っているが、ファイルの外を指している（416 を返す）。 */
  | { readonly kind: 'unsatisfiable' }

const FULL: RangeRequest = { kind: 'full' }
const UNSATISFIABLE: RangeRequest = { kind: 'unsatisfiable' }

/** `bytes=` に続く 1 つの範囲。`0-1` / `100-` / `-500` の 3 つの形だけを受ける。 */
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

export const parseByteRange = (header: string | undefined | null, sizeBytes: number): RangeRequest => {
  if (header === undefined || header === null || header.trim() === '') return FULL

  const matched = SINGLE_RANGE.exec(header.trim().toLowerCase())
  if (matched === null) return FULL

  const [, rawStart = '', rawEnd = ''] = matched
  // `-` だけ（どちらも空）は形として無効。
  if (rawStart === '' && rawEnd === '') return FULL

  // 空のファイルは、どの範囲も満たせない。
  if (sizeBytes === 0) return UNSATISFIABLE

  // 末尾から数える形（`-500` = 最後の 500 バイト）。
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0) return UNSATISFIABLE
    return { kind: 'partial', range: { start: Math.max(0, sizeBytes - suffix), end: sizeBytes - 1 } }
  }

  const start = Number(rawStart)
  if (start >= sizeBytes) return UNSATISFIABLE

  // 終わりを書かない形（`100-` = 100 バイト目から最後まで）。
  if (rawEnd === '') return { kind: 'partial', range: { start, end: sizeBytes - 1 } }

  const end = Number(rawEnd)
  // 逆向きは形として無効（断らずに全体を返す）。
  if (end < start) return FULL
  // ファイルの末尾を越えて頼まれたら、末尾までに縮める。
  return { kind: 'partial', range: { start, end: Math.min(end, sizeBytes - 1) } }
}

/** 206 で返す `Content-Range` の値。 */
export const contentRangeHeader = (range: ByteRange, sizeBytes: number): string =>
  `bytes ${String(range.start)}-${String(range.end)}/${String(sizeBytes)}`

/** 416 で返す `Content-Range` の値（満たせる範囲の大きさだけを伝える）。 */
export const unsatisfiedRangeHeader = (sizeBytes: number): string => `bytes */${String(sizeBytes)}`

/** 返すバイト数。 */
export const rangeLength = (range: ByteRange): number => range.end - range.start + 1
