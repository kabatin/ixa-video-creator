import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileIntake } from '@/components/workbench/file-intake'
import { assetStoreValue, renderInWorkbench } from './workbench-fixture'

/** jsdom は音の長さを読めない。ファイル名で長さを決める（short は 2 秒、それ以外は 2 分）。 */
vi.mock('@/lib/audio-file-duration', () => ({
  audioFileDurationSec: (file: File) => Promise.resolve(file.name.startsWith('short') ? 2 : 120),
  audioUrlDurationSec: () => Promise.resolve(2),
}))

const importSfxFile = vi.fn((file: File) => Promise.resolve({ title: file.name.replace(/\.[^.]+$/, '') }))
vi.mock('@/components/workbench/use-sfx-file-import', () => ({
  useSfxFileImport: () => importSfxFile,
}))

beforeEach(() => {
  importSfxFile.mockClear()
})

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
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: '取り込む' }))
    })

    expect(addTrackFromFile).toHaveBeenCalledTimes(1)
    expect(value.inspect).toHaveBeenCalledWith({ kind: 'project', id: value.projectId })
    expect(value.focusPanel).toHaveBeenCalledWith('inspector')
    expect(value.notify).toHaveBeenCalledWith(expect.stringContaining('作品の方針'))
  })
})

/**
 * 音を落としたら、楽曲か効果音かを 1 回だけ聞く（制作者 2026-10-19「ドラッグしたとき、楽曲か効果音かを選べるようにしましょう」。
 * 効果音のつもりの WAV が楽曲として取り込まれた）。短い音は効果音、長い音は楽曲を選んだ状態で出す。
 */
describe('FileIntake: 音を落としたとき', () => {
  const drop = async (files: readonly File[]): Promise<void> => {
    await act(async () => {
      window.dispatchEvent(dropEvent(files))
      await Promise.resolve()
    })
  }

  it('短い音は効果音を選んだ状態で聞き、そのまま取り込むと効果音になる', async () => {
    const addTrackFromFile = vi.fn()
    const onNotice = vi.fn()
    const { value } = renderInWorkbench(
      <FileIntake onNotice={onNotice} registerOpener={vi.fn()} />,
      {},
      { actions: { ...assetStoreValue().actions, addTrackFromFile } },
    )

    await drop([new File(['x'], 'short-hit.wav', { type: 'audio/wav' })])

    expect(await screen.findByText('音 1 本を何として取り込みますか')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /効果音/ })).toBeChecked()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取り込む' }))
      await Promise.resolve()
    })

    expect(importSfxFile).toHaveBeenCalledTimes(1)
    expect(addTrackFromFile).not.toHaveBeenCalled()
    expect(value.bumpSfx).toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('「short-hit」を効果音として取り込みました'))
    expect(screen.queryByText('音 1 本を何として取り込みますか')).toBeNull()
  })

  it('長い音は楽曲を選んだ状態で聞く。効果音に選び直せる', async () => {
    const addTrackFromFile = vi.fn()
    renderInWorkbench(
      <FileIntake onNotice={vi.fn()} registerOpener={vi.fn()} />,
      {},
      { actions: { ...assetStoreValue().actions, addTrackFromFile } },
    )

    await drop([new File(['x'], 'long-ambience.wav', { type: 'audio/wav' })])

    expect(await screen.findByRole('radio', { name: /楽曲/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /効果音/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取り込む' }))
      await Promise.resolve()
    })

    expect(importSfxFile).toHaveBeenCalledTimes(1)
    expect(addTrackFromFile).not.toHaveBeenCalled()
  })

  it('何本かまとめて落としたら 1 回で聞き、全部を同じ扱いで取り込む', async () => {
    const addTrackFromFile = vi.fn()
    renderInWorkbench(
      <FileIntake onNotice={vi.fn()} registerOpener={vi.fn()} />,
      {},
      { actions: { ...assetStoreValue().actions, addTrackFromFile } },
    )

    await drop([
      new File(['x'], 'short-a.wav', { type: 'audio/wav' }),
      new File(['x'], 'short-b.wav', { type: 'audio/wav' }),
    ])

    expect(await screen.findByText('音 2 本を何として取り込みますか')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取り込む' }))
      await Promise.resolve()
    })

    expect(importSfxFile).toHaveBeenCalledTimes(2)
  })

  it('閉じたら何も取り込まない', async () => {
    const addTrackFromFile = vi.fn()
    renderInWorkbench(
      <FileIntake onNotice={vi.fn()} registerOpener={vi.fn()} />,
      {},
      { actions: { ...assetStoreValue().actions, addTrackFromFile } },
    )

    await drop([new File(['x'], 'short-hit.wav', { type: 'audio/wav' })])
    await screen.findByText('音 1 本を何として取り込みますか')
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }))

    expect(importSfxFile).not.toHaveBeenCalled()
    expect(addTrackFromFile).not.toHaveBeenCalled()
  })
})
