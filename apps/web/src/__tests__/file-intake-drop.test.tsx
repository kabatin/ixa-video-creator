import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileIntake } from '@/components/workbench/file-intake'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

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

/**
 * 楽曲を落としたら、作品の方針を開く（制作者 2026-10-03「次何したらいいんだ？ってなるので、作品の方針・歌詞を入力する
 * インスペクターをアクティブにしたほうがよさそう」）。解析が先に終わると解析の待ち画面が出ないので、登録した時点でも開く。
 */
describe('FileIntake: 楽曲を落としたとき', () => {
  const track = { id: 'track-1', title: '検証の曲' }

  it('作品の方針が済んでいなければ、作品の方針を開いて次にやることを言う', async () => {
    const addTrackFromFile = vi.fn(() => Promise.resolve(track))
    const { value } = renderInWorkbench(
      <FileIntake onNotice={vi.fn()} registerOpener={vi.fn()} />,
      { concept: '' },
      { actions: { ...assetStoreValue().actions, addTrackFromFile } as never },
    )

    await act(async () => {
      window.dispatchEvent(dropEvent([new File(['x'], 'song.wav', { type: 'audio/wav' })]))
      await Promise.resolve()
    })

    expect(addTrackFromFile).toHaveBeenCalledTimes(1)
    expect(value.inspect).toHaveBeenCalledWith({ kind: 'project', id: value.projectId })
    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
    expect(value.notify).toHaveBeenCalledWith(expect.stringContaining('作品の方針'))
  })
})
