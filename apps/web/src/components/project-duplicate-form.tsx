'use client'

import {
  DUPLICATION_ITEMS,
  DUPLICATION_ITEM_LABELS,
  duplicateProjectName,
  joinDuplicationLabels,
  missingRequirements,
  settleDuplicationItems,
  type DuplicationItem,
  type ProjectId,
} from '@ixa/domain'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import {
  createProjectDuplicateApi,
  type ProjectDuplicateApi,
  type WireDuplicatedProject,
} from '@/lib/project-duplicate-api'
import { createRequester } from '@/lib/requester'

/**
 * 作品を複製する画面の中身（制作者 2026-10-04「持って行きたいところだけ持っていけるようにすると超便利」。ADR-0037）。
 * **ワークベンチに依存しない**（作品一覧からも開く）。開く先は呼び出し側が決める。
 *
 * - 既定は全部オン。頼る項目を外すと、それに頼る項目も外れて押せなくなり、理由が出る（判定は domain と同じ）
 * - 外したものの知らせがあれば、新しい作品を開く前に見せる。無ければすぐ開く
 */

const GROUPS: readonly { readonly label: string; readonly items: readonly DuplicationItem[] }[] = [
  { label: '作品', items: ['concept', 'music', 'lyricTiming', 'telops', 'overlays'] },
  { label: '素材', items: ['characters', 'locations', 'brandAssets'] },
  { label: 'Shot', items: ['shots', 'storyboard', 'frames', 'takes'] },
]

const ALWAYS_LINE = 'いつも引き継ぐもの: 画面の形・大きさ・fps・予算'
const NEVER_LINE =
  '持っていかないもの: AI の絵コンテの案、変更の履歴（取り消し）、書き出した動画、作っている途中の生成、レビューの記録'

export type ProjectDuplicateFormProps = {
  readonly source: { readonly id: ProjectId; readonly name: string }
  readonly api?: ProjectDuplicateApi
  /** 新しい作品を開く（ワークベンチへ移る）。 */
  readonly onOpen: (projectId: ProjectId) => void
  readonly onCancel: () => void
}

export const ProjectDuplicateForm = ({ source, api, onOpen, onCancel }: ProjectDuplicateFormProps) => {
  const client = useMemo(() => api ?? createProjectDuplicateApi(createRequester(resolveApiBaseUrl())), [api])
  const [name, setName] = useState(() => duplicateProjectName(source.name))
  const [selected, setSelected] = useState<ReadonlySet<DuplicationItem>>(() => new Set(DUPLICATION_ITEMS))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<WireDuplicatedProject | null>(null)

  const toggle = (item: DuplicationItem): void => {
    setSelected((current) => {
      if (!current.has(item)) return new Set([...current, item])
      // 外したら、それに頼る項目も外す。
      return settleDuplicationItems(new Set([...current].filter((other) => other !== item)))
    })
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await client.duplicateProject(source.id, {
        name: name.trim(),
        items: DUPLICATION_ITEMS.filter((item) => selected.has(item)),
      })
      if (result.notes.length === 0) onOpen(result.project.id)
      else setDone(result)
    } catch (cause) {
      setError(`複製できませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  if (done !== null) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-text">{`「${done.project.name}」を作りました。`}</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {done.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button size="sm" tone="primary" onClick={() => onOpen(done.project.id)}>
            新しい作品を開く
          </Button>
        </div>
      </div>
    )
  }

  const nameMissing = name.trim() === ''
  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted">名前</span>
        <input
          type="text"
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          className="rounded border border-line-strong bg-surface px-2 py-1 text-sm text-text"
        />
      </label>
      {nameMissing && <p className="text-xs text-danger">名前を入れてください</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {GROUPS.map((group) => (
          <fieldset key={group.label} className="space-y-1 rounded border border-line p-3">
            <legend className="px-1 text-xs font-semibold text-muted">{group.label}</legend>
            {group.items.map((item) => {
              const missing = missingRequirements(item, selected)
              const blocked = missing.length > 0
              return (
                <label key={item} className={`flex items-start gap-2 ${blocked ? 'text-muted' : 'text-text'}`}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(item)}
                    disabled={busy || blocked}
                    onChange={() => toggle(item)}
                  />
                  <span>
                    {DUPLICATION_ITEM_LABELS[item]}
                    {blocked && (
                      <span className="block text-xs">{`${joinDuplicationLabels(missing)}を持っていくときだけ選べます`}</span>
                    )}
                  </span>
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>
      <p className="text-xs text-muted">{ALWAYS_LINE}</p>
      <p className="text-xs text-muted">{NEVER_LINE}</p>
      {error !== null && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel} disabled={busy}>
          やめる
        </Button>
        <Button size="sm" tone="primary" disabled={busy || nameMissing} onClick={() => void submit()}>
          {busy ? '複製しています…' : '複製する'}
        </Button>
      </div>
    </div>
  )
}
