import { ProjectId, TimelineClip, TimelineClipId, type Shot } from '@ixa/domain'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { DEFAULT_PX_PER_SEC } from '@/lib/timeline-display'
import { PROJECT_ID } from './fixtures'

/**
 * 同じ Layer で時間が重なるクリップは、帯を縦に広げて別の行に出す（制作者 2026-10-19「重なると文字が読めず、
 * 動かしたり尺を変えたりすると別のクリップが動いてしまう」）。掴んだ行のクリップだけが動く。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const fake = vi.hoisted(() => ({
  timeline: { updateClipSpans: vi.fn() },
  roughCut: { applyRoughCut: vi.fn(), planRoughCut: vi.fn() },
}))
vi.mock('@/lib/timeline-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/timeline-api')>()
  return { ...original, createTimelineApi: () => fake.timeline }
})
vi.mock('@/lib/rough-cut-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/rough-cut-api')>()
  return { ...original, createRoughCutApi: () => fake.roughCut }
})

const projectId = ProjectId.parse(PROJECT_ID)
const clipId = (n: number): TimelineClipId => TimelineClipId.parse(`01ARZ3NDEKTSV4RRFFQ69G5FC${String(n)}`)

const textClip = (n: number, startSec: number, durationSec: number): TimelineClip =>
  TimelineClip.parse({
    id: clipId(n),
    projectId,
    track: 'TEXT',
    startSec,
    durationSec,
    layer: 0,
    content: { type: 'text', templateKey: 'plain', params: { text: `行${String(n)}` } },
    opacity: 1,
    createdAt: new Date(),
  })

const editor = (input: { readonly clips?: readonly TimelineClip[]; readonly shots?: readonly Shot[] }): ReactElement => (
  <TimelineEditor
    projectId={projectId}
    shots={input.shots ?? []}
    initialTransitions={[]}
    initialClips={input.clips ?? []}
    renderedShotIds={[]}
    documentDurationSec={30}
    initialDocument={null}
    beatSource={{ state: 'no_track' }}
    beatAlignment={null}
    loadErrors={[]}
    showMonitor={false}
    initialSnapEnabled
  />
)

const x = (sec: number): number => sec * DEFAULT_PX_PER_SEC

/** 帯の上で、その秒から別の秒まで引く（帯の左端・上端は画面の 0。上の 12px は Layer の札、行は 24px おき）。 */
const dragOn = (target: Element, fromSec: number, toSec: number, clientY: number): void => {
  fireEvent.pointerDown(target, { clientX: x(fromSec), clientY, pointerId: 1, button: 0 })
  fireEvent.pointerMove(target, { clientX: x(toSec), clientY, pointerId: 1 })
  fireEvent.pointerUp(target, { clientX: x(toSec), clientY, pointerId: 1 })
}

/** TEXT の帯（VFX の帯も空で出るので、行の名前で探す。ADR-0050）。 */
const textLane = (): Element => {
  const lane = within(screen.getByText('TEXT（テロップ）').parentElement as HTMLElement).getByText('Layer1').parentElement
  if (lane === null) throw new Error('TEXT の帯が無い')
  return lane
}

beforeEach(() => {
  fake.timeline.updateClipSpans.mockReset()
})

const ROW_1_Y = 20
const ROW_2_Y = 12 + 24 + 10

describe('重なるテロップ', () => {
  // 行1 0–4 と 行2 2–6 が重なる。行3 8–9 は離れている（1 行目に入る）。
  const clips = [textClip(1, 0, 4), textClip(2, 2, 4), textClip(3, 8, 1)]
  const byId = new Map(clips.map((clip) => [clip.id, clip]))
  type Span = { readonly id: TimelineClipId; readonly startSec: number; readonly durationSec: number }
  const echo = (_projectId: ProjectId, spans: readonly Span[]): Promise<TimelineClip[]> =>
    Promise.resolve(spans.map(({ id, ...span }) => ({ ...(byId.get(id) as TimelineClip), ...span })))
  const sentSpans = (): readonly Span[] => (fake.timeline.updateClipSpans.mock.calls[0] as [ProjectId, Span[]])[1]

  it('帯を 2 行の高さに広げ、重なるクリップを 2 行目に出す', () => {
    render(editor({ clips }))
    expect((textLane() as HTMLElement).style.height).toBe('60px')
    const top = (name: RegExp): string => screen.getByRole('button', { name }).style.top
    expect(top(/行1/)).toBe('12px')
    expect(top(/行2/)).toBe('36px')
    expect(top(/行3/)).toBe('12px')
  })

  it('2 行目を掴んで動かすと、2 行目のクリップだけが動く', async () => {
    fake.timeline.updateClipSpans.mockImplementation(echo)
    render(editor({ clips }))

    dragOn(textLane(), 3, 5, ROW_2_Y)

    await waitFor(() => {
      expect(fake.timeline.updateClipSpans).toHaveBeenCalledTimes(1)
    })
    expect(sentSpans()).toEqual([{ id: clipId(2), startSec: 4, durationSec: 4 }])
  })

  it('同じ秒でも 1 行目を掴めば、1 行目のクリップが動く', async () => {
    fake.timeline.updateClipSpans.mockImplementation(echo)
    render(editor({ clips }))

    dragOn(textLane(), 3, 3.5, ROW_1_Y)

    await waitFor(() => {
      expect(fake.timeline.updateClipSpans).toHaveBeenCalledTimes(1)
    })
    expect(sentSpans()).toEqual([{ id: clipId(1), startSec: 0.5, durationSec: 4 }])
  })
})
