import { ProjectId, type Project } from '@ixa/domain'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MasteringModeSection } from '@/components/workbench/dialogs/mastering-mode-section'
import { TakeAudioField } from '@/components/workbench/inspector/take-audio-field'
import { PROJECT_ID } from './fixtures'

/** ADR-0060: Shot のインスペクターの Take の音と、プロジェクト設定の仕上げの音量。 */

describe('TakeAudioField', () => {
  it('消音の Shot（前からある Shot）は外れた形で見せ、押すと鳴らす', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<TakeAudioField shot={{ takeAudioMuted: true, takeAudioVolume: 1 }} onSave={onSave} />)

    const box = screen.getByRole('checkbox', { name: 'Take の音を鳴らす' })
    expect(box).not.toBeChecked()
    // 消音の間は大きさを触らせない。
    expect(screen.getByLabelText('Take の音の大きさ')).toBeDisabled()
    await userEvent.click(box)
    expect(onSave).toHaveBeenCalledWith({ takeAudioMuted: false })
  })

  it('大きさは割合で直す', async () => {
    const onSave = vi.fn(() => Promise.resolve())
    render(<TakeAudioField shot={{ takeAudioMuted: false, takeAudioVolume: 1 }} onSave={onSave} />)

    const field = screen.getByLabelText('Take の音の大きさ')
    expect(field).toHaveValue('100%')
    await userEvent.clear(field)
    await userEvent.type(field, '150{Enter}')
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ takeAudioVolume: 1.5 })
    })
  })
})

describe('MasteringModeSection', () => {
  const project = (masteringMode: Project['masteringMode']) => ({ id: ProjectId.parse(PROJECT_ID), masteringMode })

  it('選んでいなければ、セリフのある作品は「山だけ抑える」に見え、選ぶと保存する', async () => {
    const updateProject = vi.fn((_id: unknown, patch: { masteringMode?: Project['masteringMode'] }) =>
      Promise.resolve({ masteringMode: patch.masteringMode ?? null } as Project),
    )
    const onSaved = vi.fn()
    render(<MasteringModeSection project={project(null)} hasDialogue api={{ updateProject }} onSaved={onSaved} />)

    const select = screen.getByLabelText('仕上げの音量')
    expect(select).toHaveValue('peak')
    expect(screen.getByText(/セリフのある Shot があるので/)).toBeInTheDocument()

    await userEvent.selectOptions(select, 'loudnorm')
    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith(PROJECT_ID, { masteringMode: 'loudnorm' })
    })
    expect(onSaved).toHaveBeenCalled()
    expect(select).toHaveValue('loudnorm')
    expect(screen.getByText(/YouTube・SNS の基準にそろえます/)).toBeInTheDocument()
  })
})
