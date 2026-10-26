'use client'

import type { Project, ProjectMasteringMode } from '@ixa/domain'
import { useState } from 'react'
import { AutoSaveSelect } from '@/components/workbench/ui/auto-save-choice'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { createLibraryClient, type ProjectSettingsApi } from '@/lib/library-api'
import { MASTERING_OPTIONS, masteringHint, masteringValue, parseMasteringChoice } from '@/lib/take-audio'

/**
 * 仕上げの音量（ADR-0060）。書き出しの最後に、全体の大きさをそろえるか、山だけ抑えるか。選んだ時点で保存する。
 * 自動（null。おすすめ）は、Take の音を鳴らす Shot があれば「山だけ抑える」。選べばその通りにし、自動へも戻せる。
 * 作り終えた書き出しには効かない（書き出しは投入の時点の仕上げを控える）。
 */
export type MasteringModeSectionProps = {
  readonly project: Pick<Project, 'id' | 'masteringMode'>
  /** タイムラインに Take の音を鳴らす Shot があるか。読めていなければ null。自動のときにどちらになるかを見せる。 */
  readonly takeAudioAudible: boolean | null
  readonly onSaved?: () => void
  readonly api?: Pick<ProjectSettingsApi, 'updateProject'>
}

export const MasteringModeSection = ({ project, takeAudioAudible, onSaved, api }: MasteringModeSectionProps) => {
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
        value={masteringValue(chosen)}
        options={MASTERING_OPTIONS}
        onSave={async (raw) => {
          const next = parseMasteringChoice(raw)
          if (next === undefined) return
          const client = api ?? createLibraryClient(resolveApiBaseUrl())
          const updated = await client.updateProject(project.id, { masteringMode: next })
          setChosen(updated.masteringMode)
          onSaved?.()
        }}
      />
      <p className="text-xs text-muted">{masteringHint(chosen, takeAudioAudible)}</p>
    </div>
  )
}
