import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileIntake } from '@/components/workbench/file-intake'
import { renderInWorkbench } from './workbench-fixture'

/**
 * 画像を落としたら行き先を聞く（制作者 2026-10-03「画像をドロップしても登録先を選ぶ画面が出てこない」）。
 *
 * パネルの配置の仕組み（dockview）は、パネルの上に落ちたファイルに「受けた」印（preventDefault）を付ける。
 * その印を見て「ほかが受けた」とみなしていたので、パネルの上に落とすと何も起きなかった（実機で再現）。
 */

/** jsdom には DataTransfer が無い。落としたファイルの形だけ持たせる。 */
const dropEvent = (files: readonly File[]): Event => {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files } })
  return event
}

describe('FileIntake', () => {
  it('パネルの仕組みが印を付けたドロップでも、行き先を聞く', () => {
    renderInWorkbench(<FileIntake onNotice={vi.fn()} registerOpener={vi.fn()} />)
    const event = dropEvent([new File(['x'], 'face.png', { type: 'image/png' })])
    // dockview がパネルの上で付ける印。
    event.preventDefault()

    act(() => {
      window.dispatchEvent(event)
    })

    expect(screen.getByText('画像 1 枚をどこに入れますか')).toBeTruthy()
  })

  it('素材ビューアの区画のように、受けた側が止めたドロップには何もしない', () => {
    renderInWorkbench(<FileIntake onNotice={vi.fn()} registerOpener={vi.fn()} />)
    const area = document.createElement('div')
    document.body.append(area)
    area.addEventListener('drop', (event) => {
      event.stopPropagation()
    })

    act(() => {
      area.dispatchEvent(dropEvent([new File(['x'], 'face.png', { type: 'image/png' })]))
    })

    expect(screen.queryByText('画像 1 枚をどこに入れますか')).toBeNull()
    area.remove()
  })
})
