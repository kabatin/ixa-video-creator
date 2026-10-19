import { ProjectId, TimelineClip, TimelineClipId, defaultEffectParams } from '@ixa/domain'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { DEFAULT_PX_PER_SEC } from '@/lib/timeline-display'
import { PROJECT_ID } from './fixtures'

/** エフェクト（ADR-0050）を帯から置く。型を選ぶだけで、置いたらインスペクターで開く。 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const fake = vi.hoisted(() => ({ createClip: vi.fn() }))
vi.mock('@/lib/timeline-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/timeline-api')>()
  return { ...original, createTimelineApi: () => fake }
})

const projectId = ProjectId.parse(PROJECT_ID)
const NEW_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FD1')

const editor = (onOpenEffectClip: (id: TimelineClipId) => void): ReactElement => (
  <TimelineEditor
    projectId={projectId}
    shots={[]}
    initialTransitions={[]}
    initialClips={[]}
    renderedShotIds={[]}
    documentDurationSec={30}
    initialDocument={null}
    beatSource={{ state: 'no_track' }}
    beatAlignment={null}
    loadErrors={[]}
    showMonitor={false}
    initialSnapEnabled={false}
    onOpenEffectClip={onOpenEffectClip}
  />
)

const vfxLane = (): HTMLElement => {
  const lane = within(screen.getByText('VFX（エフェクト）').parentElement as HTMLElement).getByText('段 1').parentElement
  if (lane === null) throw new Error('VFX の帯が無い')
  return lane
}

beforeEach(() => {
  fake.createClip.mockReset()
  fake.createClip.mockResolvedValue(
    TimelineClip.parse({
      id: NEW_ID, projectId, track: 'VFX', startSec: 5, durationSec: 0.4, layer: 0,
      content: { type: 'motion_graphics', templateKey: 'flash', params: defaultEffectParams('flash') },
      opacity: 1, createdAt: new Date(),
    }),
  )
})

describe('エフェクトを置く', () => {
  it('空の VFX の帯を押すと型を選ぶ小窓が出て、選ぶと既定の値で置き、インスペクターで開く', async () => {
    const onOpen = vi.fn()
    render(editor(onOpen))
    fireEvent.pointerDown(vfxLane(), { clientX: 5 * DEFAULT_PX_PER_SEC, pointerId: 1 })

    const dialog = screen.getByRole('dialog', { name: 'エフェクトを選んで置く' })
    expect(within(dialog).getByText('0:05.00 から')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: /フラッシュ/ }))

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith(NEW_ID)
    })
    expect(fake.createClip).toHaveBeenCalledWith(projectId, {
      track: 'VFX',
      startSec: 5,
      durationSec: 0.4,
      layer: 0,
      content: { type: 'motion_graphics', templateKey: 'flash', params: defaultEffectParams('flash') },
    })
  })

  it('「＋ エフェクト」は再生位置に置く小窓を開き、Esc で閉じる', async () => {
    render(editor(vi.fn()))
    await userEvent.click(screen.getByRole('button', { name: '＋ エフェクト' }))
    const dialog = screen.getByRole('dialog', { name: 'エフェクトを選んで置く' })
    expect(within(dialog).getByText('0:00.00 から')).toBeTruthy()
    for (const label of ['フラッシュ', '光漏れ', 'スピード線', 'フィルム焼け', 'グリッチ', 'タイトルカード', '揺れ', '寄りのパンチ']) {
      expect(within(dialog).getByRole('button', { name: new RegExp(label) })).toBeTruthy()
    }
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
