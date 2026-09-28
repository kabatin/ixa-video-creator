'use client'

import type { ProjectId, TextStyle, TimelineClipId } from '@ixa/domain'
import { useEffect, useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { FieldRow, INPUT_CLASS, Section } from '@/components/workbench/ui/section'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { TextStyleApi, WireTextStylePreset } from '@/lib/text-style-api'
import type { WireTimelineClip } from '@/lib/timeline-api'

/** 同じプロジェクトのテロップ 1 件ぶん（どのスタイルから当てたか）。 */
export type TextClipSummary = { readonly id: TimelineClipId; readonly styleId: string | null }

/**
 * スタイル（ADR-0028）。名前を付けて保存し、まとめて当てる。
 * 当てると値を写す。スタイルを直しても、当てたテロップは「反映」するまで変わらない。
 */
export const TextStylePresets = ({
  projectId,
  clipId,
  style,
  styleId,
  textClips,
  disabled = false,
  onApplied,
  api,
}: {
  readonly projectId: ProjectId
  readonly clipId: TimelineClipId
  /** このテロップのいまの見た目（上書きの分）。保存・上書きに使う。 */
  readonly style: TextStyle
  readonly styleId: string | null
  /** 同じプロジェクトのテロップすべて。まとめて当てる相手と件数に使う。 */
  readonly textClips: readonly TextClipSummary[]
  readonly disabled?: boolean
  readonly onApplied: (updated: readonly WireTimelineClip[]) => void
  readonly api?: TextStyleApi
}) => {
  const client = useMemo<TextStyleApi>(() => api ?? createApiClient(), [api])
  const selectId = useId()
  const nameId = useId()
  const [presets, setPresets] = useState<readonly WireTextStylePreset[] | null>(null)
  const [selected, setSelected] = useState<string>(styleId ?? '')
  const [name, setName] = useState('')
  const [reflect, setReflect] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ readonly tone: 'ok' | 'error'; readonly text: string } | null>(null)

  useEffect(() => {
    let alive = true
    client
      .listTextStyles(projectId)
      .then((found) => {
        if (!alive) return
        setPresets(found)
        setSelected((current) => (current !== '' ? current : (found[0]?.id ?? '')))
      })
      .catch((cause: unknown) => {
        if (alive) setMessage({ tone: 'error', text: `スタイルを読めませんでした: ${describeForPerson(cause)}` })
      })
    return () => {
      alive = false
    }
  }, [client, projectId])

  const preset = presets?.find((candidate) => candidate.id === selected) ?? null
  const users = preset === null ? [] : textClips.filter((clip) => clip.styleId === preset.id)

  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      setMessage({ tone: 'ok', text: await action() })
    } catch (cause) {
      setMessage({ tone: 'error', text: `できませんでした: ${describeForPerson(cause)}` })
    } finally {
      setBusy(false)
    }
  }

  const apply = (target: WireTextStylePreset, clipIds: readonly TimelineClipId[]) =>
    run(async () => {
      const updated = await client.applyTextStyle(projectId, {
        clipIds: [...clipIds],
        style: target.style,
        styleId: target.id,
      })
      onApplied(updated)
      return `「${target.name}」を ${String(updated.length)} 件に当てました。`
    })

  const saveAsNew = () =>
    run(async () => {
      const created = await client.createTextStyle(projectId, { name, style })
      setPresets((current) => [...(current ?? []), created])
      setSelected(created.id)
      setName('')
      // 保存したスタイルから当てたことにする（あとで「使っているテロップ」を探せるように）。
      const updated = await client.applyTextStyle(projectId, { clipIds: [clipId], style, styleId: created.id })
      onApplied(updated)
      return `「${created.name}」として保存しました。`
    })

  const overwrite = (target: WireTextStylePreset) =>
    run(async () => {
      const saved = await client.updateTextStyle(target.id, { style })
      setPresets((current) => (current ?? []).map((candidate) => (candidate.id === saved.id ? saved : candidate)))
      if (!reflect || users.length === 0) return `「${saved.name}」を上書きしました。`
      const updated = await client.applyTextStyle(projectId, {
        clipIds: users.map((clip) => clip.id),
        style: saved.style,
        styleId: saved.id,
      })
      onApplied(updated)
      return `「${saved.name}」を上書きし、使っている ${String(updated.length)} 件に反映しました。`
    })

  const locked = disabled || busy
  return (
    <Section title="スタイル">
      {presets !== null && presets.length === 0 && (
        <p className="text-xs text-muted">保存したスタイルはまだありません。いまの見た目に名前を付けて保存できます。</p>
      )}
      {presets !== null && presets.length > 0 && (
        <>
          <FieldRow label="スタイル" htmlFor={selectId}>
            <select
              id={selectId}
              value={selected}
              disabled={locked}
              onChange={(event) => {
                setSelected(event.target.value)
              }}
              className={INPUT_CLASS}
            >
              {presets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.id === styleId ? '（このテロップ）' : ''}
                </option>
              ))}
            </select>
          </FieldRow>
          {preset !== null && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={locked} onClick={() => void apply(preset, [clipId])}>
                このテロップに当てる
              </Button>
              <ConfirmButton
                size="sm"
                label="TEXT 帯のすべてに当てる"
                message={`テロップ ${String(textClips.length)} 件すべての見た目を「${preset.name}」にします。文字は変わりません。`}
                confirmLabel="すべてに当てる"
                disabled={locked || textClips.length === 0}
                onConfirm={() => void apply(preset, textClips.map((clip) => clip.id))}
              />
              <ConfirmButton
                size="sm"
                label="いまの見た目で上書き"
                message={`「${preset.name}」を、このテロップのいまの見た目で上書きします。`}
                confirmLabel="上書きする"
                disabled={locked}
                onConfirm={() => void overwrite(preset)}
              >
                <label className="mt-1 flex items-center gap-2 text-xs text-text">
                  <input
                    type="checkbox"
                    checked={reflect}
                    onChange={(event) => {
                      setReflect(event.target.checked)
                    }}
                  />
                  使っているテロップ {String(users.length)} 件にも反映する
                </label>
              </ConfirmButton>
            </div>
          )}
        </>
      )}
      <FieldRow label="新しい名前" htmlFor={nameId}>
        <input
          id={nameId}
          type="text"
          value={name}
          maxLength={60}
          placeholder="歌詞 など"
          disabled={locked}
          onChange={(event) => {
            setName(event.target.value)
          }}
          className={INPUT_CLASS}
        />
      </FieldRow>
      <Button size="sm" disabled={locked || name.trim() === ''} onClick={() => void saveAsNew()}>
        いまの見た目を保存
      </Button>
      {message !== null && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-xs ${message.tone === 'error' ? 'text-danger' : 'text-muted'}`}>
          {message.text}
        </p>
      )}
    </Section>
  )
}
