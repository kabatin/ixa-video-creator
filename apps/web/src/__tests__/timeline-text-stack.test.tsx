import { ProjectId, TimelineClip, TimelineClipId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { DEFAULT_PX_PER_SEC } from '@/lib/timeline-display'
import { PROJECT_ID } from './fixtures'

/**
 * 制作者 2026-10-19「テロップを重ねて複数置けない」「テロップに改行が入れられない」。
 * 同じ時刻に 2 つ目のテロップを置くときは、空いた上の段を押す。文字の欄は Enter で改行する。
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

const textClip = (id: TimelineClipId, text: string, startSec: number, layer: number) =>
  TimelineClip.parse({
    id,
    projectId,
    track: 'TEXT',
    startSec,
    durationSec: 4,
    layer,
    content: { type: 'text', templateKey: 'plain', params: { text } },
    opacity: 1,
    createdAt: new Date(),
  })

const textLaneOf = (layer: number): HTMLElement => {
  const row = screen.getByText('TEXT（テロップ）').parentElement as HTMLElement
  const lane = within(row).getByText(`layer ${String(layer)}`).parentElement
  if (lane === null) throw new Error(`TEXT の layer ${String(layer)} の段が無い`)
  return lane
}

const pressAt = (lane: HTMLElement, sec: number): void => {
  const at = { clientX: sec * DEFAULT_PX_PER_SEC, pointerId: 1 }
  fireEvent.pointerDown(lane, at)
  fireEvent.pointerUp(lane, at)
}

const editor = (clips: readonly TimelineClip[]) => (
  <TimelineEditor
    projectId={projectId}
    shots={[]}
    initialTransitions={[]}
    initialClips={clips}
    renderedShotIds={[]}
    initialIssues={[]}
    documentDurationSec={30}
    initialDocument={null}
    beatSource={{ state: 'no_track' }}
    beatAlignment={null}
    loadErrors={[]}
    showMonitor={false}
    initialSnapEnabled={false}
  />
)

beforeEach(() => {
  fake.createClip.mockReset()
})

describe('テロップを重ねて置く', () => {
  it('置いたテロップの上に空いた段があり、そこを押すと同じ時刻に上の段で置ける', async () => {
    fake.createClip.mockResolvedValue(textClip(NEW_ID, '二つ目', 2, 1))
    render(editor([textClip(CLIP_ID, '一つ目', 1, 0)]))

    pressAt(textLaneOf(1), 2)
    await userEvent.type(screen.getByLabelText('文字'), '二つ目')
    await userEvent.click(screen.getByRole('button', { name: /置く|追加/ }))

    await waitFor(() => {
      expect(fake.createClip).toHaveBeenCalled()
    })
    const [, input] = fake.createClip.mock.calls[0] as [unknown, { layer: number; startSec: number }]
    expect(input.layer).toBe(1)
    expect(input.startSec).toBeCloseTo(2)
  })
})

describe('テロップの改行', () => {
  it('文字の欄で Enter を押すと改行になり、2 行のまま置ける', async () => {
    fake.createClip.mockResolvedValue(textClip(NEW_ID, '一行目\n二行目', 10, 0))
    render(editor([]))

    pressAt(textLaneOf(0), 10)
    await userEvent.type(screen.getByLabelText('文字'), '一行目{Enter}二行目')
    expect(screen.getByRole('dialog')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /置く|追加/ }))

    await waitFor(() => {
      expect(fake.createClip).toHaveBeenCalled()
    })
    const [, input] = fake.createClip.mock.calls[0] as [unknown, { content: { params: { text: string } } }]
    expect(input.content.params.text).toBe('一行目\n二行目')
  })
})
