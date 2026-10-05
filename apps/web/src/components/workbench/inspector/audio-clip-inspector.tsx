'use client'

import type { TimelineClipId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { ObjectHeader } from '@/components/workbench/ui/object-header'
import { Section } from '@/components/workbench/ui/section'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { PanelEmpty } from '@/components/workbench/panels/panel-frame'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { formatClock, formatDuration } from '@/lib/format-time'
import type { WireTimelineClip } from '@/lib/timeline-api'
import { parseClockInput } from '@/lib/time-input'

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly clip: WireTimelineClip | null }
  | { readonly kind: 'error'; readonly message: string }

/**
 * 効果音のクリップ（ADR-0039）。位置と音量を直し、消す。長さは落とした音の長さのまま。
 * 直したらサーバの材料を読み直す（プレビューとタイムラインが追いつく）。
 */
export const AudioClipInspector = ({ id }: { readonly id: TimelineClipId }) => {
  const workbench = useWorkbench()
  const api = useMemo(() => createApiClient(), [])
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .listClips(workbench.projectId, 'SFX')
      .then((clips) => {
        if (alive) setLoaded({ kind: 'ready', clip: clips.find((candidate) => candidate.id === id) ?? null })
      })
      .catch((cause: unknown) => {
        if (alive) setLoaded({ kind: 'error', message: describeForPerson(cause) })
      })
    return () => {
      alive = false
    }
  }, [api, id, workbench.projectId, workbench.serverEpoch])

  if (loaded.kind === 'loading') return <PanelEmpty title="効果音を読み込んでいます…" />
  if (loaded.kind === 'error') return <PanelEmpty title="効果音を読めませんでした" hint={loaded.message} />
  const clip = loaded.clip
  if (clip === null || clip.content.type !== 'media') {
    return <PanelEmpty title="この効果音は見つかりません" hint="消されたか、まだ読み込めていません。" />
  }
  const content = clip.content

  const save = async (patch: Parameters<typeof api.updateClip>[1]): Promise<void> => {
    const updated = await api.updateClip(id, patch)
    setLoaded({ kind: 'ready', clip: updated })
    workbench.refresh()
  }

  return (
    <div className="flex h-full flex-col">
      <ObjectHeader kind="効果音" title={`${formatClock(clip.startSec)}・${formatDuration(clip.durationSec)}`} />
      <div className="workbench-panel-body relative min-h-0 flex-1 overflow-auto">
        <Section title="効果音">
          <AutoSaveField
            label="位置"
            value={formatClock(clip.startSec)}
            validate={(next) => (parseClockInput(next) === null ? '0:03.75 のように入れてください' : null)}
            onSave={(next) => save({ startSec: parseClockInput(next) ?? clip.startSec })}
          />
          <AutoSaveField
            label="音量"
            value={`${String(Math.round(content.volume * 100))}%`}
            validate={(next) => {
              const value = Number.parseFloat(next)
              return Number.isFinite(value) && value >= 0 && value <= 200 ? null : '0〜200% で入れてください'
            }}
            onSave={(next) => save({ content: { ...content, volume: Number.parseFloat(next) / 100 } })}
          />
          <p className="text-xs text-muted">長さは落とした音の長さのままです。帯の上でつかんで動かすこともできます。</p>
          <Button
            size="sm"
            onClick={() => {
              setError(null)
              api
                .deleteClip(id)
                .then(() => {
                  workbench.inspect(null)
                  workbench.refresh()
                })
                .catch((cause: unknown) => {
                  setError(`消せませんでした: ${describeForPerson(cause)}`)
                })
            }}
          >
            この効果音を消す
          </Button>
          {error !== null && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </Section>
      </div>
    </div>
  )
}
