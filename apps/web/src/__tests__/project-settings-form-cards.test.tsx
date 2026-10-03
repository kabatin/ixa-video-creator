import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectSettingsForm } from '@/components/project-settings-form'
import { aProject } from './workbench-fixture'

/**
 * プロジェクト設定の大きさ。保存済みの値が選択肢に無いときは「保存済みの値」として残す（開いただけで別の大きさに
 * 化けないように）。**同じ形のときだけ**（レビューで見つけた。形を変えても前の形の大きさが選べ、9:16 のまま
 * 1920×1080 で保存できていた）。
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe('ProjectSettingsForm の大きさ', () => {
  it('保存済みの大きさが選択肢に無ければ「保存済みの値」として出す', () => {
    render(<ProjectSettingsForm project={{ ...aProject, resolution: { width: 1600, height: 900 } }} />)
    expect(screen.getByRole('radio', { name: /保存済みの値/ })).toBeChecked()
  })

  it('形を変えたら、前の形の「保存済みの値」は出さない', async () => {
    render(<ProjectSettingsForm project={{ ...aProject, resolution: { width: 1600, height: 900 } }} />)
    await userEvent.click(screen.getByRole('radio', { name: /縦長 9:16/ }))
    expect(screen.queryByRole('radio', { name: /保存済みの値/ })).toBeNull()
  })
})
