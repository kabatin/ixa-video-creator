'use client'

import { useRouter } from 'next/navigation'
import { ProjectDuplicateForm } from '@/components/project-duplicate-form'
import { useWorkbench } from '@/components/workbench/workbench-context'
import type { ProjectDuplicateApi } from '@/lib/project-duplicate-api'
import { workbenchHref } from '@/lib/workbench-url'

/**
 * ワークベンチの「ファイル > プロジェクトを複製…」（制作者 2026-10-04。ADR-0037）。
 * 中身は作品一覧と共有する `ProjectDuplicateForm`。複製したら新しい作品のワークベンチへ移る。
 */
export const ProjectDuplicateDialogBody = ({ api }: { readonly api?: ProjectDuplicateApi }) => {
  const workbench = useWorkbench()
  const router = useRouter()
  return (
    <ProjectDuplicateForm
      source={{ id: workbench.projectId, name: workbench.project.name }}
      api={api}
      onOpen={(projectId) => {
        workbench.closeDialog()
        router.push(workbenchHref(projectId))
      }}
      onCancel={workbench.closeDialog}
    />
  )
}
