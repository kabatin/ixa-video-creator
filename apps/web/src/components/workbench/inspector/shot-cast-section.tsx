'use client'

import { CharacterId, CharacterLookId, ShotCharacter, type Shot } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAssets } from '@/components/workbench/asset-store'
import { INPUT_CLASS } from '@/components/workbench/ui/section'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { castWithCharacter, type CastEntry } from '@/lib/asset-actions'

/** 送る形（shotId はパスで渡す）へ写す。 */
const toEntry = (entry: CastEntry & { readonly shotId?: unknown }): CastEntry => ({
  characterId: entry.characterId,
  lookId: entry.lookId,
  prominence: entry.prominence,
  order: entry.order,
})

const PROMINENCE_LABELS: Readonly<Record<CastEntry['prominence'], string>> = {
  primary: '主役',
  secondary: '脇',
  background: '背景',
}

/**
 * 登場人物（UI-WORKBENCH-2 §5.2 参照）。**変えた時点で保存する。**
 * 以前は「登場人物を保存」ボタンを押すまで反映されず、押し忘れると生成に載らなかった。
 * Look は必須（`ShotCharacter.lookId`）。足すときはそのキャラクターの既定の Look を使う。
 *
 * `version` が変わったら読み直す（ツリーからカードへドラッグで足したときなど）。
 */
export const ShotCastSection = ({
  shot,
  version,
}: {
  readonly shot: Shot
  readonly version: number
}) => {
  const api = useMemo(() => createApiClient(), [])
  const { characters, looks, actions } = useAssets()
  const [cast, setCast] = useState<readonly CastEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setCast(null)
    api
      .listShotCast(shot.id)
      .then((entries) => {
        if (!cancelled) setCast(entries.map(toEntry))
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(`登場人物を読めません: ${describeForPerson(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [api, shot.id, version])

  const save = useCallback(
    async (next: readonly CastEntry[]) => {
      setSaving(true)
      setError(null)
      try {
        const saved = await api.replaceShotCast(shot.id, next)
        setCast(saved.map(toEntry))
      } catch (cause) {
        setError(`登場人物を保存できませんでした: ${describeForPerson(cause)}`)
      } finally {
        setSaving(false)
      }
    },
    [api, shot.id],
  )

  const all = characters.state === 'ready' ? characters.value : []
  const nameOf = (id: CharacterId): string => all.find((c) => c.id === id)?.displayName ?? id
  const absent = all.filter((c) => !(cast ?? []).some((entry) => entry.characterId === c.id))

  if (cast === null) {
    return error === null ? (
      <p className="text-xs text-muted">読み込んでいます…</p>
    ) : (
      <p role="alert" className="text-xs text-danger">
        {error}
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {cast.length === 0 && (
        <p className="text-xs text-muted">
          まだ誰も出ていません。ツリーからカードへドラッグしても足せます。
        </p>
      )}
      {cast.map((entry, index) => (
        <div
          key={entry.characterId}
          className="grid grid-cols-[minmax(0,1fr)_7rem_4.5rem_1.5rem] items-center gap-1"
        >
          <span className="truncate text-sm text-text">{nameOf(entry.characterId)}</span>
          <select
            aria-label={`${nameOf(entry.characterId)} の Look`}
            value={entry.lookId}
            disabled={saving}
            onChange={(event) => {
              void save(
                cast.map((e, i) =>
                  i === index ? { ...e, lookId: CharacterLookId.parse(event.target.value) } : e,
                ),
              )
            }}
            className={INPUT_CLASS}
          >
            {(looks.get(entry.characterId) ?? []).map((look) => (
              <option key={look.id} value={look.id}>
                {look.name}
              </option>
            ))}
          </select>
          <select
            aria-label={`${nameOf(entry.characterId)} の扱い`}
            value={entry.prominence}
            disabled={saving}
            onChange={(event) => {
              const prominence = ShotCharacter.shape.prominence.parse(event.target.value)
              void save(cast.map((e, i) => (i === index ? { ...e, prominence } : e)))
            }}
            className={INPUT_CLASS}
          >
            {Object.entries(PROMINENCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`${nameOf(entry.characterId)} を外す`}
            disabled={saving}
            onClick={() => {
              void save(cast.filter((_, i) => i !== index))
            }}
            className="h-6 rounded text-muted hover:bg-surface-2 hover:text-danger"
          >
            ✕
          </button>
        </div>
      ))}
      {absent.length > 0 && (
        <select
          aria-label="登場人物を足す"
          value=""
          disabled={saving}
          onChange={(event) => {
            const characterId = CharacterId.parse(event.target.value)
            // 既定の Look で入れる。Look が 1 つも無いキャラクター（画像だけで作った古いもの）は「基本」を作ってから
            // 入れる（制作者 2026-10-04。以前は「ツリーで Look を足してから」と断り、戦子をどの Shot にも入れられなかった）。
            void actions
              .ensureDefaultLook(characterId)
              .then((look) => {
                const next = castWithCharacter(cast, characterId, look.id)
                if (next !== null) return save(next)
                return undefined
              })
              .catch((cause: unknown) => {
                setError(`登場人物を足せませんでした: ${describeForPerson(cause)}`)
              })
          }}
          className={INPUT_CLASS}
        >
          <option value="">＋ 登場人物を足す</option>
          {absent.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
