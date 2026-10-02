import { ProjectId, TimelineClip, TimelineClipId } from '@ixa/domain'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimelineEditor } from '@/components/timeline-editor'
import { DEFAULT_PX_PER_SEC } from '@/lib/timeline-display'
import type { BeatSource } from '@/lib/timeline-snap'
import { PROJECT_ID } from './fixtures'

/**
 * **帯のテロップを押すと、小窓ではなくインスペクターで開く**（2026-09-28、制作者の指摘
 * 「ポップアップは見切れて編集しづらいから、インスペクターが連動してくれればいい」）。
 * 開く口（`onOpenTextClip`）を渡さない単独のタイムラインは、今までどおり小窓で直す。
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

const textClip = (id: TimelineClipId, text: string, startSec: number) =>
  TimelineClip.parse({
    id,
    projectId,
    track: 'TEXT',
    startSec,
    durationSec: 2,
    layer: 0,
    content: { type: 'text', templateKey: 'plain', params: { text } },
    opacity: 1,
    createdAt: new Date(),
  })

const editor = (
  clips: readonly TimelineClip[],
  onOpenTextClip?: (id: TimelineClipId) => void,
  snap: { readonly beatSource?: BeatSource; readonly enabled?: boolean } = {},
): ReactElement => (
  <TimelineEditor
    projectId={projectId}
    shots={[]}
    initialTransitions={[]}
    initialClips={clips}
    renderedShotIds={[]}
    initialIssues={[]}
    documentDurationSec={30}
    initialDocument={null}
    beatSource={snap.beatSource ?? { state: 'no_track' }}
    beatAlignment={null}
    loadErrors={[]}
    showMonitor={false}
    initialSnapEnabled={snap.enabled ?? true}
    {...(onOpenTextClip === undefined ? {} : { onOpenTextClip })}
  />
)

/** 帯のその秒を押して離す（動かさない）。 */
const pressLaneAt = (sec: number): void => {
  const lane = screen.getByText('layer 0').parentElement
  if (lane === null) throw new Error('TEXT の帯が無い')
  const at = { clientX: sec * DEFAULT_PX_PER_SEC, pointerId: 1 }
  fireEvent.pointerDown(lane, at)
  fireEvent.pointerUp(lane, at)
}

beforeEach(() => {
  fake.createClip.mockReset()
})

describe('帯のテロップを押したとき', () => {
  it('開く口があれば、小窓を出さずにインスペクターで開く', () => {
    const onOpen = vi.fn()
    render(editor([textClip(CLIP_ID, '一行目', 1)], onOpen))

    pressLaneAt(2)

    expect(onOpen).toHaveBeenCalledWith(CLIP_ID)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('文字')).toBeNull()
  })

  it('開く口が無ければ、今までどおり小窓で直す', () => {
    render(editor([textClip(CLIP_ID, '一行目', 1)]))

    pressLaneAt(2)

    expect(screen.getByLabelText('文字')).toBeTruthy()
  })

  it('新しく置いたテロップは、置いた直後にインスペクターで開く', async () => {
    const onOpen = vi.fn()
    fake.createClip.mockResolvedValue(textClip(NEW_ID, '新しい行', 10))
    render(editor([textClip(CLIP_ID, '一行目', 1)], onOpen))

    pressLaneAt(10)
    await userEvent.type(screen.getByLabelText('文字'), '新しい行')
    await userEvent.click(screen.getByRole('button', { name: /置く|追加/ }))

    await waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith(NEW_ID)
    })
  })

  /** インスペクターで直した結果は、読み直した一覧で帯にも出る（手元の古い一覧に留まらない）。 */
  it('読み直した一覧が届いたら、帯の表示も差し替える', () => {
    const view = render(editor([textClip(CLIP_ID, '一行目', 1)], vi.fn()))

    view.rerender(editor([textClip(CLIP_ID, '直した行', 1)], vi.fn()))

    expect(screen.getByTitle(/直した行/)).toBeTruthy()
  })
})

/**
 * 小窓は画面全体に出すので、**開く位置は画面の座標で渡す**。帯の左端からの位置のまま渡すと、
 * 帯が画面の左端に無いぶん（ラベルの列・パネルの位置）ずれて出る。
 */
describe('小窓を開く位置', () => {
  it('押した帯の場所を、画面の座標で渡す', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      right: 1100,
      bottom: 90,
      width: 1000,
      height: 40,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })
    render(editor([]))

    const lane = screen.getByText('layer 0').parentElement
    if (lane === null) throw new Error('TEXT の帯が無い')
    const at = { clientX: 100 + 10 * DEFAULT_PX_PER_SEC, pointerId: 1 }
    fireEvent.pointerDown(lane, at)
    fireEvent.pointerUp(lane, at)

    const dialog = screen.getByRole('dialog')
    expect(dialog.style.left).toBe(`${String(100 + 10 * DEFAULT_PX_PER_SEC)}px`)
    expect(dialog.style.top).toBe('90px')
    vi.restoreAllMocks()
  })
})

/**
 * 空きを押すと、押した瞬間（pointerdown）に小窓を開く。**そのままだとブラウザの既定の動きで
 * 焦点がパネルへ移り、小窓の欄から焦点が抜ける**（Esc で閉じられず、打った文字も届かない）。
 * 小窓はパネルの外に出すので、パネルに焦点が移ると戻ってこない（2026-09-28、実機で確認）。
 */
it('空きを押して開くときは、焦点をパネルへ移す既定の動きを止める', () => {
  render(editor([]))
  const lane = screen.getByText('layer 0').parentElement
  if (lane === null) throw new Error('TEXT の帯が無い')

  const notPrevented = fireEvent.pointerDown(lane, { clientX: 10 * DEFAULT_PX_PER_SEC, pointerId: 1 })

  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(notPrevented).toBe(false)
})

/** 制作者 2026-10-01「テロップ吸着繋ぎ」。押した所の近くの拍へ寄せて置く（引きずりと同じ規則）。 */
describe('新しく置くテロップの拍への吸着', () => {
  const beats: BeatSource = {
    state: 'available',
    trackTitle: 'iXA CUP',
    beats: Array.from({ length: 61 }, (_unused, i) => i * 0.5),
    sections: [],
    drops: [],
  }

  const placeAt = async (sec: number): Promise<void> => {
    fake.createClip.mockResolvedValue(textClip(NEW_ID, '歌詞', sec))
    pressLaneAt(sec)
    await userEvent.type(screen.getByLabelText('文字'), '歌詞')
    await userEvent.click(screen.getByRole('button', { name: /置く|追加/ }))
  }

  it('押した所の近くの拍へ寄せて置く', async () => {
    render(editor([], vi.fn(), { beatSource: beats }))

    await placeAt(10.1)

    await waitFor(() => {
      expect(fake.createClip).toHaveBeenCalled()
    })
    expect((fake.createClip.mock.calls[0]?.[1] as { startSec: number }).startSec).toBeCloseTo(10, 6)
  })

  it('吸着を切っていれば押した所に置く', async () => {
    render(editor([], vi.fn(), { beatSource: beats, enabled: false }))

    await placeAt(10.1)

    await waitFor(() => {
      expect(fake.createClip).toHaveBeenCalled()
    })
    expect((fake.createClip.mock.calls[0]?.[1] as { startSec: number }).startSec).toBeCloseTo(10.1, 6)
  })
})

