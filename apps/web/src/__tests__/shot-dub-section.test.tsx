import { CharacterId, DubJobId, ProjectId, ShotId, TakeId, newId, type Shot, type Take } from '@ixa/domain'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShotDubSection } from '@/components/workbench/inspector/shot-dub-section'
import { DUB_POLL_MS, useShotDub } from '@/components/workbench/use-shot-dub'
import { ApiError } from '@/lib/api-error'
import type { WireDubJob, WireShotDub } from '@/lib/dub-api'

/**
 * Shot の「声を差し替える」（ADR-0062）。押せないときは理由、押したら進み具合と取り消し、終わったら Shot を読み直し、
 * 差し替えた Take の結果の表（一致率・伸縮の幅・早口の警告）を出す。
 */

const api = vi.hoisted(() => ({ getShotDub: vi.fn(), startDub: vi.fn(), cancelDubJob: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ createApiClient: () => api }))

const SHOT = newId(ShotId)
const SOURCE = newId(TakeId)
const DUBBED = newId(TakeId)
const speakerId = newId(CharacterId)

const dialogue = [
  { speakerId, text: 'ねえ、ネズミくん。', offscreen: false, translation: null },
  { speakerId, text: 'なに？', offscreen: false, translation: null },
]

const record = {
  kind: 'dub' as const,
  sourceTakeId: SOURCE,
  voiceTool: 'gemini_api' as const,
  model: 'gemini-3.8-flash-tts',
  integratedLufs: -16,
  lines: [
    {
      lineIndex: 0, mode: 'lip' as const, added: false, sourceStartSec: 0.5, sourceEndSec: 1.5, placedStartSec: 0.46,
      placedEndSec: 1.6, agreement: 0.874, tempoMin: 1.02, tempoMax: 1.12, reading: 'plain' as const, warnings: [],
    },
    {
      lineIndex: 1, mode: 'lip' as const, added: false, sourceStartSec: 2, sourceEndSec: 2.5, placedStartSec: 1.96,
      placedEndSec: 2.6, agreement: 0.95, tempoMin: 1.38, tempoMax: 1.48, reading: 'pause' as const,
      warnings: [{ code: 'fast_tempo' as const, message: '早口に聞こえます。読み方の指示か Shot の指示を直してください' }],
    },
  ],
}

const job = (patch: Partial<WireDubJob>): WireDubJob => ({
  id: DubJobId.parse('01J00000000000000000000DB1'),
  projectId: ProjectId.parse('01J00000000000000000000PRJ'),
  shotId: SHOT,
  sourceTakeId: SOURCE,
  status: 'queued',
  takeId: null,
  costUsd: 0,
  error: null,
  record: null,
  queuedAt: new Date(),
  startedAt: null,
  finishedAt: null,
  ...patch,
})

type ShotLike = Pick<Shot, 'id' | 'status' | 'selectedTakeId' | 'dialogue'>

const Harness = ({ shot, takes, onSettled }: { shot: ShotLike; takes: readonly Take[] | null; onSettled: () => void }) => {
  const dub = useShotDub(shot, 0, onSettled)
  return <ShotDubSection shot={shot} dub={dub} takes={takes} />
}

const shot: ShotLike = { id: SHOT, status: 'approved', selectedTakeId: SOURCE, dialogue }

const takeOf = (id: TakeId, providerParams: Take['providerParams']): Take =>
  ({ id, shotId: SHOT, providerParams }) as unknown as Take

