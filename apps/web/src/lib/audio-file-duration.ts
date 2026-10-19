/**
 * 音の長さ（秒）を、ブラウザで読む。読めなければ理由を付けて失敗にする（長さの分からない効果音は置かない）。
 * 失敗の文に URL は入れない（署名付き URL を知らせやログに出さない）。名前だけを入れる。
 */
const readDurationSec = (src: string, name: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const audio = new Audio()
    const done = (): void => {
      audio.removeAttribute('src')
    }
    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => {
      const duration = audio.duration
      done()
      if (Number.isFinite(duration) && duration > 0) resolve(duration)
      else reject(new Error(`「${name}」の長さを読めませんでした`))
    })
    audio.addEventListener('error', () => {
      done()
      reject(new Error(`「${name}」は音として読めませんでした`))
    })
    audio.src = src
  })

/** 手元の音のファイルの長さ。上げた直後はサーバがまだ長さを測っていないため、ブラウザで読む。 */
export const audioFileDurationSec = (file: File): Promise<number> => {
  const url = URL.createObjectURL(file)
  return readDurationSec(url, file.name).finally(() => {
    URL.revokeObjectURL(url)
  })
}

/** 上げてある音（署名付き URL）の長さ。`name` は失敗の文に出す名前。 */
export const audioUrlDurationSec = (url: string, name: string): Promise<number> => readDurationSec(url, name)
