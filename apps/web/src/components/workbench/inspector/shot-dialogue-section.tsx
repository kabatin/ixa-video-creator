'use client'

import {
  CharacterId,
  dialogueSpeakerProblems,
  dialogueWarnings,
  type DialogueLine,
  type DubLineSpanSuggestion,
  type Shot,
} from '@ixa/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAssets } from '@/components/workbench/asset-store'
import { DialogueDubFields } from '@/components/workbench/inspector/dialogue-dub-fields'
import { INPUT_CLASS, TEXTAREA_CLASS } from '@/components/workbench/ui/section'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import {
  addDraftLine,
  draftsFrom,
  moveDraftLine,
  removeDraftLine,
  sameSavedLines,
  savableLines,
  speakerChoices,
  translationFromInput,
  updateDraftLine,
  type DraftLine,
} from '@/lib/dialogue-lines'

type Status = { readonly kind: 'idle' | 'saving' | 'saved' } | { readonly kind: 'error'; readonly message: string }

const ICON_BUTTON = 'h-6 w-6 rounded text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40'

/**
 * Shot のセリフ（ADR-0059）。行を足す・直す・消す・並べ替える。**変えた時点で保存する**（セリフは欄を離れたとき）。
 * 話し手は配役の人を先に、配役にいない人（画面外の声）を後に並べる。
 * 呼び名や声の説明が無い話し手は、Take を作る前に止まるので、ここで先に知らせる。
 *
 * 親は `key={shot.id}` で渡す（Shot を替えたら下書きを捨てる）。
 */
