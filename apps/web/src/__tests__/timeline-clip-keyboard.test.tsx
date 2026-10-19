import { ProjectId, TimelineClip, TimelineClipId } from '@ixa/domain'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { PROJECT_ID } from './fixtures'

/**
 * 帯のクリップをキーボードから開く（レビュー 2026-10-19）。
 * 数値で直す一覧を外したので、帯のクリップがフォーカスできないとキーボードだけでは選べなくなる。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const projectId = ProjectId.parse(PROJECT_ID)
const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')

const textClip = TimelineClip.parse({
  id: CLIP_ID,
  projectId,
  track: 'TEXT',
  startSec: 1,
  durationSec: 2,
  layer: 0,
  content: { type: 'text', templateKey: 'plain', params: { text: 'こんにちは' } },
  opacity: 1,
  createdAt: new Date(),
})

const renderEditor = (onOpenTextClip = vi.fn()) => {
  render(
    <TimelineEditor
      projectId={projectId}
      shots={[]}
      initialTransitions={[]}
      initialClips={[textClip]}
      renderedShotIds={[]}
      documentDurationSec={30}
      initialDocument={null}
      beatSource={{ state: 'no_track' }}
      beatAlignment={null}
      loadErrors={[]}
      showMonitor={false}
      onOpenTextClip={onOpenTextClip}
    />,
  )
  return onOpenTextClip
}

describe('帯のクリップのキーボード操作', () => {
  it('クリップはフォーカスでき、名前で読める', () => {
    renderEditor()
    const clip = screen.getByRole('button', { name: /こんにちは/ })
    expect(clip.tabIndex).toBe(0)
  })

  it.each(['Enter', ' '])('「%s」で開く', (key) => {
    const onOpen = renderEditor()
    const clip = screen.getByRole('button', { name: /こんにちは/ })
    clip.focus()
    fireEvent.keyDown(clip, { key })
    expect(onOpen).toHaveBeenCalledWith(CLIP_ID)
  })
})
