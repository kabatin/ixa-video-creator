import { Take, type Shot, TakeId } from '@ixa/domain'
import { act, render, screen } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ShotGenerateSection,
  type ShotGenerateApi,
} from '@/components/workbench/inspector/shot-generate-section'
import { WorkbenchContext } from '@/components/workbench/workbench-context'
import { WireGenerateResult } from '@/lib/api-schemas'
import type { WireCostMeter } from '@/lib/cost-meter-api'
import { POLL_INTERVAL_MS } from '@/lib/poller'
import { JOB_ID, SHOT_ID, takeJson } from './fixtures'
import { aWorkbenchShot, workbenchValue } from './workbench-fixture'

/**
 * 生成の進み具合と、累計費用の取り直し（F1 / F3b）。
 *
 * 直しているのは 2 つ。
 * 1. 生成中の行が **1 分でも 5 分でも同じ文字列**だった。解析（`analysis-starter`）も
 *    書き出し（`render-job-list`）も経過時間を出しているのに、生成だけ出していなかった。
 * 2. 累計費用が **mount 時 1 回**しか取られず、何本生成しても「使った額 $0.00」のまま
 *    固まっていた。
 *
 * **偽の進捗は出さない。** 本数が数えられないときは、数えられないと書く（lessons L-015）。
 */

const takeAt = (index: number): Take =>
  Take.parse({
    ...takeJson,
    id: `01ARZ3NDEKTSV4RRFFQ69G5G${String(index).padStart(2, '0')}`,
    index,
    createdAt: new Date(takeJson.createdAt),
  })

const generateResult = (jobCount: number): WireGenerateResult =>
  WireGenerateResult.parse({
    jobIds: Array.from({ length: jobCount }, (_, i) => `${JOB_ID.slice(0, 25)}${String(i).padStart(1, '0')}`),
    specHash: 'a'.repeat(64),
    resolvedModel: 'kling-v2',
    duplicateOfTakeId: null,
  })

const meter = (totalUsd: number): WireCostMeter => ({
  budgetUsd: 300,
  measured: { takeCount: totalUsd === 0 ? 0 : 1, totalUsd, byProvider: [] },
  stub: { takeCount: 0, totalUsd: 0 },
  byShot: [],
  unlistedShots: { takeCount: 0, measuredUsd: 0, stubTakeCount: 0 },
  otherRuns: [],
  totalUsd,
})

type ApiOverrides = Partial<ShotGenerateApi>

const fakeApi = (overrides: ApiOverrides = {}): ShotGenerateApi => ({
  generateTakes: vi.fn(() => Promise.resolve(generateResult(3))),
  listTakes: vi.fn(() => Promise.resolve([])),
  getCostMeter: vi.fn(() => Promise.resolve(meter(0))),
  requestReview: vi.fn((takeId: TakeId) => Promise.resolve({ takeId, queued: true })),
  listModels: vi.fn(() => Promise.resolve([])),
  ...overrides,
})

/**
 * 投入すると Shot が `generating` になる実物どおりの配線。
 * `replaceShots` を本物にしないと、押したあとの行が確かめられない。
 */
const Harness = ({
  api,
  initialStatus = 'draft',
}: {
  readonly api: ShotGenerateApi
  readonly initialStatus?: Shot['status']
}) => {
  const [shot, setShot] = useState<Shot>(() =>
    aWorkbenchShot(1, { id: SHOT_ID, status: initialStatus }),
  )
  const value = useMemo(
    () =>
      workbenchValue({
        shots: [shot],
        replaceShots: (updated) => {
          const next = updated[0]
          if (next !== undefined) setShot(next)
        },
      }),
    [shot],
  )
  return (
    <WorkbenchContext.Provider value={value}>
      <ShotGenerateSection shot={shot} api={api} />
    </WorkbenchContext.Provider>
  )
}

const tick = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const pressGenerate = async (): Promise<void> => {
  await act(async () => {
    screen.getByRole('button', { name: 'Take を生成' }).click()
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('生成の進み具合（F1）', () => {
  it('投入したら経過時間と「何本中何本」を出す', async () => {
    const listTakes = vi
      .fn<ShotGenerateApi['listTakes']>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([takeAt(1)])
    const api = fakeApi({ listTakes })

    render(<Harness api={api} />)
    await tick()
    await pressGenerate()

    const line = screen.getByRole('status')
    expect(line).toHaveTextContent('生成中です')
    expect(line).toHaveTextContent('経過 0:00.00')
    expect(line).toHaveTextContent('3 本中 0 本')

    await tick(POLL_INTERVAL_MS)
    expect(screen.getByRole('status')).toHaveTextContent('3 本中 1 本')
  })

  /** 生の秒（`116.04s`）を出さない。時刻の表記は `lib/format-time` に従う。 */
  it('経過は時計形式で出す', async () => {
    render(<Harness api={fakeApi()} />)
    await tick()
    await pressGenerate()
    await tick(POLL_INTERVAL_MS * 4)

    expect(screen.getByRole('status')).toHaveTextContent('経過 0:12.00')
  })

  /** 偽の進捗バーを出さない。割合は誰も報告していない。 */
  it('進捗バーは出さない', async () => {
    render(<Harness api={fakeApi()} />)
    await tick()
    await pressGenerate()

    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  /** 画面を開き直した生成は、いつ始まったかを誰も知らない。知らないと書く。 */
  it('この画面から投入していない生成では、分からないと書く', async () => {
    render(<Harness api={fakeApi()} initialStatus="generating" />)
    await tick()

    const line = screen.getByRole('status')
    expect(line).toHaveTextContent('生成中です')
    expect(line).toHaveTextContent('分かりません')
    expect(line).not.toHaveTextContent('経過 0:')
  })

  /** 数えられないことを「0 本終わった」に畳まない（lessons L-015）。 */
  it('Take を数えられないときは本数を出さず、数えられないと書く', async () => {
    const listTakes = vi
      .fn<ShotGenerateApi['listTakes']>()
      .mockRejectedValue(new Error('Take を引けません'))
    render(<Harness api={fakeApi({ listTakes })} />)
    await tick()
    await pressGenerate()

    const line = screen.getByRole('status')
    expect(line).toHaveTextContent('経過 0:00.00')
    expect(line).not.toHaveTextContent('本中')
    expect(line).toHaveTextContent('数えられません')
  })
})

describe('累計費用の取り直し（F3b）', () => {
  it('生成を投入したら費用を取り直す', async () => {
    const getCostMeter = vi
      .fn<ShotGenerateApi['getCostMeter']>()
      .mockResolvedValueOnce(meter(0))
      .mockResolvedValue(meter(1.25))

    render(<Harness api={fakeApi({ getCostMeter })} />)
    await tick()
    expect(screen.getByText(/使った額 \$0\.00/)).toBeInTheDocument()

    await pressGenerate()
    await tick()

    expect(getCostMeter.mock.calls.length).toBeGreaterThan(1)
    expect(screen.getByText(/使った額 \$1\.25/)).toBeInTheDocument()
  })

  /** 読めなかったのに「読み込んでいます…」のまま固まらない。 */
  it('費用を読めなかったら、読めなかったと出す', async () => {
    const getCostMeter = vi
      .fn<ShotGenerateApi['getCostMeter']>()
      .mockRejectedValue(new Error('費用の口が落ちています'))

    render(<Harness api={fakeApi({ getCostMeter })} />)
    await tick()

    expect(screen.getByText(/予算を読めませんでした/)).toBeInTheDocument()
    expect(screen.queryByText(/予算を読み込んでいます/)).toBeNull()
  })
})