export const ShotDialogueSection = ({
  shot,
  version,
  disabled,
  suggestedSpans = [],
  onSave,
}: {
  readonly shot: Shot
  readonly version: number
  readonly disabled: boolean
  /** 前の声の差し替えが止まったときの、行ごとの区間の案（ADR-0062）。 */
  readonly suggestedSpans?: readonly DubLineSpanSuggestion[]
  readonly onSave: (patch: { readonly dialogue: DialogueLine[] }) => Promise<void>
}) => {
  const api = useMemo(() => createApiClient(), [])
  const { characters } = useAssets()
  const [drafts, setDrafts] = useState<readonly DraftLine[]>(() => draftsFrom(shot.dialogue))
  const [castIds, setCastIds] = useState<readonly CharacterId[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  /**
   * ほかの場所（MCP・取り消し）で直したら写す。**サーバの値が前のサーバの値から変わったときだけ**
   * （下書きと比べない）。ほかの欄の保存で Shot が読み直されると参照だけが新しくなり、打っている途中の
   * セリフが消えていた（レビューの指摘）。
   */
  const serverJson = JSON.stringify(shot.dialogue)
  const lastServerJson = useRef(serverJson)
  useEffect(() => {
    if (lastServerJson.current === serverJson) return
    lastServerJson.current = serverJson
    setDrafts((current) => (sameSavedLines(current, shot.dialogue) ? current : draftsFrom(shot.dialogue)))
  }, [serverJson, shot.dialogue])

  useEffect(() => {
    let cancelled = false
    api
      .listShotCast(shot.id)
      .then((entries) => {
        if (!cancelled) setCastIds(entries.map((entry) => entry.characterId))
      })
      .catch((cause: unknown) => {
        if (!cancelled) setStatus({ kind: 'error', message: `登場人物を読めません: ${describeForPerson(cause)}` })
      })
    return () => {
      cancelled = true
    }
  }, [api, shot.id, version])

  const all = characters.state === 'ready' ? characters.value : []
  const choices = speakerChoices(castIds, all)
  const saved = savableLines(drafts)
  const warnings = dialogueWarnings(saved)
  const problems = dialogueSpeakerProblems(saved, all)

  /** 下書きを替え、保存する形が変わったときだけ送る。 */
  const commit = (next: readonly DraftLine[]): void => {
    setDrafts(next)
    if (sameSavedLines(next, shot.dialogue)) return
    setStatus({ kind: 'saving' })
    onSave({ dialogue: savableLines(next) })
      .then(() => {
        setStatus({ kind: 'saved' })
      })
      .catch((cause: unknown) => {
        setStatus({ kind: 'error', message: `セリフを保存できませんでした: ${describeForPerson(cause)}` })
      })
  }

  const busy = disabled || status.kind === 'saving'
  const firstSpeaker = choices.cast[0]?.id ?? choices.others[0]?.id ?? null
  /** 音量を合わせる行に選べる行（足す行でない行）。 */
  const levelLikeChoices = drafts.flatMap((draft, index) => (draft.dub?.added === true ? [] : [{ index, text: draft.text }]))

  if (all.length === 0) {
    return <p className="text-xs text-muted">キャラクターを作ると、セリフを書けます。</p>
  }

  return (
    <div className="space-y-2">
      {drafts.length === 0 && <p className="text-xs text-muted">セリフはまだありません。</p>}
      {drafts.map((draft, index) => (
        <DialogueRow
          key={index}
          index={index}
          count={drafts.length}
          draft={draft}
          choices={choices}
          levelLikeChoices={levelLikeChoices}
          suggestion={suggestedSpans.find((span) => span.lineIndex === index) ?? null}
          disabled={busy}
          onChange={(patch) => {
            commit(updateDraftLine(drafts, index, patch))
          }}
          onDraft={(patch) => {
            setDrafts(updateDraftLine(drafts, index, patch))
          }}
          onMove={(by) => {
            commit(moveDraftLine(drafts, index, by))
          }}
          onRemove={() => {
            commit(removeDraftLine(drafts, index))
          }}
        />
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setDrafts(addDraftLine(drafts, firstSpeaker))
        }}
        className="h-6 rounded px-1 text-sm text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
      >
        ＋ セリフを足す
      </button>
      {[...warnings.map((w) => w.message), ...problems].map((message) => (
        <p key={message} role="status" className="text-xs text-warn">
          {message}
        </p>
      ))}
      {problems.length > 0 && (
        <p className="text-xs text-muted">英語の呼び名と声の説明は、キャラクターのインスペクターで入れます。</p>
      )}
      <p role={status.kind === 'error' ? 'alert' : 'status'} className={status.kind === 'idle' ? 'sr-only' : 'text-xs'}>
        {status.kind === 'saving' && <span className="text-muted">保存中…</span>}
        {status.kind === 'saved' && <span className="text-ok">✓ 保存しました</span>}
        {status.kind === 'error' && <span className="text-danger">{status.message}</span>}
      </p>
    </div>
  )
}

type Choices = ReturnType<typeof speakerChoices>

const DialogueRow = ({
  index,
  count,
  draft,
  choices,
  levelLikeChoices,
  suggestion,
  disabled,
  onChange,
  onDraft,
  onMove,
  onRemove,
}: {
  readonly index: number
  readonly count: number
  readonly draft: DraftLine
  readonly choices: Choices
  readonly levelLikeChoices: readonly { readonly index: number; readonly text: string }[]
  readonly suggestion: DubLineSpanSuggestion | null
  readonly disabled: boolean
  /** 保存する変更（話し手・画面外の印・セリフの確定）。 */
  readonly onChange: (patch: Partial<DraftLine>) => void
  /** 打っている途中（保存しない）。 */
  readonly onDraft: (patch: Partial<DraftLine>) => void
  readonly onMove: (by: -1 | 1) => void
  readonly onRemove: () => void
}) => {
  const label = `${String(index + 1)} 行目`
  // 消したキャラクターが話し手の行。選択肢に無い値だと先頭の人を選んだように見えるので、その旨の選択肢を出す。
  const missing =
    draft.speakerId !== null && ![...choices.cast, ...choices.others].some((c) => c.id === draft.speakerId)
  return (
    <div className="space-y-1 rounded border border-line p-1">
      <div className="flex items-center gap-1">
        <select
          aria-label={`${label}の話し手`}
          value={draft.speakerId ?? ''}
          disabled={disabled}
          onChange={(event) => {
            onChange({ speakerId: CharacterId.parse(event.target.value) })
          }}
          className={INPUT_CLASS}
        >
          {draft.speakerId === null && <option value="">話し手を選ぶ</option>}
          {missing && <option value={draft.speakerId ?? ''}>見つからない話し手（選び直してください）</option>}
          {choices.cast.length > 0 && (
            <optgroup label="登場人物">
              {choices.cast.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </optgroup>
          )}
          {choices.others.length > 0 && (
            <optgroup label={choices.cast.length > 0 ? 'そのほか（画面外の声など）' : 'キャラクター'}>
              {choices.others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button type="button" aria-label={`${label}を上へ`} disabled={disabled || index === 0} onClick={() => { onMove(-1) }} className={ICON_BUTTON}>
          ↑
        </button>
        <button type="button" aria-label={`${label}を下へ`} disabled={disabled || index === count - 1} onClick={() => { onMove(1) }} className={ICON_BUTTON}>
          ↓
        </button>
        <button type="button" aria-label={`${label}を消す`} disabled={disabled} onClick={onRemove} className={ICON_BUTTON}>
          ✕
        </button>
      </div>
      <textarea
        aria-label={`${label}のセリフ`}
        value={draft.text}
        placeholder="ねえ、ネズミくん。"
        disabled={disabled}
        onChange={(event) => {
          onDraft({ text: event.target.value })
        }}
        onBlur={(event) => {
          onChange({ text: event.target.value })
        }}
        className={TEXTAREA_CLASS}
      />
      <textarea
        aria-label={`${label}の訳文`}
        value={draft.translation ?? ''}
        placeholder="訳文（英語の字幕。2 段目に小さく出す）"
        disabled={disabled}
        onChange={(event) => {
          onDraft({ translation: event.target.value })
        }}
        onBlur={(event) => {
          onChange({ translation: translationFromInput(event.target.value) })
        }}
        className={TEXTAREA_CLASS}
      />
      <label className="flex items-center gap-1 text-xs text-muted">
        <input
          type="checkbox"
          checked={draft.offscreen}
          disabled={disabled}
          onChange={(event) => {
            onChange({ offscreen: event.target.checked })
          }}
        />
        画面外の声（映っている人の口は閉じたまま）
      </label>
      <DialogueDubFields
        label={label}
        index={index}
        dub={draft.dub}
        otherLines={levelLikeChoices}
        suggestion={suggestion}
        disabled={disabled}
        onChange={(dub) => {
          onChange({ dub })
        }}
      />
    </div>
  )
}
