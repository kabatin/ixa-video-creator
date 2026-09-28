import { MediaAssetId, TextStyleId, TimelineClip, TimelineClipId } from '@ixa/domain'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TextClipInspector } from '@/components/workbench/inspector/text-clip-inspector'
import { aProject, renderInWorkbench } from './workbench-fixture'

/**
 * テロップのインスペクター（ADR-0028）。欄を変えると、その項目だけを重ねた params を送る。
 * 文字・どのスタイルからか・他の項目は残す。
 */

const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')
const OTHER_TEXT = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')
const MEDIA_CLIP = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB2')
const PRESET_ID = TextStyleId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB3')

const clip = (id: string, content: TimelineClip['content'], span = { startSec: 1, durationSec: 2 }) =>
  TimelineClip.parse({
    id,
    projectId: aProject.id,
    track: content.type === 'media' ? 'VIDEO2' : 'TEXT',
    ...span,
    layer: 0,
    content,
    opacity: 1,
    createdAt: new Date(),
  })

const fake = vi.hoisted(() => ({
  listClips: vi.fn(),
  updateClip: vi.fn(),
  deleteClip: vi.fn(),
  listTextStyles: vi.fn(),
  createTextStyle: vi.fn(),
  updateTextStyle: vi.fn(),
  deleteTextStyle: vi.fn(),
  applyTextStyle: vi.fn(),
}))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => fake }))

const preset = {
  id: PRESET_ID,
  projectId: aProject.id,
  name: '歌詞',
  style: { color: '#FFD100', anchor: 'bottom-center' },
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  for (const fn of Object.values(fake)) fn.mockReset()
  fake.listClips.mockResolvedValue([
    clip(CLIP_ID, { type: 'text', templateKey: 'plain', params: { text: '一行目', style: { size: 0.05 }, styleId: null } }),
    clip(OTHER_TEXT, { type: 'text', templateKey: 'plain', params: { text: '二行目' } }, { startSec: 5, durationSec: 2 }),
    clip(MEDIA_CLIP, { type: 'media', mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB4'), inSec: 0, outSec: 2, volume: 1 }),
  ])
  fake.updateClip.mockImplementation(
    (id: string, patch: { content?: TimelineClip['content']; startSec?: number; durationSec?: number }) =>
      Promise.resolve(
        clip(id, patch.content ?? { type: 'text', templateKey: 'plain', params: { text: '一行目' } }, {
          startSec: patch.startSec ?? 1,
          durationSec: patch.durationSec ?? 2,
        }),
      ),
  )
  fake.deleteClip.mockResolvedValue(undefined)
  fake.listTextStyles.mockResolvedValue([preset])
  fake.applyTextStyle.mockResolvedValue([])
  fake.createTextStyle.mockImplementation((_project: string, body: { name: string; style: object }) =>
    Promise.resolve({ ...preset, id: TextStyleId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB5'), ...body }),
  )
})

const open = async () => {
  const { value } = renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
  await screen.findByText('一行目')
  return value
}
const sentParams = () => (fake.updateClip.mock.calls.at(-1)?.[1] as { content: { params: unknown } }).content.params

describe('TextClipInspector', () => {
  it('書体を変えると、その項目だけを重ねて保存する（文字と他の見た目は残す）', async () => {
    await open()

    await userEvent.selectOptions(screen.getByLabelText('書体'), 'mincho')

    await waitFor(() => {
      expect(sentParams()).toEqual({ text: '一行目', style: { size: 0.05, font: 'mincho' }, styleId: null })
    })
  })

  it('定位置は 3×3 のボタンで選ぶ', async () => {
    await open()

    await userEvent.click(screen.getByRole('button', { name: '左上に置く' }))

    await waitFor(() => {
      expect(sentParams()).toMatchObject({ style: { anchor: 'top-left' } })
    })
  })

  it('大きさは画面の高さの %（空欄で自動に戻る）', async () => {
    await open()
    const size = screen.getByLabelText('大きさ（%）')
    expect((size as HTMLInputElement).value).toBe('5')

    await userEvent.clear(size)
    await userEvent.type(size, '8{Enter}')

    await waitFor(() => {
      expect(sentParams()).toMatchObject({ style: { size: 0.08 } })
    })
  })

  it('色はピッカーを閉じた（確定した）時点で保存する', async () => {
    await open()

    fireEvent.change(screen.getByLabelText('色'), { target: { value: '#ffd100' } })

    await waitFor(() => {
      expect(sentParams()).toMatchObject({ style: { color: '#FFD100' } })
    })
  })

  it('保存したスタイルをこのテロップに当てる', async () => {
    await open()

    await userEvent.click(await screen.findByRole('button', { name: 'このテロップに当てる' }))

    expect(fake.applyTextStyle).toHaveBeenCalledWith(aProject.id, {
      clipIds: [CLIP_ID],
      style: preset.style,
      styleId: PRESET_ID,
    })
  })

  it('TEXT 帯のすべてに当てるのは、確かめてから（テロップだけ・メディアは含めない）', async () => {
    await open()

    await userEvent.click(await screen.findByRole('button', { name: 'TEXT 帯のすべてに当てる' }))
    const dialog = screen.getByRole('alertdialog', { name: 'TEXT 帯のすべてに当てる' })
    expect(fake.applyTextStyle).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'すべてに当てる' }))

    expect(fake.applyTextStyle).toHaveBeenCalledWith(aProject.id, {
      clipIds: [CLIP_ID, OTHER_TEXT],
      style: preset.style,
      styleId: PRESET_ID,
    })
  })

  it('いまの見た目に名前を付けて保存し、このテロップをそのスタイルに紐づける', async () => {
    await open()

    await userEvent.type(screen.getByLabelText('新しい名前'), 'サビ')
    await userEvent.click(screen.getByRole('button', { name: 'いまの見た目を保存' }))

    await waitFor(() => {
      expect(fake.createTextStyle).toHaveBeenCalledWith(aProject.id, { name: 'サビ', style: { size: 0.05 } })
    })
    expect(fake.applyTextStyle).toHaveBeenCalledWith(aProject.id, {
      clipIds: [CLIP_ID],
      style: { size: 0.05 },
      styleId: '01ARZ3NDEKTSV4RRFFQ69G5FB5',
    })
  })

  it('文字を直しても見た目は残す', async () => {
    await open()
    const text = screen.getByLabelText('文字')

    await userEvent.clear(text)
    await userEvent.type(text, '直した{Enter}')

    await waitFor(() => {
      expect(sentParams()).toEqual({ text: '直した', style: { size: 0.05 }, styleId: null })
    })
  })
})

