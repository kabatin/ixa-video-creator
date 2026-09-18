import { ProjectId as ProjectIdSchema, newId } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CostMeterPanel } from '@/components/cost-meter'
import type { CostMeterApi, WireCostMeter } from '@/lib/cost-meter-api'

/**
 * 費用の画面（P63-2）。見たいのは 1 点。
 * **実測 0 件のとき、額の隣に必ず出どころが出るか。**
 */

const projectId = newId(ProjectIdSchema)

/** 実測のバケツ。既定では Provider の内訳を持たない（実 Provider を回していない状態）。 */
const measuredOf = (
  takeCount: number,
  totalUsd: number,
  byProvider: readonly { providerId: string; takeCount: number; totalUsd: number }[] = [],
): WireCostMeter['measured'] => ({ takeCount, totalUsd, byProvider: [...byProvider] })

const meter = (o: Partial<WireCostMeter> = {}): WireCostMeter => ({
  budgetUsd: 300,
  measured: measuredOf(0, 0),
  stub: { takeCount: 50, totalUsd: 0 },
  byShot: [],
  unlistedShots: { takeCount: 0, measuredUsd: 0, stubTakeCount: 0 },
  otherRuns: [],
  ...o,
  /**
   * **既定は「実測 + Take 以外」の合計。** 個別に上書きもできる。
   * ここを 0 固定にすると、`measured` を足したテストが予算バーを動かさなくなり、
   * 何を確かめているのか分からなくなる。
   */
  totalUsd:
    o.totalUsd ??
    (o.measured ?? measuredOf(0, 0)).totalUsd +
      (o.otherRuns ?? []).reduce((total, run) => total + run.totalUsd, 0),
})

const apiReturning = (value: WireCostMeter): CostMeterApi => ({
  getCostMeter: vi.fn(() => Promise.resolve(value)),
})

const apiFailing = (message: string): CostMeterApi => ({
  getCostMeter: vi.fn(() => Promise.reject(new Error(message))),
})

describe('CostMeterPanel', () => {
  /** **本制作の状態。** ここが消えると「$0 / $300、余裕あり」としか読めなくなる。 */
  it('実測 0 件・スタブ 50 件を額と一緒に読み上げる', () => {
    render(<CostMeterPanel projectId={projectId} initialMeter={meter()} />)

    expect(screen.getByText(/\$0\.00/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('実測 0 件（スタブ 50 件）')
    expect(screen.getByRole('alert')).toHaveTextContent('意味はありません')
  })

  it('予算バーは出す。使用率を読み上げまで届かせる', () => {
    render(
      <CostMeterPanel
        projectId={projectId}
        initialMeter={meter({ measured: measuredOf(4, 150) })}
      />,
    )

    const bar = screen.getByRole('meter', { name: '予算の使用率' })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(bar).toHaveAttribute('aria-valuetext', '予算 $300.00 のうち 50%')
  })

  it('実測があるときは警告にしない', () => {
    render(
      <CostMeterPanel
        projectId={projectId}
        initialMeter={meter({ measured: measuredOf(4, 150) })}
      />,
    )

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(/実測 4 件・スタブ 50 件/)).toBeInTheDocument()
  })

  /**
   * **「額に意味が無い」と言えるのは 1 円も払っていないときだけ。**
   * Take が 0 件でも、絵コンテ下書きで実際に払っていれば額には意味がある。
   * ここを実測の Take だけで判断していたため、$0.38 使ったあとも
   * 「この額に意味はありません」と嘘を出していた（2026-09-18）。
   */
  it('Take が 0 件でも、下書きで払っていれば「意味がない」と言わない', () => {
    render(
      <CostMeterPanel
        projectId={projectId}
        initialMeter={meter({
          otherRuns: [{ kind: 'storyboard_draft', runCount: 1, totalUsd: 0.38 }],
        })}
      />,
    )

    expect(screen.queryByText(/この額に意味はありません/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('1 円も払っていなければ「意味がない」と出す', () => {
    render(<CostMeterPanel projectId={projectId} initialMeter={meter()} />)

    expect(screen.getByRole('alert').textContent).toContain('この額に意味はありません')
  })

  /** null を「$0」と書かない（lessons L-021）。 */
  it('予算が未設定ならバーを描かず「予算未設定」と出す', () => {
    render(
      <CostMeterPanel projectId={projectId} initialMeter={meter({ budgetUsd: null })} />,
    )

    expect(screen.getByText('予算未設定')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('渡されていなければ自分で取りに行く', async () => {
    const api = apiReturning(meter({ measured: measuredOf(2, 12) }))
    render(<CostMeterPanel projectId={projectId} api={api} />)

    expect(screen.getByText('読み込み中です')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/\$12\.00/)).toBeInTheDocument()
    })
    expect(api.getCostMeter).toHaveBeenCalledWith(projectId)
  })

  /** 読めなかったことを黙らせない。0 件として描くと「使っていない」に化ける（L-015）。 */
  it('読めなかったら額ではなく理由を出す', async () => {
    render(<CostMeterPanel projectId={projectId} api={apiFailing('接続できません')} />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('費用を読めませんでした')
    })
    expect(screen.queryByText(/\$0\.00/)).toBeNull()
  })

  it('サーバ側で読めなかった理由を渡されたら、取りに行かずそれを出す', () => {
    const api = apiReturning(meter())
    render(<CostMeterPanel projectId={projectId} loadError="タイムアウト" api={api} />)

    expect(screen.getByRole('alert')).toHaveTextContent('タイムアウト')
    expect(api.getCostMeter).not.toHaveBeenCalled()
  })
})

describe('CostMeterPanel の Provider 名', () => {
  /**
   * 実測 0 件のときは Provider 名を添えない。「実測 0 件」で言い尽くしており、
   * 「（該当 Provider なし）」は重複するだけ。
   * **載せ忘れた Provider は実測に数えられて件数が 1 以上になる**ので、
   * 気付ける場面（下のテスト）は失われない。
   */
  it('実測が 1 件も無ければ Provider 名を添えない', () => {
    render(<CostMeterPanel projectId={projectId} initialMeter={meter()} />)
    expect(screen.queryByText(/該当 Provider なし/)).toBeNull()
    expect(screen.getByText(/実測 0 件/)).toBeInTheDocument()
  })

  it('実測に数えた Provider の名前と件数を出す', () => {
    render(
      <CostMeterPanel
        projectId={projectId}
        initialMeter={meter({
          measured: measuredOf(40, 0, [{ providerId: 'stub-v2', takeCount: 40, totalUsd: 0 }]),
        })}
      />,
    )

    expect(screen.getByText(/stub-v2 40 件/)).toBeInTheDocument()
  })

  it('消えた Shot の分があれば但し書きを出す', () => {
    render(
      <CostMeterPanel
        projectId={projectId}
        initialMeter={meter({
          measured: measuredOf(3, 10, [{ providerId: 'fal', takeCount: 3, totalUsd: 10 }]),
          unlistedShots: { takeCount: 2, measuredUsd: 4, stubTakeCount: 0 },
        })}
      />,
    )

    expect(screen.getByText('削除された Shot の分 $4.00（2 件）を含みます')).toBeInTheDocument()
  })

  it('溢れが無ければ但し書きを出さない', () => {
    render(<CostMeterPanel projectId={projectId} initialMeter={meter()} />)
    expect(screen.queryByText(/削除された Shot/)).toBeNull()
  })
})
