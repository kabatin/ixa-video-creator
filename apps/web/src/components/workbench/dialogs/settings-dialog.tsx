'use client'

import { EnvironmentPanel } from '@/components/environment-panel'
import { ProjectDeleteSection } from '@/components/project-delete-section'
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

      <hr className="my-6 border-line" />

      <h2 className="mb-1 text-base font-semibold text-text">接続先と実行の設定</h2>
      <p className="mb-3 text-sm text-muted">
        この環境が何につながっていて、何にお金が掛かるか。Project ごとではなく、この環境全体の設定です。
      </p>
      <EnvironmentPanel />

      <hr className="my-6 border-line" />

      {/* 取り返しのつかない操作は一番下（保存と「接続先と実行の設定」の間に挟まっていた）。 */}
      <ProjectDeleteSection project={project} />
    </div>
  )
}