/**
 * 帯のテロップを押すと、小窓ではなくインスペクターで開く（2026-09-28、制作者の指摘「小窓は見切れて編集しづらい」）。
 * 小窓が受け持っていた開始・尺・削除も、ここで直せる。
 */
describe('TextClipInspector の時間と削除', () => {
  const retype = async (label: string, next: string) => {
    const field = screen.getByLabelText(label)
    await userEvent.clear(field)
    await userEvent.type(field, `${next}{Enter}`)
  }

  it('開始を直すと、開始だけを送る', async () => {
    await open()

    await retype('開始', '0:02.50')

    await waitFor(() => {
      expect(fake.updateClip).toHaveBeenCalledWith(CLIP_ID, { startSec: 2.5 })
    })
  })

  it('尺を直すと、尺だけを送る', async () => {
    await open()

    await retype('尺', '3.25s')

    await waitFor(() => {
      expect(fake.updateClip).toHaveBeenCalledWith(CLIP_ID, { durationSec: 3.25 })
    })
  })

  it('別のテロップと重なる開始は保存せず、理由を出す', async () => {
    await open()

    await retype('開始', '0:04.50')

    expect(await screen.findByText(/重なります/)).toBeTruthy()
    expect(fake.updateClip).not.toHaveBeenCalled()
  })

  it('削除は確かめてから。消したらインスペクターを閉じる', async () => {
    const value = await open()

    await userEvent.click(screen.getByRole('button', { name: 'テロップ「一行目」のその他の操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'テロップを削除' }))
    expect(fake.deleteClip).not.toHaveBeenCalled()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'テロップを削除' }))

    await waitFor(() => {
      expect(fake.deleteClip).toHaveBeenCalledWith(CLIP_ID)
    })
    expect(value.inspect).toHaveBeenCalledWith(null)
  })
})
