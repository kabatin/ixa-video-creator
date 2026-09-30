import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutoSaveColor } from '@/components/workbench/ui/auto-save-choice'

/**
 * 色の確定はブラウザの `change` で拾う（`AutoSaveColor`）。**欄が画面に出た時点で、もう拾えること。**
 *
 * `useEffect` で付けていたころは、欄が DOM に入ってから付くまでに隙間があった。
 * 遅い CI ではテストがその隙間で色を変え、保存が呼ばれずに落ちていた（2026-09-30）。
 * ここでは act を使わずに描き、DOM に入った直後（effect が走る前）に `change` を送って隙間を再現する。
 */

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT

afterEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous
  document.body.innerHTML = ''
})

/** 要素が DOM に入った直後（同じタスクのマイクロタスク）に返す。 */
const whenInserted = (container: HTMLElement, selector: string): Promise<HTMLInputElement> =>
  new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const found = container.querySelector<HTMLInputElement>(selector)
      if (found === null) return
      observer.disconnect()
      resolve(found)
    })
    observer.observe(container, { childList: true, subtree: true })
  })

describe('AutoSaveColor', () => {
  it('欄が DOM に入った直後の確定も保存する', async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    const onSave = vi.fn(() => Promise.resolve())
    const container = document.createElement('div')
    document.body.append(container)
    const inserted = whenInserted(container, 'input[type=color]')

    createRoot(container).render(<AutoSaveColor label="色" value="#FFFFFF" onSave={onSave} />)
    const input = await inserted
    input.value = '#ffd100'
    input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(onSave).toHaveBeenCalledWith('#FFD100')
  })
})
