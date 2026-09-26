import { useEffect, useState, type RefObject } from 'react'

/**
 * 要素の実寸の幅（CSS px）。**大きさが変わったときだけ測る。**
 *
 * `ResizeObserver` が無い環境（jsdom など）では 0 のままにする。使う側は 0 を
 * 「まだ測れていない」として扱うこと。
 *
 * 描画のたびに ref の関数で測ってはいけない。付け外しのたびに幅を入れ直すことになり、
 * 測った幅で描き直すと幅が変わる画面では止まらなくなる（カット編集がスマホ幅で
 * ページごと落ちた。390px で実測）。
 */
export const useElementWidth = (ref: RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    setWidth(element.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref])

  return width
}
