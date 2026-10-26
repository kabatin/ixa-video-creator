import { TimelineClip, TimelineClipId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TextClipInspector } from '@/components/workbench/inspector/text-clip-inspector'
import { aProject, renderInWorkbench } from './workbench-fixture'

/**
 * 2 段字幕（ADR-0061）。テロップのインスペクターで訳文（下の段）と、その大きさを直せる。
 * セリフの字幕は字が Shot のセリフから来るので、その旨を言い、訳文は Shot の行へ書き戻る（書き戻すのは api）。
 */

const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')
const SHOT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB9'

const clip = (params: Record<string, unknown>) =>
  TimelineClip.parse({
    id: CLIP_ID,
    projectId: aProject.id,
    track: 'TEXT',
    startSec: 1,
    durationSec: 2,
    layer: 2,
    content: { type: 'text', templateKey: 'plain', params },
    opacity: 1,
    createdAt: new Date(),
  })

const fake = vi.hoisted(() => ({ listClips: vi.fn(), updateClip: vi.fn(), applyTextStyle: vi.fn(), listTextStyles: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => fake }))

const sentParams = () => (fake.updateClip.mock.calls.at(-1)?.[1] as { content: { params: Record<string, unknown> } }).content.params

beforeEach(() => {
  for (const fn of Object.values(fake)) fn.mockReset()
  fake.listTextStyles.mockResolvedValue([])
  fake.updateClip.mockImplementation((_id: string, patch: { content: TimelineClip['content'] }) =>
    Promise.resolve(clip(patch.content.type === 'text' ? patch.content.params : {})),
  )
})

describe('訳文の欄', () => {
  it('訳文を入れると、ほかの印と見た目を残して params.translation を送る', async () => {
    fake.listClips.mockResolvedValue([clip({ text: 'こんにちは', style: { size: 0.05 } })])
    renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
    const field = await screen.findByRole('textbox', { name: '訳文（2 段目）' })
    await userEvent.type(field, 'Hello')
    await userEvent.tab()
    await waitFor(() => {
      expect(sentParams()).toEqual({ text: 'こんにちは', style: { size: 0.05 }, translation: 'Hello' })
    })
  })

  it('訳文があれば 2 段目の大きさを選べる（見た目の translationScale）', async () => {
    fake.listClips.mockResolvedValue([clip({ text: 'こんにちは', translation: 'Hello' })])
    renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
    const size = await screen.findByRole('combobox', { name: '2 段目の大きさ' })
    expect(size).toHaveProperty('value', '0.6')
    await userEvent.selectOptions(size, '0.8')
    await waitFor(() => {
      expect(sentParams()).toEqual({ text: 'こんにちは', translation: 'Hello', style: { translationScale: 0.8 } })
    })
  })

  it('訳文が無ければ 2 段目の大きさは出さない', async () => {
    fake.listClips.mockResolvedValue([clip({ text: 'こんにちは' })])
    renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
    await screen.findByRole('textbox', { name: '訳文（2 段目）' })
    expect(screen.queryByRole('combobox', { name: '2 段目の大きさ' })).not.toBeInTheDocument()
  })

  it('セリフの字幕なら、字は Shot のセリフで直すと言い、訳文は Shot の行に残ると言う', async () => {
    fake.listClips.mockResolvedValue([
      clip({ text: 'ねえ', dialogue: { shotId: SHOT_ID, lineIndex: 0, placed: { startSec: 1, durationSec: 2 } } }),
    ])
    renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Shot のセリフから作った字幕です')
    expect(note).toHaveTextContent('訳文')
  })
})
