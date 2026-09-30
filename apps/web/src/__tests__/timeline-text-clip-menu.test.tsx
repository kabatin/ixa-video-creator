import { ProjectId, TimelineClip, TimelineClipId } from '@ixa/domain'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { LONG_PRESS_MS } from '@/components/workbench/use-context-menu'
import { DEFAULT_PX_PER_SEC } from '@/lib/timeline-display'
import { PROJECT_ID } from './fixtures'

/**
 * 帯のテロップを右クリック（長押し）すると、そのテロップのメニュー（2026-09-30）。
 * **右クリックを「押した」と取り違えない**（インスペクターを開かない・空きに挿入の小窓を出さない）。
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/timeline-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/timeline-api')>()
  return { ...original, createTimelineApi: () => ({ createClip: vi.fn() }) }
})

const projectId = ProjectId.parse(PROJECT_ID)
const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')

const clip = TimelineClip.parse({
  id: CLIP_ID,
  projectId,
  track: 'TEXT',
  startSec: 1,
  durationSec: 2,
  layer: 0,
  content: { type: 'text', templateKey: 'plain', params: { text: '一行目' } },
  opacity: 1,
  createdAt: new Date(),
})

const setup = () => {
  const onOpenTextClip = vi.fn()
  const onTextClipContextMenu = vi.fn()
  render(
    <TimelineEditor
      projectId={projectId}
      shots={[]}
      initialTransitions={[]}
      initialClips={[clip]}
      renderedShotIds={[]}
      initialIssues={[]}
      documentDurationSec={30}
      initialDocument={null}
      beatSource={{ state: 'no_track' }}
      beatAlignment={null}
      loadErrors={[]}
      showMonitor={false}
      onOpenTextClip={onOpenTextClip}
      onTextClipContextMenu={onTextClipContextMenu}
    />,
  )
  const lane = screen.getByText('layer 0').parentElement
  if (lane === null) throw new Error('TEXT の帯が無い')
  return { lane, onOpenTextClip, onTextClipContextMenu }
}

const ON_CLIP = { clientX: 2 * DEFAULT_PX_PER_SEC, clientY: 10, pointerId: 1 }
const EMPTY = { clientX: 20 * DEFAULT_PX_PER_SEC, clientY: 10, pointerId: 1 }

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('帯のテロップの右クリック', () => {
  it('テロップの上で右クリックすると、そのテロップのメニューの口を呼ぶ', () => {
    const { lane, onTextClipContextMenu } = setup()

    fireEvent.contextMenu(lane, ON_CLIP)

    expect(onTextClipContextMenu).toHaveBeenCalledWith(CLIP_ID, { x: ON_CLIP.clientX, y: 10 }, lane)
  })

  it('右ボタンの押し離しを「押した」として扱わない（インスペクターを開かない・挿入の小窓を出さない）', () => {
    const { lane, onOpenTextClip } = setup()

    fireEvent.pointerDown(lane, { ...ON_CLIP, button: 2 })
    fireEvent.pointerUp(lane, { ...ON_CLIP, button: 2 })
    fireEvent.pointerDown(lane, { ...EMPTY, button: 2 })
    fireEvent.pointerUp(lane, { ...EMPTY, button: 2 })

    expect(onOpenTextClip).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText(/文字/)).toBeNull()
  })

  it('指で長押しするとメニューを開き、離しても「押した」にしない', () => {
    const { lane, onOpenTextClip, onTextClipContextMenu } = setup()

    fireEvent.pointerDown(lane, { ...ON_CLIP, pointerType: 'touch' })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS)
    })
    fireEvent.pointerUp(lane, { ...ON_CLIP, pointerType: 'touch' })

    expect(onTextClipContextMenu).toHaveBeenCalledTimes(1)
    expect(onOpenTextClip).not.toHaveBeenCalled()
  })

  it('指を動かせば（引きずり）メニューは開かない', () => {
    const { lane, onTextClipContextMenu } = setup()

    fireEvent.pointerDown(lane, { ...ON_CLIP, pointerType: 'touch' })
    fireEvent.pointerMove(lane, { ...ON_CLIP, clientX: ON_CLIP.clientX + 40, pointerType: 'touch' })
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    })

    expect(onTextClipContextMenu).not.toHaveBeenCalled()
  })

  it('指でさっと押せば、これまでどおりインスペクターで開く', () => {
    const { lane, onOpenTextClip, onTextClipContextMenu } = setup()

    fireEvent.pointerDown(lane, { ...ON_CLIP, pointerType: 'touch' })
    fireEvent.pointerUp(lane, { ...ON_CLIP, pointerType: 'touch' })

    expect(onOpenTextClip).toHaveBeenCalledWith(CLIP_ID)
    expect(onTextClipContextMenu).not.toHaveBeenCalled()
  })
})
