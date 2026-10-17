/**
 * JPEG にサムネイルの ID を書き込む（コメントの区切り COM。絵は変わらない）。
 *
 * **なぜ書くか。** 素材の表は同じ中身を 1 つしか持てない（checksum の一意は表全体）。同じ仕様で描くと
 * 同じバイト列になり、別の作品の素材を指すしかなくなる。その素材が消されると行の JPEG が外れ、
 * 「終わったのに JPEG が無い」行ができる。ID を書けば書き出しごとに中身が別になり、いつも自分の作品の素材を持てる。
 */

const SOI = [0xff, 0xd8] as const
const COM_MARKER = [0xff, 0xfe] as const
/** COM の長さは 2 バイトで、長さの 2 バイト自身を含む。 */
const MAX_COMMENT_BYTES = 0xffff - 2

export const stampJpeg = (body: Uint8Array, label: string): Buffer => {
  if (body[0] !== SOI[0] || body[1] !== SOI[1]) throw new Error('JPEG ではないファイルに印を書こうとしました')
  const comment = Buffer.from(label, 'utf8')
  if (comment.byteLength > MAX_COMMENT_BYTES) throw new Error('JPEG に書く印が長すぎます')
  const length = comment.byteLength + 2
  const segment = Buffer.from([...COM_MARKER, (length >> 8) & 0xff, length & 0xff])
  return Buffer.concat([Buffer.from(SOI), segment, comment, Buffer.from(body.subarray(2))])
}
