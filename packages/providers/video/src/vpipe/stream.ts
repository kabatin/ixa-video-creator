/**
 * 応答本文を上限つきで読む小物（開始画像の取り寄せと、出力の保存が使う）。
 *
 * **丸ごと読んでから大きさを確かめない。** 上限を超えた時点で読み取りを止める。
 * 途中で失敗したら読み取りを取り消し、接続を握ったまま放置しない。
 */

export class BodyTooLargeError extends Error {
  override readonly name = 'BodyTooLargeError'

  constructor(readonly maxBytes: number) {
    super(`本文が上限 ${String(maxBytes)} バイトを超えました`)
  }
}

/** `Content-Length` が上限を超えると申告しているか。申告が無い・読めないときは false（読みながら確かめる）。 */
export const declaresTooLarge = (headers: Headers, maxBytes: number): boolean => {
  const declared = Number(headers.get('content-length') ?? Number.NaN)
  return Number.isFinite(declared) && declared > maxBytes
}

/**
 * 本文を塊ごとに `onChunk` へ渡し、読んだ合計のバイト数を返す。
 * 上限を超えたら `BodyTooLargeError`。どの失敗でも読み取りを取り消してから投げ直す。
 */
export const pumpWithLimit = async (
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  onChunk: (chunk: Uint8Array) => Promise<void> | void,
): Promise<number> => {
  const reader = body.getReader()
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return total
      if (value === undefined) continue
      total += value.byteLength
      if (total > maxBytes) throw new BodyTooLargeError(maxBytes)
      await onChunk(value)
    }
  } catch (error) {
    // 既に壊れた流れの取り消しは失敗しうる。元の失敗のほうを運ぶ。
    await reader.cancel(error).catch(() => undefined)
    throw error
  }
}

/** 本文を上限つきでメモリへ読む（開始画像のように小さいものだけに使う）。 */
export const readAllWithLimit = async (
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  const total = await pumpWithLimit(body, maxBytes, (chunk) => {
    chunks.push(chunk)
  })
  const merged = new Uint8Array(total)
  chunks.reduce((offset, chunk) => {
    merged.set(chunk, offset)
    return offset + chunk.byteLength
  }, 0)
  return merged
}
