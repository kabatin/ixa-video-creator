'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { WorkbenchDialog } from '@/components/workbench/workbench-dialog'
import type { AudioRole } from '@/lib/audio-intake-role'

const CHOICES: readonly { readonly role: AudioRole; readonly label: string; readonly note: string }[] = [
  { role: 'music', label: '楽曲', note: '解析してビートとセクションを取ります。Shot の尺の元になります。' },
  { role: 'sfx', label: '効果音', note: '素材の効果音に入ります。タイムラインの効果音の段へドラッグして置けます。' },
]

/**
 * 落とした音を楽曲にするか効果音にするかを 1 回だけ聞く（制作者 2026-10-19）。何本かまとめて落としたら全部同じ扱い。
 * 初めの選びは呼び出し側が決める（短い音は効果音。`audio-intake-role.ts`）。
 */
export const AudioRoleDialog = ({
  files,
  initialRole,
  busy,
  onChoose,
  onClose,
}: {
  readonly files: readonly File[]
  readonly initialRole: AudioRole
  readonly busy: boolean
  readonly onChoose: (role: AudioRole) => void
  readonly onClose: () => void
}) => {
  const [role, setRole] = useState<AudioRole>(initialRole)
  return (
    <WorkbenchDialog open title={`音 ${String(files.length)} 本を何として取り込みますか`} size="medium" onClose={onClose}>
      <fieldset className="space-y-1" disabled={busy}>
        <legend className="sr-only">取り込み先</legend>
        {CHOICES.map((choice) => (
          <label key={choice.role} className="flex items-start gap-2 rounded px-2 py-1.5 text-sm text-text hover:bg-surface-2">
            <input
              type="radio"
              name="audio-role"
              value={choice.role}
              checked={role === choice.role}
              onChange={() => {
                setRole(choice.role)
              }}
              className="mt-1"
            />
            <span>
              <span>{choice.label}</span>
              <span className="block text-xs text-muted">{choice.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <ul className="relative mt-3 max-h-32 overflow-y-auto text-xs text-muted">
        {files.map((file, index) => (
          <li key={`${file.name}-${String(index)}`} className="truncate">
            {file.name}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <Button tone="secondary" disabled={busy} onClick={onClose}>
          やめる
        </Button>
        <Button
          tone="primary"
          disabled={busy}
          onClick={() => {
            onChoose(role)
          }}
        >
          取り込む
        </Button>
      </div>
    </WorkbenchDialog>
  )
}
