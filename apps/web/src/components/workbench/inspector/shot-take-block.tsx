'use client'

import type { Shot, Take } from '@ixa/domain'
import { useState } from 'react'
import { FootageImportForm } from '@/components/workbench/inspector/footage-import-form'
import { ShotDubSection } from '@/components/workbench/inspector/shot-dub-section'
import { ShotGenerateSection } from '@/components/workbench/inspector/shot-generate-section'
import { TakeAudioField } from '@/components/workbench/inspector/take-audio-field'
import { TakeSpeedField } from '@/components/workbench/inspector/take-speed-field'
import { TakeTimingField } from '@/components/workbench/inspector/take-timing-field'
import { SubLabel, SubPart } from '@/components/workbench/ui/collapsible-section'
import type { ShotDub } from '@/components/workbench/use-shot-dub'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { isGeneratingStatus } from '@/lib/shot-display'

/**
 * Shot の「Take」の区切りの中身（2026-10-26）。以前の「Take を作る」「Take」「声の差し替え」の 3 つを 1 つにまとめた
 * （制作者「区切りも良く分からない」。同じ Take の話が 3 か所に分かれていた）。
 *
 * 上から: 作る（このパネルの主ボタン「Take を生成」）→ できた Take の要約と採用の外し方（PHASE 8 / ADR-0022）→
 * 速さ・音 → 普段触らない操作（尺に合わせる・手持ちの動画を取り込む。ADR-0026）→ セリフがあれば声の差し替え（ADR-0062）。
 * 比べるのは中央の Take 比較（見出しの「比較を開く」）。
 */
export const ShotTakeBlock = ({
  shot,
  hasStartFrame,
  takes,
  takesError,
  adopted,
  dub,
}: {
  readonly shot: Shot
  readonly hasStartFrame: boolean
  readonly takes: readonly Take[] | null
  readonly takesError: string | null
  readonly adopted: Take | null
  readonly dub: ShotDub
}) => {
  const workbench = useWorkbench()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const generating = isGeneratingStatus(shot.status)
  const save = async (patch: Parameters<typeof workbench.saveShot>[1]): Promise<void> => {
    await workbench.saveShot(shot.id, patch)
  }

  const unselect = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const updated = await createApiClient().unselectTake(shot.id)
      workbench.replaceShots([updated])
      workbench.refresh()
    } catch (cause) {
      setMessage(`採用を外せませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SubLabel>Take を作る</SubLabel>
      <ShotGenerateSection shot={shot} hasStartFrame={hasStartFrame} />

      <div className="space-y-1.5 border-t border-line pt-2">
        {takesError !== null && (
          <p role="alert" className="text-xs text-danger">
            {takesError}
          </p>
        )}
        <p className="text-sm text-text">
          {takes === null
            ? '読み込んでいます…'
            : `${String(takes.length)} 本 / 採用: ${adopted === null ? 'なし' : `Take ${String(adopted.index)}`}`}
        </p>
        {adopted !== null && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void unselect()}>
              {busy ? '外しています…' : '採用を外す'}
            </Button>
            {/* 採用中の Take の動きから効果音の案を出す（ADR-0054）。 */}
            <Button
              size="sm"
              onClick={() => {
                workbench.openDialog('make-sfx', { shotIds: [shot.id] })
              }}
            >
              効果音を作る…
            </Button>
          </div>
        )}
        {message !== null && (
          <p role="alert" className="text-xs text-danger">
            {message}
          </p>
        )}
        <TakeSpeedField shot={shot} adopted={adopted} disabled={generating} onSave={save} />
        <TakeAudioField shot={shot} disabled={generating} onSave={save} />
        {/* 普段触らない操作は畳んでおく。 */}
        <SubPart title="尺に合わせる・動画を取り込む">
          <TakeTimingField
            shot={shot}
            adopted={adopted}
            disabled={generating}
            onSave={async (timing) => {
              await workbench.saveShot(shot.id, { timing })
            }}
          />
          <FootageImportForm
            shot={shot}
            workspaceId={workbench.project.workspaceId}
            projectId={workbench.projectId}
            disabled={generating}
            onImported={() => {
              workbench.refresh()
            }}
          />
        </SubPart>
      </div>

      {shot.dialogue.length > 0 && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <SubLabel>声の差し替え</SubLabel>
          <ShotDubSection shot={shot} dub={dub} takes={takes} />
        </div>
      )}
    </>
  )
}
