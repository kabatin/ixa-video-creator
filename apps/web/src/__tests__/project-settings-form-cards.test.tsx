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

/** 作品の種類は選んで直せる。**ここで種類を変えても形は変えない**（形は作った後に制作者が決めたもの）。 */
describe('ProjectSettingsForm の種類', () => {
  it('5 つの種類から選べ、いまの種類を選んでおく', () => {
    render(<ProjectSettingsForm project={{ ...aProject, kind: 'short' }} />)
    const select = screen.getByLabelText('種類')
    expect(select).toHaveValue('short')
    expect([...(select as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'ミュージックビデオ',
      'ショート動画',
      '紙芝居',
      'CM・予告',
      '素材置き場',
    ])
  })

  it('種類を変えても形と大きさは変わらない', async () => {
    render(<ProjectSettingsForm project={aProject} />)
    await userEvent.selectOptions(screen.getByLabelText('種類'), 'short')
    expect(screen.getByLabelText('種類')).toHaveValue('short')
    expect(screen.getByRole('radio', { name: /横長 16:9/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /^FHD/ })).toBeChecked()
  })
})
