import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { WorkbenchProvider } from '@/components/workbench/workbench-provider'
import { aProject, aWorkbenchShot } from './workbench-fixture'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

/**
 * 新規 Shot を作ったら、**読み込み直さずに一覧へ出る**。
 *
 * 制作者 2026-10-17「新規ボタンから Shot 作ったら Shot が表示されなくて、リロードしたら出てきた」。
 * 作った Shot を選ぶだけで、手元の一覧に足していなかった。
 */

const EXISTING = aWorkbenchShot(1)
const CREATED = aWorkbenchShot(2)

const Probe = () => {
  const workbench = useWorkbench()
  return (
    <div>
      <span data-testid="ids">{(workbench.shots ?? []).map((s) => s.id).join(',')}</span>
      <span data-testid="selected">{workbench.selectedShotId ?? ''}</span>
      <button
        type="button"
        onClick={() => {
          workbench.addShot(CREATED)
          workbench.selectShot(CREATED.id)
        }}
      >
        作った
      </button>
    </div>
  )
}

const renderWorkbench = () =>
  render(
    <WorkbenchProvider
      project={aProject}
      initialShots={[EXISTING]}
      track={null}
      analysis={null}
      musicLoaded={false}
      sequences={[]}
      locations={[]}
      loadErrors={[]}
      initialShotId={null}
      initialDialog={null}
      initialInspected={null}
      focusPanel={vi.fn()}
    >
      <Probe />
    </WorkbenchProvider>,
  )

describe('addShot', () => {
  it('作った Shot を一覧に足し、選んだままにする', () => {
    renderWorkbench()
    expect(screen.getByTestId('ids').textContent).toBe(EXISTING.id)

    act(() => {
      screen.getByRole('button', { name: '作った' }).click()
    })

    expect(screen.getByTestId('ids').textContent?.split(',')).toContain(CREATED.id)
    expect(screen.getByTestId('selected').textContent).toBe(CREATED.id)
  })
})
