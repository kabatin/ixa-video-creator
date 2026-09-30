import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutoSaveColor } from '@/components/workbench/ui/auto-save-choice'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'

/**
 * 欄が画面に出た直後に打った値を、保存済みの値で上書きしない（`AutoSaveField` / `AutoSaveColor`）。
 *
 * 保存済みの値を下書きへ写すのを `useEffect` でしていたころは、欄が出てから effect が走るまでに隙間があった。
 * 遅い CI ではその隙間で消して打った値が、あとから走った effect で元の値に戻り、保存されずに落ちていた
 * （「5」を消して「8」と打つと「58」になる。2026-09-30）。act を使わずに描き、隙間を再現する。
 */

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT

afterEach(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous
  document.body.innerHTML = ''
})

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

/** 人が打ったのと同じく、React が拾う形で値を入れる。 */
const typeInto = (input: HTMLInputElement, text: string, event: 'input' | 'change'): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
  input.dispatchEvent(new Event(event, { bubbles: true }))
}

/** 描いた後に積まれた仕事（effect）を走らせる。 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const mount = (ui: React.ReactNode, selector: string) => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  const container = document.createElement('div')
  document.body.append(container)
  const inserted = whenInserted(container, selector)
  createRoot(container).render(ui)
  return inserted
}

describe('欄が出た直後の編集', () => {
  it('AutoSaveField: 出た直後に打った値を保存する', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const input = await mount(<AutoSaveField label="大きさ" value="5" onSave={onSave} />, 'input')

    typeInto(input, '8', 'input')
    await settle()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()

    expect(input.value).toBe('8')
    expect(onSave).toHaveBeenCalledWith('8')
  })

  it('AutoSaveColor: 出た直後に選んだ色を画面に残す', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    const input = await mount(
      <AutoSaveColor label="色" value="#FFFFFF" onSave={onSave} />,
      'input[type=color]',
    )

    typeInto(input, '#ffd100', 'input')
    await settle()

    expect(input.value).toBe('#ffd100')
  })
})
