'use client'

import type {
  CharacterId,
  CharacterLook,
  CharacterLookId,
  MediaAssetId,
  WorkspaceId,
} from '@ixa/domain'
import { useState } from 'react'
import { CanonicalFramePanel } from '@/components/canonical-frame-panel'
import { ErrorPanel } from '@/components/error-panel'
import { LookDetail } from '@/components/look-detail'
import { LookForm } from '@/components/look-form'
import { LookImagePanel } from '@/components/look-image-panel'
import { LookSelector } from '@/components/look-selector'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { CreateLookBody } from '@/lib/character-schemas'

export type LookPanelProps = {
  readonly characterId: CharacterId
  readonly workspaceId: WorkspaceId
  readonly initialLooks: readonly CharacterLook[]
}

/** 既定の Look（無ければ先頭）を初期選択にする。 */
const initialSelection = (looks: readonly CharacterLook[]): CharacterLookId | null =>
  (looks.find((look) => look.isDefault) ?? looks[0])?.id ?? null

/**
 * Look の一覧・切り替え・作成と、canonical frame の設定（docs/ARCHITECTURE.md §8）。
 * 既定 Look の付け替えは他の Look にも波及するため、変更後は一覧ごと引き直す。
 */
export const LookPanel = ({ characterId, workspaceId, initialLooks }: LookPanelProps) => {
  const [looks, setLooks] = useState<readonly CharacterLook[]>(initialLooks)
  const [selectedId, setSelectedId] = useState<CharacterLookId | null>(initialSelection(initialLooks))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = looks.find((look) => look.id === selectedId) ?? null

  const run = (label: string, task: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    void task()
      .catch((cause: unknown) => {
        setError(`${label}に失敗しました: ${describeError(cause)}`)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const reload = async (nextSelected?: CharacterLookId): Promise<void> => {
    const loaded = await createApiClient().listLooks(characterId)
    setLooks(loaded)
    setSelectedId(nextSelected ?? initialSelection(loaded))
  }

  const create = (input: CreateLookBody): void => {
    run('Look の作成', async () => {
      const created = await createApiClient().createLook(characterId, input)
      await reload(created.id)
    })
  }

  const makeDefault = (id: CharacterLookId): void => {
    run('既定 Look の切り替え', async () => {
      await createApiClient().updateLook(id, { isDefault: true })
      await reload(id)
    })
  }

  const remove = (id: CharacterLookId): void => {
    run('Look の削除', async () => {
      await createApiClient().deleteLook(id)
      await reload()
    })
  }

  const promote = (lookId: CharacterLookId, mediaAssetId: MediaAssetId): void => {
    run('canonical frame の設定', async () => {
      const updated = await createApiClient().setCanonicalFrame(lookId, mediaAssetId)
      setLooks((current) => current.map((look) => (look.id === updated.id ? updated : look)))
    })
  }

  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">Look</h2>
      <p className="text-sm text-slate-600">
        Look は時系列で変わる外見です。Shot は Look を指して衣装と髪型を切り替えます。
      </p>

      {looks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
          Look がありません。最初に作った Look が既定になります。
        </p>
      ) : (
        <LookSelector looks={looks} selectedLookId={selectedId} onSelect={setSelectedId} />
      )}

      {error !== null && <ErrorPanel title="操作に失敗しました" message={error} />}

      {selected !== null && (
        <div className="space-y-4">
          <LookDetail
            look={selected}
            busy={busy}
            onMakeDefault={() => {
              makeDefault(selected.id)
            }}
            onDelete={() => {
              remove(selected.id)
            }}
          />

          <CanonicalFramePanel
            look={selected}
            busy={busy}
            onSet={(mediaAssetId) => {
              promote(selected.id, mediaAssetId)
            }}
          />

          <LookImagePanel
            key={selected.id}
            lookId={selected.id}
            workspaceId={workspaceId}
            canonicalFrameAssetId={selected.canonicalFrameAssetId}
            onPromote={(mediaAssetId) => {
              promote(selected.id, mediaAssetId)
            }}
          />
        </div>
      )}

      <LookForm busy={busy} onSubmit={create} />
    </section>
  )
}
