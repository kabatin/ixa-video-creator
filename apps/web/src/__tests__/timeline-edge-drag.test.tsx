import { ProjectId, Shot, ShotId, TimelineClip, TimelineClipId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { DEFAULT_PX_PER_SEC } from '@/lib/timeline-display'
import { PROJECT_ID, shotJson } from './fixtures'

/**
 * 端をつまんで長さを変えると、接している隣の端が付いてくる（制作者 2026-10-02「CUT4 の右側をつまんで右に移動したら
 * CUT5 の先頭が後ろに追従して下がる感じ、逆もしかり、左側も同様」「テロップも同じですね」）。
 * Option（Alt）なら隣は動かさない。カットは粗編集の適用で当て、変更の履歴に見出しを残す。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const fake = vi.hoisted(() => ({
  timeline: { updateClip: vi.fn() },
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
const shotId = (n: number): ShotId => ShotId.parse(`01ARZ3NDEKTSV4RRFFQ69G5FD${String(n)}`)

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

const shot = (n: number, startSec: number, durationSec: number, extra: Partial<Shot> = {}): Shot =>
  Shot.parse({
    ...shotJson,
    createdAt: new Date(shotJson.createdAt),
    updatedAt: new Date(shotJson.updatedAt),
    ...extra,
    id: shotId(n),
    code: `CUT-0${String(n)}`,
    startSec,
    durationSec,
  })

const editor = (input: { readonly clips?: readonly TimelineClip[]; readonly shots?: readonly Shot[] }): ReactElement => (
  <TimelineEditor
    projectId={projectId}
    shots={input.shots ?? []}
    initialTransitions={[]}
    initialClips={input.clips ?? []}
    renderedShotIds={[]}
    initialIssues={[]}
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

/** 帯の上で、その秒から別の秒まで引く（帯の左端は画面の 0）。 */
const dragOn = (target: Element, fromSec: number, toSec: number, altKey = false): void => {
  fireEvent.pointerDown(target, { clientX: x(fromSec), pointerId: 1, button: 0 })
  fireEvent.pointerMove(target, { clientX: x(toSec), pointerId: 1, altKey })
  fireEvent.pointerUp(target, { clientX: x(toSec), pointerId: 1, altKey })
}

const textLane = (): Element => {
  const lane = screen.getByText('layer 0').parentElement
  if (lane === null) throw new Error('TEXT の帯が無い')
  return lane
}

beforeEach(() => {
  fake.timeline.updateClip.mockReset()
  fake.roughCut.applyRoughCut.mockReset()
})

describe('テロップの端をつまむ', () => {
  // 行1 0–2 / 行2 2–4 が接している。行3 10–12 は離れている。
  const clips = [textClip(1, 0, 2), textClip(2, 2, 2), textClip(3, 10, 2)]
  const byId = new Map(clips.map((clip) => [clip.id, clip]))
  const echo = (id: TimelineClipId, patch: { startSec: number; durationSec: number }): Promise<TimelineClip> =>
    Promise.resolve({ ...(byId.get(id) as TimelineClip), ...patch })

  it('右端を右へ引くと、隣の頭が付いてきて 2 件書く。縮む隣を先に書く', async () => {
    fake.timeline.updateClip.mockImplementation(echo)
    render(editor({ clips }))

    dragOn(textLane(), 2, 3)

    await waitFor(() => {
      expect(fake.timeline.updateClip).toHaveBeenCalledTimes(2)
    })
    expect(fake.timeline.updateClip.mock.calls).toEqual([
      [clipId(2), { startSec: 3, durationSec: 1 }],
      [clipId(1), { startSec: 0, durationSec: 3 }],
    ])
  })

  it('Option を押していれば、隣は動かさずそのテロップだけを縮める', async () => {
    fake.timeline.updateClip.mockImplementation(echo)
    render(editor({ clips }))

    dragOn(textLane(), 2, 1.5, true)

    await waitFor(() => {
      expect(fake.timeline.updateClip).toHaveBeenCalledTimes(1)
    })
    expect(fake.timeline.updateClip).toHaveBeenCalledWith(clipId(1), { startSec: 0, durationSec: 1.5 })
  })

  /** 隣の頭（= 元の境目）が吸着の候補に残ると、少し引いただけでは元の位置へ吸い戻されて動かない。 */
  it('元の境目へ吸い戻さない（付いてくる隣の端は吸着の候補から外す）', async () => {
    fake.timeline.updateClip.mockImplementation(echo)
    render(editor({ clips }))

    dragOn(textLane(), 2, 2.15)

    await waitFor(() => {
      expect(fake.timeline.updateClip).toHaveBeenCalledTimes(2)
    })
    const [, [, grown]] = fake.timeline.updateClip.mock.calls as [unknown, [unknown, { durationSec: number }]]
    expect(grown.durationSec).toBeCloseTo(2.15)
  })
})

describe('カットの端をつまむ', () => {
  // CUT-01 0–4 / CUT-02 4–6 / CUT-03 6–9 が接している。
  const shots = [shot(1, 0, 4), shot(2, 4, 2), shot(3, 6, 3)]

  it('右端を右へ引くと、次のカットの頭が付いてくる。粗編集の適用へ見出し付きで送る', async () => {
    fake.roughCut.applyRoughCut.mockResolvedValue({ applied: [], skipped: [] })
    render(editor({ shots }))

    dragOn(screen.getByTitle(/^CUT-02 の右端/), 6, 7)

    await waitFor(() => {
      expect(fake.roughCut.applyRoughCut).toHaveBeenCalledTimes(1)
    })
    expect(fake.roughCut.applyRoughCut).toHaveBeenCalledWith(
      projectId,
      [
        expect.objectContaining({ kind: 'trim', shotId: shotId(2), toDurationSec: 3 }),
        expect.objectContaining({ kind: 'move', shotId: shotId(3), toSec: 7 }),
        expect.objectContaining({ kind: 'trim', shotId: shotId(3), toDurationSec: 2 }),
      ],
      'CUT-02 と CUT-03 の境目を動かしました',
    )
    expect(await screen.findByText(/CUT-02 と CUT-03 の境目を動かしました。変更の履歴から戻せます/)).toBeTruthy()
  })

  it('付いてくる隣がロック中なら、掴んだ時点で理由を出し、何も送らない', () => {
    const locked = [shot(1, 0, 4), shot(2, 4, 2), shot(3, 6, 3, { lockedAt: new Date('2026-10-01T00:00:00Z') })]
    render(editor({ shots: locked }))

    const handle = screen.getByTitle(/^CUT-02 の右端/)
    fireEvent.pointerDown(handle, { clientX: x(6), pointerId: 1, button: 0 })
    fireEvent.pointerMove(handle, { clientX: x(7), pointerId: 1 })

    // 離す前に理由が出ていて、引いた先を仮に描いてもいない（引いた手間を無駄にさせない）。
    expect(screen.getByText(/CUT-03.*ロック/)).toBeTruthy()
    expect(screen.queryByText(/CUT-02 3\.00s/)).toBeNull()
    fireEvent.pointerUp(handle, { clientX: x(7), pointerId: 1 })
    expect(fake.roughCut.applyRoughCut).not.toHaveBeenCalled()
  })

  it('隣のカットは 0.5 秒より短くならない', async () => {
    fake.roughCut.applyRoughCut.mockResolvedValue({ applied: [], skipped: [] })
    render(editor({ shots }))

    dragOn(screen.getByTitle(/^CUT-02 の右端/), 6, 8.9)

    await waitFor(() => {
      expect(fake.roughCut.applyRoughCut).toHaveBeenCalledTimes(1)
    })
    expect(fake.roughCut.applyRoughCut.mock.calls[0]?.[1]).toContainEqual(
      expect.objectContaining({ kind: 'trim', shotId: shotId(3), toDurationSec: 0.5 }),
    )
  })
})
