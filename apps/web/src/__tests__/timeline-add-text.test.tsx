import { ProjectId, TimelineClip, TimelineClipId } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { PlayheadSecContext } from '@/lib/playhead-sec'
import { PROJECT_ID } from './fixtures'

/**
 * 制作者 2026-10-19「＋テロップが欲しい」。再生位置に 2 秒のテロップを置き、
 * すぐインスペクターの文字の欄で打てるように開く。埋まっていれば空いた段に重ねる。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const fake = vi.hoisted(() => ({ createClip: vi.fn() }))
vi.mock('@/lib/timeline-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/timeline-api')>()
  return { ...original, createTimelineApi: () => fake }
})

const projectId = ProjectId.parse(PROJECT_ID)
const CLIP_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB0')
const NEW_ID = TimelineClipId.parse('01ARZ3NDEKTSV4RRFFQ69G5FB1')

const textClip = (id: TimelineClipId, startSec: number, layer: number) =>
  TimelineClip.parse({
    id,
    projectId,
    track: 'TEXT',
    startSec,
    durationSec: 4,
    layer,
    content: { type: 'text', templateKey: 'plain', params: { text: 'あ' } },
    opacity: 1,
    createdAt: new Date(),
  })

const renderAt = (playheadSec: number, clips: readonly TimelineClip[], onOpenTextClip = vi.fn()) => {
  render(
    <PlayheadSecContext.Provider value={playheadSec}>
      <TimelineEditor
        projectId={projectId}
        shots={[]}
        initialTransitions={[]}
        initialClips={clips}
        renderedShotIds={[]}
        documentDurationSec={30}
        initialDocument={null}
        beatSource={{ state: 'no_track' }}
        beatAlignment={null}
        loadErrors={[]}
        showMonitor={false}
        initialSnapEnabled={false}
        onOpenTextClip={onOpenTextClip}
        playback={{ playing: false, seek: null, onSeek: vi.fn(), onFrame: vi.fn(), onPlayingChange: vi.fn() }}
      />
    </PlayheadSecContext.Provider>,
  )
  return onOpenTextClip
}

beforeEach(() => {
  fake.createClip.mockReset()
})

describe('＋テロップ', () => {
  it('再生位置から 2 秒の仮のテロップを置き、文字の欄にフォーカスして開く', async () => {
    fake.createClip.mockResolvedValue(textClip(NEW_ID, 5, 0))
    const onOpen = renderAt(5, [])

    await userEvent.click(screen.getByRole('button', { name: '＋ テロップ' }))

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith(NEW_ID, { focusText: true })
    })
    const [, input] = fake.createClip.mock.calls[0] as [
      unknown,
      { track: string; startSec: number; durationSec: number; layer: number; content: { params: { text: string } } },
    ]
    expect(input).toMatchObject({ track: 'TEXT', startSec: 5, durationSec: 2, layer: 0 })
    expect(input.content.params.text).toBe('テロップ')
  })

  it('その時間に既にテロップがあれば、空いた上の段に重ねる', async () => {
    fake.createClip.mockResolvedValue(textClip(NEW_ID, 5, 1))
    renderAt(5, [textClip(CLIP_ID, 4, 0)])

    await userEvent.click(screen.getByRole('button', { name: '＋ テロップ' }))

    await waitFor(() => {
      expect(fake.createClip).toHaveBeenCalled()
    })
    const [, input] = fake.createClip.mock.calls[0] as [unknown, { layer: number }]
    expect(input.layer).toBe(1)
  })
})
