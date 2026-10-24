/**
 * 文字をクリップボードへ書く。**画面のコピーはすべてここを通す。**
 *
 * `navigator.clipboard` は https か localhost でしか出てこない。LAN（http）で開くと口そのものが無く、
 * 直に呼ぶと押した瞬間にエラーになっていた（制作者 2026-10-24、鍵の「写す」）。
 * 口が無いか断られたときは、見えない欄に入れて選び、`execCommand('copy')` で書く。
 */
export const copyText = async (text: string): Promise<void> => {
  const clipboard = (navigator as Partial<Navigator>).clipboard
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text)
      return
    } catch {
      // 権限で断られることがある。古い手で続ける。
    }
  }
  if (!copyBySelection(text)) {
    throw new Error('コピーできませんでした。表示された文字を選んでコピーしてください')
  }
}

const copyBySelection = (text: string): boolean => {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  try {
    field.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}
