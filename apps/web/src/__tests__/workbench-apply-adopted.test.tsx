import type { Shot } from '@ixa/domain'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { WorkbenchProvider } from '@/components/workbench/workbench-provider'
import { aProject, aWorkbenchShot } from './workbench-fixture'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

/**
 * 絵コンテの案を採用したときに、**画面の一覧へ何を写すか**（ADR-0043）。
 *
 * 制作者 2026-10-07「絵コンテ採用したけど、Shot のインスペクターでカメラ設定に反映されてない」。
 * DB には入っていたが、応答から画面の状態へ写すときに説明と雰囲気しか見ていなかった。
 * **読み込み直せば出る**ので気付きにくい。
 */

/** 既定のカメラは `push_in`（fixture）。採用で `tilt` に変わることを見る。 */
const SHOT = aWorkbenchShot(1)

const Probe = () => {
  const workbench = useWorkbench()
  const shot = workbench.shots?.find((s) => s.id === SHOT.id)
  return (
    <div>
      <span data-testid="description">{shot?.description ?? ''}</span>
      <span data-testid="movement">{shot?.camera.movement ?? '(未指定)'}</span>
      <button
        type="button"
        onClick={() => {
          workbench.applyAdoptedShots([
            {
              id: SHOT.id,
              description: '採用した説明',
              mood: null,
              camera: { ...SHOT.camera, movement: 'tilt', movementIntensity: 'moderate' },
            } as Pick<Shot, 'id' | 'description' | 'mood' | 'camera'>,
          ])
        }}
      >
        採用を反映
      </button>
    </div>
  )
}

const renderWorkbench = () =>
  render(
    <WorkbenchProvider
      project={aProject}
      initialShots={[SHOT]}
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

describe('applyAdoptedShots', () => {
  it('採用した説明とカメラを、読み込み直さずに一覧へ写す', () => {
    renderWorkbench()
    expect(screen.getByTestId('movement').textContent).toBe('push_in')

    act(() => {
      screen.getByRole('button', { name: '採用を反映' }).click()
    })

    expect(screen.getByTestId('description').textContent).toBe('採用した説明')
    expect(screen.getByTestId('movement').textContent).toBe('tilt')
  })
})
