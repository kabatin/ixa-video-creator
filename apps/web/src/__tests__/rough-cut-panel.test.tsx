import { ProjectId as ProjectIdSchema, ShotId as ShotIdSchema, newId } from '@ixa/domain'
import type { RoughCutChange } from '@ixa/timeline'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RoughCutPanel } from '@/components/rough-cut-panel'
import type {
  RoughCutApi,
  WireRoughCutApplyResult,
  WireRoughCutPlan,
} from '@/lib/rough-cut-api'

/**
 * 粗編集の画面（P63-3）。見たいのは 3 点。
 * 1. **押すまで何も変わらない**こと（案を作っても適用の口を叩かない）
 * 2. **画面が受け取った案をそのまま送り返す**こと（画面で作り直さない）
 * 3. 決められなかったものが、件数に畳まれず理由ごと出ること
 */

const projectId = newId(ProjectIdSchema)
const shotA = newId(ShotIdSchema)
const shotB = newId(ShotIdSchema)

const MOVE: RoughCutChange = {
  kind: 'move',
  shotId: shotB,
  fromSec: 4.3,
  toSec: 4.5,
  reason: 'Shot S1 と Shot S2 の間に 0.300s の隙間がある。拍 4.500s に合わせる',
}

const TRIM: RoughCutChange = {
  kind: 'trim',
  shotId: shotA,
  fromDurationSec: 4,
  toDurationSec: 4.5,
  reason: 'Shot S1 の尺を伸ばす',
}

const aPlan = (o: Partial<WireRoughCutPlan> = {}): WireRoughCutPlan => ({
  changes: [MOVE, TRIM],
  unresolved: [],
  ...o,
})

type Spy = RoughCutApi & {
  readonly applyCalls: () => readonly (readonly RoughCutChange[])[]
}

const spyApi = (
  plan: WireRoughCutPlan,
  result: WireRoughCutApplyResult = { applied: [], skipped: [] },
): Spy => {
  const applyCalls: (readonly RoughCutChange[])[] = []
  return {
    applyCalls: () => applyCalls,
    planRoughCut: vi.fn(() => Promise.resolve(plan)),
    applyRoughCut: vi.fn((_projectId, changes: readonly RoughCutChange[]) => {
      applyCalls.push(changes)
      return Promise.resolve(result)
    }),
  }
}

const codes = new Map([
  [shotA, 'S1'],
  [shotB, 'S2'],
])

describe('RoughCutPanel', () => {
  it('開いただけでは案も作らない', () => {
    const api = spyApi(aPlan())
    render(<RoughCutPanel projectId={projectId} api={api} />)

    expect(api.planRoughCut).not.toHaveBeenCalled()
  })

  it('**案を作っても適用の口は叩かない**（押すまで何も変わらない）', async () => {
    const api = spyApi(aPlan())
    render(<RoughCutPanel projectId={projectId} api={api} shotCodes={codes} />)

    await userEvent.click(screen.getByRole('button', { name: '案を作る' }))
    await screen.findByText(/案が 2 件/)

    expect(api.applyRoughCut).not.toHaveBeenCalled()
    expect(screen.getByText(/適用を押したときだけ変わります/)).toBeInTheDocument()
  })

  it('何を・どこからどこへ・なぜ を出す', async () => {
    const api = spyApi(aPlan())
    render(<RoughCutPanel projectId={projectId} api={api} shotCodes={codes} />)

    await userEvent.click(screen.getByRole('button', { name: '案を作る' }))

    expect(await screen.findByText(/S2 — 位置を動かす/)).toBeInTheDocument()
    expect(screen.getByText('0:04.30 → 0:04.50')).toBeInTheDocument()
    expect(screen.getByText(MOVE.reason)).toBeInTheDocument()
  })

  it('**受け取った案をそのまま送り返す**', async () => {
    const api = spyApi(aPlan(), { applied: [MOVE, TRIM], skipped: [] })
    render(<RoughCutPanel projectId={projectId} api={api} shotCodes={codes} />)

    await userEvent.click(screen.getByRole('button', { name: '案を作る' }))
    await userEvent.click(await screen.findByRole('button', { name: /選んだ 2 件を適用する/ }))

    await waitFor(() => {
      expect(api.applyCalls()).toHaveLength(1)
    })
    expect(api.applyCalls()[0]).toEqual([MOVE, TRIM])
  })

  it('外した案は送らない', async () => {
    const api = spyApi(aPlan(), { applied: [TRIM], skipped: [] })
    render(<RoughCutPanel projectId={projectId} api={api} shotCodes={codes} />)

    await userEvent.click(screen.getByRole('button', { name: '案を作る' }))
    await screen.findByText(/案が 2 件/)
    await userEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /選んだ 1 件を適用する/ }))

    await waitFor(() => {
      expect(api.applyCalls()).toHaveLength(1)
    })
    expect(api.applyCalls()[0]).toEqual([TRIM])
  })

  it('**決められなかったものを件数に畳まず理由ごと出す**', async () => {
    const api = spyApi(
      aPlan({
        changes: [],
        unresolved: [{ shotId: shotA, reason: 'Take が 1 件も無いので決められない' }],
      }),
    )
    render(<RoughCutPanel projectId={projectId} api={api} shotCodes={codes} />)

    await userEvent.click(screen.getByRole('button', { name: '案を作る' }))

    expect(await screen.findByText(/Take が 1 件も無いので決められない/)).toBeInTheDocument()
    expect(screen.getByText(/決められなかったものが 1 件/)).toBeInTheDocument()
    // 案が 0 件でも「適用」は出さない。押せる口があると直せたように見える。
    expect(screen.queryByRole('button', { name: /適用する/ })).toBeNull()
  })

  it('当てられなかった分を、適用のあとに理由ごと出す', async () => {
    const api = spyApi(aPlan({ changes: [MOVE] }), {
      applied: [],
      skipped: [{ change: MOVE, reason: '案を作ったあとに Shot が動いています' }],
    })
    render(<RoughCutPanel projectId={projectId} api={api} shotCodes={codes} />)

    await userEvent.click(screen.getByRole('button', { name: '案を作る' }))
    await userEvent.click(await screen.findByRole('button', { name: /選んだ 1 件を適用する/ }))

    expect(
      await screen.findByText(/案を作ったあとに Shot が動いています/),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 件は当てられませんでした')
  })

  it('読めなかったら握り潰さず画面に出す', async () => {
    const api: RoughCutApi = {
      planRoughCut: vi.fn(() => Promise.reject(new Error('つながりません'))),
      applyRoughCut: vi.fn(() => Promise.resolve({ applied: [], skipped: [] })),
    }
    render(<RoughCutPanel projectId={projectId} api={api} />)

    await userEvent.click(screen.getByRole('button', { name: '案を作る' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('つながりません')
  })
})
