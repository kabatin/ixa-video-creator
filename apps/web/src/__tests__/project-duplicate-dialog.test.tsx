import { ProjectId, newId } from '@ixa/domain'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectDuplicateDialogBody } from '@/components/workbench/dialogs/project-duplicate-dialog'
import type { ProjectDuplicateApi, WireDuplicatedProject } from '@/lib/project-duplicate-api'
import { workbenchHref } from '@/lib/workbench-url'
import { aProject, renderInWorkbench } from './workbench-fixture'

/** ワークベンチの「プロジェクトを複製…」（制作者 2026-10-04）。いまの作品を元にし、複製したら新しい作品へ移る。 */

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

describe('ProjectDuplicateDialogBody', () => {
  it('いまの作品を元にし、複製したらダイアログを閉じて新しい作品を開く', async () => {
    const copied = newId(ProjectId)
    const api: ProjectDuplicateApi = {
      duplicateProject: vi.fn(() =>
        Promise.resolve({ project: { id: copied, name: 'x' }, notes: [] } as unknown as WireDuplicatedProject),
      ),
    }
    const { value } = renderInWorkbench(<ProjectDuplicateDialogBody api={api} />)

    expect(screen.getByRole('textbox', { name: '名前' })).toHaveValue(`${aProject.name}のコピー`)
    await userEvent.click(screen.getByRole('button', { name: '複製する' }))

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(workbenchHref(copied))
    })
    expect(api.duplicateProject).toHaveBeenCalledWith(value.projectId, expect.objectContaining({ name: `${aProject.name}のコピー` }))
    expect(value.closeDialog).toHaveBeenCalled()
  })
})
