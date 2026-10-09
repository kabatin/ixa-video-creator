/**
 * 入ったあとに戻る場所（`/login?next=...`）。**この画面の中のパスだけを受ける。**
 *
 * `next` は URL に載るので、誰でも書き換えられる。`https://evil.example` や `//evil.example`
 * （プロトコルを省いた外のサイト）をそのまま開くと、合言葉を入れた直後に外のサイトへ送られる。
 */
export const safeNextPath = (raw: string | null | undefined): string => {
  if (raw === null || raw === undefined) return '/'
  const valid = raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')
  return valid ? raw : '/'
}
