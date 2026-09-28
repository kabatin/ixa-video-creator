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

const clip = (id: string, content: TimelineClip['content']) =>
  TimelineClip.parse({
    id,
    projectId: aProject.id,
    track: content.type === 'media' ? 'VIDEO2' : 'TEXT',
    startSec: 1,
    durationSec: 2,
    layer: 0,
    content,
    opacity: 1,
    createdAt: new Date(),
  })

const fake = vi.hoisted(() => ({
  listClips: vi.fn(),
  updateClip: vi.fn(),
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
    clip(OTHER_TEXT, { type: 'text', templateKey: 'plain', params: { text: '二行目' } }),
    clip(MEDIA_CLIP, { type: 'media', mediaAssetId: MediaAssetId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB4'), inSec: 0, outSec: 2, volume: 1 }),
  ])
  fake.updateClip.mockImplementation((id: string, patch: { content: TimelineClip['content'] }) =>
    Promise.resolve(clip(id, patch.content)),
  )
  fake.listTextStyles.mockResolvedValue([preset])
  fake.applyTextStyle.mockResolvedValue([])
  fake.createTextStyle.mockImplementation((_project: string, body: { name: string; style: object }) =>
    Promise.resolve({ ...preset, id: TextStyleId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB5'), ...body }),
  )
})

const open = async () => {
  renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
  await screen.findByText('一行目')
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