beforeEach(() => {
  api.getShotDub.mockReset()
  api.startDub.mockReset()
  api.cancelDubJob.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ShotDubSection', () => {
  it('差し替えられないときは押せず、理由を出す', async () => {
    api.getShotDub.mockResolvedValue({ blocker: '採用している Take に音がありません（音付きで作った Take だけ差し替えられます）', latestJob: null } satisfies WireShotDub)
    render(<Harness shot={shot} takes={[]} onSettled={vi.fn()} />)
    expect(await screen.findByText('採用している Take に音がありません（音付きで作った Take だけ差し替えられます）')).toBeTruthy()
    expect(screen.getByRole('button', { name: '声を差し替える' })).toHaveProperty('disabled', true)
  })

  it('押すと進み具合と取り消しを出し、終わったら Shot を読み直す', async () => {
    api.getShotDub.mockResolvedValueOnce({ blocker: null, latestJob: null } satisfies WireShotDub)
    api.startDub.mockResolvedValue(job({ status: 'queued' }))
    const onSettled = vi.fn()
    render(<Harness shot={shot} takes={[]} onSettled={onSettled} />)
    const button = screen.getByRole('button', { name: '声を差し替える' })
    await waitFor(() => {
      expect(button).toHaveProperty('disabled', false)
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await userEvent.click(button)
    expect(api.startDub).toHaveBeenCalledWith(SHOT)
    expect(await screen.findByText('順番を待っています…')).toBeTruthy()
    expect(screen.getByRole('button', { name: '取り消し' })).toBeTruthy()
    expect(button).toHaveProperty('disabled', true)

    api.getShotDub.mockResolvedValue({ blocker: null, latestJob: job({ status: 'succeeded', takeId: DUBBED, record }) })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DUB_POLL_MS + 10)
    })
    await waitFor(() => {
      expect(onSettled).toHaveBeenCalled()
    })
    expect(screen.queryByText('順番を待っています…')).toBeNull()
  })

  it('取り消すと止めた仕事を出す', async () => {
    api.getShotDub.mockResolvedValue({ blocker: null, latestJob: job({ status: 'running' }) })
    api.cancelDubJob.mockResolvedValue(job({ status: 'cancelled' }))
    render(<Harness shot={shot} takes={[]} onSettled={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: '取り消し' }))
    expect(api.cancelDubJob).toHaveBeenCalledWith('01J00000000000000000000DB1')
    await waitFor(() => {
      expect(screen.queryByText('声を差し替えています…')).toBeNull()
    })
  })

  it('断られたら理由を出す（同じ Shot を差し替えている最中など）', async () => {
    api.getShotDub.mockResolvedValue({ blocker: null, latestJob: null })
    api.startDub.mockRejectedValue(
      new ApiError('POST: 409', 409, JSON.stringify({ success: false, error: 'この Shot の声を差し替えている最中です' })),
    )
    render(<Harness shot={shot} takes={[]} onSettled={vi.fn()} />)
    const button = screen.getByRole('button', { name: '声を差し替える' })
    await waitFor(() => {
      expect(button).toHaveProperty('disabled', false)
    })
    await userEvent.click(button)
    expect((await screen.findByRole('alert')).textContent).toContain('この Shot の声を差し替えている最中です')
  })

  it('止まった差し替えは理由を出す', async () => {
    api.getShotDub.mockResolvedValue({
      blocker: null,
      latestJob: job({ status: 'failed', error: { code: 'no_dialogue_voice', message: '「ネコ」にセリフの声がありません', retryable: false } }),
    })
    render(<Harness shot={shot} takes={[]} onSettled={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('「ネコ」にセリフの声がありません')
  })

  it('採用中が差し替えた Take なら、行ごとの一致率・伸縮の幅・早口の警告（黄色）を出す', async () => {
    api.getShotDub.mockResolvedValue({ blocker: null, latestJob: null })
    render(
      <Harness
        shot={{ ...shot, selectedTakeId: DUBBED }}
        takes={[takeOf(SOURCE, { kind: 'http', request: {} }), takeOf(DUBBED, record)]}
        onSettled={vi.fn()}
      />,
    )
    const table = await screen.findByRole('table', { name: '差し替えの結果' })
    expect(table.textContent).toContain('87%')
    expect(table.textContent).toContain('1.02〜1.12 倍')
    const fast = screen.getByText('1.38〜1.48 倍')
    expect(fast.className).toContain('text-warn')
    expect(screen.getByText('早口に聞こえます。読み方の指示か Shot の指示を直してください')).toBeTruthy()
  })

  it('差し替えていない Take には結果の表を出さない', async () => {
    api.getShotDub.mockResolvedValue({ blocker: null, latestJob: null })
    render(<Harness shot={shot} takes={[takeOf(SOURCE, { kind: 'http', request: {} })]} onSettled={vi.fn()} />)
    await screen.findByRole('button', { name: '声を差し替える' })
    expect(screen.queryByRole('table', { name: '差し替えの結果' })).toBeNull()
  })
})
