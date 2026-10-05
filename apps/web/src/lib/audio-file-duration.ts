/**
 * 手元の音のファイルの長さ（秒）。ブラウザで読む（上げた直後はサーバがまだ長さを測っていないため）。
 * 読めなければ理由を付けて失敗にする（長さの分からない効果音は置かない）。
 */
export const audioFileDurationSec = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    const done = (): void => {
      URL.revokeObjectURL(url)
      audio.removeAttribute('src')
    }
    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => {
      const duration = audio.duration
      done()
      if (Number.isFinite(duration) && duration > 0) resolve(duration)
      else reject(new Error(`「${file.name}」の長さを読めませんでした`))
    })
    audio.addEventListener('error', () => {
      done()
      reject(new Error(`「${file.name}」は音として読めませんでした`))
    })
    audio.src = url
  })
