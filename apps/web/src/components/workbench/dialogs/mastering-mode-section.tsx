'use client'

import { MasteringMode, type Project, type ProjectMasteringMode } from '@ixa/domain'
import { useState } from 'react'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { createLibraryClient, type ProjectSettingsApi } from '@/lib/library-api'
import { MASTERING_OPTIONS, masteringHint, masteringValue } from '@/lib/take-audio'

/**
 * 仕上げの音量（ADR-0060）。書き出しの最後に、全体の大きさをそろえるか、山だけ抑えるか。選んだ時点で保存する。
 * 選んでいなければセリフの有無で決まる（セリフのある作品は「山だけ抑える」）。選べば、その後は切り替えない。
 * 作り終えた書き出しには効かない（書き出しは投入の時点の仕上げを控える）。
 */
export type MasteringModeSectionProps = {
  readonly project: Pick<Project, 'id' | 'masteringMode'>
  /** セリフのある Shot があるか。選んでいないときに、どちらになるかを見せる。 */
  readonly hasDialogue: boolean
  readonly onSaved?: () => void
  readonly api?: Pick<ProjectSettingsApi, 'updateProject'>
}

export const MasteringModeSection = ({ project, hasDialogue, onSaved, api }: MasteringModeSectionProps) => {
  const [chosen, setChosen] = useState<ProjectMasteringMode>(project.masteringMode)
  // 保存済みの値が外で変わったら（MCP で直した・取り消した）写す。描くときに比べる（AutoSaveField と同じ）。
  const [shown, setShown] = useState<ProjectMasteringMode>(project.masteringMode)
  if (shown !== project.masteringMode) {
    setShown(project.masteringMode)
    setChosen(project.masteringMode)
  }
  return (
    <div className="space-y-1">
      <AutoSaveSelect
        label="仕上げの音量"
        value={masteringValue(chosen, hasDialogue)}
        options={MASTERING_OPTIONS}
        onSave={async (raw) => {
          const next = MasteringMode.parse(raw)
          const client = api ?? createLibraryClient(resolveApiBaseUrl())
          const updated = await client.updateProject(project.id, { masteringMode: next })
          setChosen(updated.masteringMode)
          onSaved?.()
        }}
      />
      <p className="text-xs text-muted">{masteringHint(chosen, hasDialogue)}</p>
    </div>
  )
}
