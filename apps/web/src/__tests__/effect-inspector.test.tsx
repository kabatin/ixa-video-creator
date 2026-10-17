import { TimelineClip, TimelineClipId, defaultEffectParams } from '@ixa/domain'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectInspector } from '@/components/workbench/inspector/effect-inspector'
import { aProject, renderInWorkbench } from './workbench-fixture'

/** エフェクトのインスペクター（ADR-0050）。項目は domain のスキーマから並べ、変えた項目だけを重ねて送る。 */

const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FC0')

const clip = (content: TimelineClip['content'], span = { startSec: 1, durationSec: 0.4 }) =>
  TimelineClip.parse({ id: CLIP_ID, projectId: aProject.id, track: 'VFX', ...span, layer: 0, content, opacity: 1, createdAt: new Date() })

const fake = vi.hoisted(() => ({ listClips: vi.fn(), updateClip: vi.fn(), deleteClip: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => fake }))

const flash = { type: 'motion_graphics' as const, templateKey: 'flash', params: { ...defaultEffectParams('flash') } }

beforeEach(() => {
  for (const fn of Object.values(fake)) fn.mockReset()
  fake.listClips.mockResolvedValue([clip(flash)])
  fake.updateClip.mockImplementation((_id: string, patch: { content?: TimelineClip['content']; startSec?: number; durationSec?: number }) =>
    Promise.resolve(clip(patch.content ?? flash, { startSec: patch.startSec ?? 1, durationSec: patch.durationSec ?? 0.4 })),
  )
  fake.deleteClip.mockResolvedValue(undefined)
})

const sent = () => fake.updateClip.mock.calls.at(-1)?.[1] as { content?: { templateKey: string; params: Record<string, unknown> } } | undefined

describe('EffectInspector', () => {
  it('VFX のクリップを読み、型の名前と項目を日本語で出す（px・生の秒を出さない）', async () => {
    renderInWorkbench(<EffectInspector id={CLIP_ID} />)
    expect(await screen.findByText('エフェクト', { selector: 'span' })).toBeTruthy()
    expect(fake.listClips).toHaveBeenCalledWith(aProject.id, 'VFX')
    expect(screen.getByLabelText('強さ')).toBeTruthy()
    expect(screen.getByLabelText('色')).toBeTruthy()
    expect(screen.getByText('90%')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/px|attackSec|intensity/)
  })

  it('つまみを離したら、その項目だけを変えた値を送る', async () => {
    renderInWorkbench(<EffectInspector id={CLIP_ID} />)
    const slider = await screen.findByLabelText('強さ')
    fireEvent.change(slider, { target: { value: '0.5' } })
    fireEvent.pointerUp(slider)
    await waitFor(() => {
      expect(sent()?.content).toEqual({ type: 'motion_graphics', templateKey: 'flash', params: { ...defaultEffectParams('flash'), intensity: 0.5 } })
    })
  })

  it('種類を変えると、新しい種類の既定の値にする', async () => {
    renderInWorkbench(<EffectInspector id={CLIP_ID} />)
    await userEvent.selectOptions(await screen.findByLabelText('種類'), 'zoom_punch')
    await waitFor(() => {
      expect(sent()?.content).toEqual({ type: 'motion_graphics', templateKey: 'zoom_punch', params: defaultEffectParams('zoom_punch') })
    })
  })

  it('タイトルカードは文字の欄を出す', async () => {
    fake.listClips.mockResolvedValue([clip({ type: 'motion_graphics', templateKey: 'title_card', params: { ...defaultEffectParams('title_card'), text: '決勝' } })])
    renderInWorkbench(<EffectInspector id={CLIP_ID} />)
    expect(await screen.findByDisplayValue('決勝')).toBeTruthy()
    expect(screen.getByLabelText('書体')).toBeTruthy()
  })

  /** 2026-10-17 のレビュー。描いた時点の中身から作ると、2 回目が 1 回目を古い値で上書きした。 */
  it('続けて 2 つの項目を保存すると、順に送り、2 回目は 1 回目の値を残す', async () => {
    const resolvers: (() => void)[] = []
    fake.updateClip.mockImplementation((_id: string, patch: { content?: TimelineClip['content'] }) =>
      new Promise((resolve) => {
        resolvers.push(() => {
          resolve(clip(patch.content ?? flash))
        })
      }),
    )
    renderInWorkbench(<EffectInspector id={CLIP_ID} />)
    const intensity = await screen.findByLabelText('強さ')
    const attack = screen.getByLabelText('立ち上がり')
    fireEvent.change(intensity, { target: { value: '0.5' } })
    fireEvent.pointerUp(intensity)
    fireEvent.change(attack, { target: { value: '0.2' } })
    fireEvent.pointerUp(attack)
    await waitFor(() => {
      expect(fake.updateClip).toHaveBeenCalledTimes(1)
    })
    resolvers[0]?.()
    await waitFor(() => {
      expect(fake.updateClip).toHaveBeenCalledTimes(2)
    })
    resolvers[1]?.()
    expect(sent()?.content?.params).toEqual({ ...defaultEffectParams('flash'), intensity: 0.5, attackSec: 0.2 })
  })

  it('読めない値の理由は画面の言葉で出す（生の値を出さない）', async () => {
    fake.listClips.mockResolvedValue([clip({ type: 'motion_graphics', templateKey: 'speed_lines', params: { direction: 'vertical' } })])
    renderInWorkbench(<EffectInspector id={CLIP_ID} />)
    const alert = await screen.findByText(/値を読めないので/)
    expect(alert.textContent).toContain('中心から')
    expect(alert.textContent).not.toMatch(/vertical|radial|horizontal/)
  })

  it('知らない種類は理由を出し、選び直せる', async () => {
    fake.listClips.mockResolvedValue([clip({ type: 'motion_graphics', templateKey: 'ink_splash', params: {} })])
    renderInWorkbench(<EffectInspector id={CLIP_ID} />)
    expect(await screen.findByText(/知らない種類のエフェクトです/)).toBeTruthy()
  })
})
