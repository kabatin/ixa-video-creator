import { Shot, TimelineClip, Transition } from '@ixa/domain'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TimelineClipList } from '@/components/timeline-clip-list'
import { TimelineTransitionEditor } from '@/components/timeline-transition-editor'
import type { SnapSpanInput, SnapSpanOutcome } from '@/lib/timeline-snap'

/**
 * 削除に確認を挟むかは「この画面から作り直せるか」で決めている。
 * **その判断をここで固定する。**
 *
 * `timeline-clip-form.tsx` が作れるのは TEXT のクリップだけで、メディアと
 * モーショングラフィックスは素材の選択が要るため作る導線が無い。
 * 「クリップは作り直せる」という前提は TEXT にしか当てはまらない。
 */

const ulid = (suffix: string): string => {
  // ULID の文字集合は 0-9 と A-Z から I L O U を除いたもの。
  if (!/^[0-9A-HJKMNP-TV-Z]{1,21}$/.test(suffix)) throw new Error(`ULID に使えない: ${suffix}`)
  return `01HZY${'0'.repeat(21 - suffix.length)}${suffix}`
}

const PROJECT_ID = ulid('PRJAA')

const clip = (id: string, content: unknown, track: string): TimelineClip =>
  TimelineClip.parse({
    id: ulid(id),
    projectId: PROJECT_ID,
    track,
    startSec: 1,
    durationSec: 2,
    layer: 0,
    content,
    opacity: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })

const textClip = clip('CPAAA', { type: 'text', templateKey: 'lower-third', params: {} }, 'TEXT')

const mediaClip = clip(
  'CPBBB',
  { type: 'media', mediaAssetId: ulid('ASSETA'), inSec: 0, outSec: 2, volume: 1 },
  'VIDEO2',
)

const motionClip = clip(
  'CPCCC',
  { type: 'motion_graphics', templateKey: 'sweep', params: {} },
  'VFX',
)

/** 吸着はここでの関心ではない。入れた値をそのまま返す。 */
const passThroughSnap = (_id: unknown, span: SnapSpanInput): SnapSpanOutcome => ({
  startSec: span.startSec,
  durationSec: span.durationSec,
  notices: [],
})

const renderClips = (clips: readonly TimelineClip[]) => {
  const onRemove = vi.fn()
  render(
    <TimelineClipList
      clips={clips}
      busy={false}
      selectedClipId={null}
      onSelect={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={onRemove}
      onSnapSpan={passThroughSnap}
    />,
  )
  return { onRemove, user: userEvent.setup() }
}

describe('クリップの削除', () => {
  it('TEXT は作り直せるので、確認を挟まずに消す', async () => {
    const { onRemove, user } = renderClips([textClip])

    await user.click(screen.getByRole('button', { name: '削除（クリップ）' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(textClip.id)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('メディアはこの画面から作り直せないので、1 回押しただけでは消さない', async () => {
    const { onRemove, user } = renderClips([mediaClip])

    await user.click(screen.getByRole('button', { name: '削除（クリップ）' }))

    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('モーショングラフィックスも確認が要る', async () => {
    const { onRemove, user } = renderClips([motionClip])

    await user.click(screen.getByRole('button', { name: '削除（クリップ）' }))

    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('確認文に、どのクリップかと置き直せないことを出す', async () => {
    const { user } = renderClips([mediaClip])

    await user.click(screen.getByRole('button', { name: '削除（クリップ）' }))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('VIDEO2 のクリップ')
    expect(dialog).toHaveTextContent('元に戻せません')
    expect(dialog).toHaveTextContent('この種類のクリップは、この画面から置き直せません')
  })

  it('2 回目を押して初めて消す', async () => {
    const { onRemove, user } = renderClips([mediaClip])

    await user.click(screen.getByRole('button', { name: '削除（クリップ）' }))
    await user.click(screen.getByRole('alertdialog').querySelector('button') as HTMLElement)

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(mediaClip.id)
  })

  it('やめると消さない', async () => {
    const { onRemove, user } = renderClips([mediaClip])

    await user.click(screen.getByRole('button', { name: '削除（クリップ）' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

const AT = new Date('2026-01-01T00:00:00Z')

const shot = (id: string, code: string, startSec: number): Shot =>
  Shot.parse({
    id: ulid(id),
    projectId: PROJECT_ID,
    sequenceId: null,
    order: startSec,
    code,
    startSec,
    durationSec: 2,
    sourceInSec: 0,
    description: '',
    dialogue: null,
    camera: {
      size: 'medium',
      angleH: null,
      angle: null,
      lensMm: null,
      movement: null,
      movementIntensity: null,
    },
    mood: null,
    locationId: null,
    sourceType: { type: 'ai_video' },
    selectedTakeId: null,
    status: 'draft',
    lockedAt: null,
    createdAt: AT,
    updatedAt: AT,
  })

describe('Transition の削除', () => {
  it('同じ行で置き直せるので、確認を挟まずに消す', async () => {
    const from = shot('SHTAA', 'S001', 0)
    const to = shot('SHTBB', 'S002', 2)
    const transition = Transition.parse({
      id: ulid('TRANA'),
      projectId: PROJECT_ID,
      fromShotId: from.id,
      toShotId: to.id,
      type: 'dissolve',
      durationSec: 0.5,
    })
    const onRemove = vi.fn()
    render(
      <TimelineTransitionEditor
        shots={[from, to]}
        transitions={[transition]}
        busy={false}
        onAdd={vi.fn()}
        onRemove={onRemove}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: '削除（Transition）' }))

    // 差し替えの正規手順が「削除してから置き直す」なので、ここで確認を出すと操作を妨げる。
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(transition.id)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
