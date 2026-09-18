'use client'

import { ProjectSettingsForm } from '@/components/project-settings-form'
import { useWorkbench } from '@/components/workbench/workbench-context'

/**
 * プロジェクト設定（ダイアログ。UI-WORKBENCH §3.3）。中身は既存の `project-settings-form`。
 * 保存前の入力があるときは背景クリックで閉じない（殻の `guardUnsaved`）。
 */
export const SettingsDialogBody = () => {
  const { project } = useWorkbench()
  return (
    <div className="mx-auto w-full max-w-3xl">
      <p className="mb-4 text-sm text-muted">
        出力仕様と制作の制約を変更します。生成済みの Take には遡って効きません。
      </p>
      <ProjectSettingsForm project={project} />
    </div>
  )
}
