import { TimelineClip, TimelineClipId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TextClipInspector } from '@/components/workbench/inspector/text-clip-inspector'
import { marginPercentLabel, parseMarginPercent, parsePaddingPercent } from '@/lib/text-style-form'
import { aProject, renderInWorkbench } from './workbench-fixture'

/**
 * テロップの箱の余白（外側は画面の幅・高さの %、内側は文字の大きさの %）。画面に px は出さない。
 * 空欄は型の既定に戻す（見た目から項目を外す）。
 */

describe('余白の欄の読み書き', () => {
  it('外側は 0〜40%。空欄は型の既定', () => {
    expect(parseMarginPercent('5')).toEqual({ ok: true, value: 0.05 })
    expect(parseMarginPercent('0')).toEqual({ ok: true, value: 0 })
    expect(parseMarginPercent('40')).toEqual({ ok: true, value: 0.4 })
    expect(parseMarginPercent('')).toEqual({ ok: true, value: null })
    expect(parseMarginPercent('41').ok).toBe(false)
    expect(parseMarginPercent('-1').ok).toBe(false)
    expect(parseMarginPercent('abc').ok).toBe(false)
    expect(marginPercentLabel(0.08)).toBe('8')
    expect(marginPercentLabel(null)).toBe('')
  })

  it('内側は文字の大きさの 0〜200%', () => {
    expect(parsePaddingPercent('30')).toEqual({ ok: true, value: 0.3 })
    expect(parsePaddingPercent('200')).toEqual({ ok: true, value: 2 })
    expect(parsePaddingPercent('')).toEqual({ ok: true, value: null })
    expect(parsePaddingPercent('201').ok).toBe(false)
    expect(parsePaddingPercent('-5').ok).toBe(false)
  })
})

const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')

const clip = (params: Record<string, unknown>) =>
  TimelineClip.parse({
    id: CLIP_ID,
    projectId: aProject.id,
    track: 'TEXT',
    startSec: 1,
    durationSec: 2,
    layer: 0,
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

describe('インスペクターの余白の欄', () => {
  it('4 つの欄が今の値（%）で出て、px は出さない', async () => {
    fake.listClips.mockResolvedValue([clip({ text: 'ねえ', style: { marginX: 0.05 } })])
    renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
    expect(await screen.findByRole('textbox', { name: '余白（左右）' })).toHaveProperty('value', '5')
    expect(screen.getByRole('textbox', { name: '余白（上下）' })).toHaveProperty('value', '8')
    expect(screen.getByRole('textbox', { name: '内側の余白（左右）' })).toHaveProperty('value', '75')
    expect(screen.getByRole('textbox', { name: '内側の余白（上下）' })).toHaveProperty('value', '50')
    expect(document.body.textContent ?? '').not.toMatch(/px/)
  })

  it('入れた値を割合で送り、ほかの見た目は残す', async () => {
    fake.listClips.mockResolvedValue([clip({ text: 'ねえ', style: { size: 0.05 } })])
    renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
    const field = await screen.findByRole('textbox', { name: '内側の余白（左右）' })
    await userEvent.clear(field)
    await userEvent.type(field, '30')
    await userEvent.tab()
    await waitFor(() => {
      expect(sentParams()).toEqual({ text: 'ねえ', style: { size: 0.05, paddingX: 0.3 } })
    })
  })

  it('空欄にすると項目を外す（型の既定に戻す）', async () => {
    fake.listClips.mockResolvedValue([clip({ text: 'ねえ', style: { size: 0.05, marginX: 0.05 } })])
    renderInWorkbench(<TextClipInspector id={CLIP_ID} />)
    const field = await screen.findByRole('textbox', { name: '余白（左右）' })
    await userEvent.clear(field)
    await userEvent.tab()
    await waitFor(() => {
      expect(sentParams()).toEqual({ text: 'ねえ', style: { size: 0.05 } })
    })
  })
})
