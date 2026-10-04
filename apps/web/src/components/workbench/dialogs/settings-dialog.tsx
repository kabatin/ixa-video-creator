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
        画面の形・大きさ・なめらかさと、制作の制約を変えます。作り終えた Take には効きません。
      </p>
      <ProjectSettingsForm project={project} />

      <hr className="my-6 border-line" />

      <h2 className="mb-1 text-base font-semibold text-text">接続先と実行の設定</h2>
      {/* 設定の名前や再起動の手順など開発の言葉が多いので、既定は畳んでおく（開発者として使うときに開く）。 */}
      <details>
        <summary className="cursor-pointer text-sm text-muted hover:text-text">
          この環境が何につながっていて、何にお金が掛かるか（プロジェクトごとではなく、この環境全体の設定）
        </summary>
        <div className="mt-3">
          <EnvironmentPanel />
        </div>
      </details>

      <hr className="my-6 border-line" />

      {/* 取り返しのつかない操作は一番下（保存と「接続先と実行の設定」の間に挟まっていた）。 */}
      <ProjectDeleteSection project={project} />
    </div>
  )
}
