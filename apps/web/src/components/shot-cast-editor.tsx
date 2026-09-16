'use client'

import type { Character, CharacterLook, ShotId, WorkspaceId } from '@ixa/domain'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState, describeViewState } from '@/components/empty-state'
import { ErrorPanel } from '@/components/error-panel'
import { ShotCastRow } from '@/components/shot-cast-row'
import { Button } from '@/components/ui/button'
import { createApiClient, resolveApiBaseUrl } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import { NEW_CHARACTER_HREF } from '@/lib/character-links'
import { createRequester } from '@/lib/requester'
import { createShotCastApi, type WireShotCharacter } from '@/lib/shot-cast-api'
import {
  CAST_EMPTY_NOTICE,
  CAST_LOAD_FAILED_TITLE,
  NO_CHARACTERS_NOTICE,
  emptyCastRow,
  nextOrder,
  removeRow,
  replaceRow,
  toCastRows,
  validateCast,
  applyCharacterChange,
  type CastRow,
  type CastRowErrors,
} from '@/lib/shot-cast-form'
import { WORDING } from '@/lib/wording'

/**
 * Shot に出るキャラクターを選ぶ画面（`ShotCharacter` / docs/DOMAIN.md §5・§9）。
 *
 * ここで選んだ人の四面図と Look が、生成仕様の参照画像として解決される
 * （`packages/generation/src/context.ts`）。**割り当てないと人物の一貫性は効かない。**
 *
 * 「まだ誰も出ていない」と「読み込めなかった」を必ず別々に出す（lessons L-015）。
 * 前者は正常で、次にやることは追加。後者は異常で、次にやることは再読み込み。
 */
export type ShotCastEditorProps = {
  readonly shotId: ShotId
  /** キャラクター一覧の絞り込みに使う。Shot の属する Project の workspace。 */
  readonly workspaceId: WorkspaceId
  /** 生成中など、他の操作で画面が動いている間は触らせない。 */
  readonly disabled?: boolean
}

type Loaded = {
  readonly cast: readonly WireShotCharacter[]
  readonly characters: readonly Character[]
  readonly looks: readonly CharacterLook[]
}

type Feedback = { readonly tone: 'success' | 'error'; readonly message: string }

const FEEDBACK_CLASS = { success: 'text-emerald-700', error: 'text-rose-700' } as const

const INVALID_INPUT_MESSAGE = '入力に誤りがあります。各行の指摘を直してから保存してください。'

const castApi = () => createShotCastApi(createRequester(resolveApiBaseUrl()))

/**
 * 登場人物・キャラクター・Look をまとめて取る。
 * Look はキャラクターごとの経路しか無いので、人数分を 1 回の `Promise.all` に束ねる。
 * 直列に await すると往復が人数に比例して増える。
 */
const loadAll = async (shotId: ShotId, workspaceId: WorkspaceId): Promise<Loaded> => {
  const client = createApiClient()
  const [cast, characters] = await Promise.all([
    castApi().listShotCast(shotId),
    client.listCharacters(workspaceId),
  ])
  const looks = await Promise.all(characters.map(async (c) => client.listLooks(c.id)))
  return { cast, characters, looks: looks.flat() }
}

export const ShotCastEditor = ({ shotId, workspaceId, disabled = false }: ShotCastEditorProps) => {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rows, setRows] = useState<readonly CastRow[]>([])
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, CastRowErrors>>>({})
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // 追加した行の key。characterId はまだ無いので、連番で行の同一性を作る。
  const newRowCount = useRef(0)

  const load = useCallback((): void => {
    setLoadError(null)
    void loadAll(shotId, workspaceId)
      .then((next) => {
        setLoaded(next)
        setRows(toCastRows(next.cast))
        setRowErrors({})
      })
      .catch((cause: unknown) => {
        setLoaded(null)
        setLoadError(describeError(cause))
      })
  }, [shotId, workspaceId])

  useEffect(load, [load])

  if (loadError !== null) {
    const state = describeViewState('unreadable', '登場人物')
    return (
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">登場人物</h2>
        <ErrorPanel title={CAST_LOAD_FAILED_TITLE} message={loadError} hint={state.hint}>
          <Button onClick={load}>{WORDING.reload}</Button>
        </ErrorPanel>
      </section>
    )
  }

  if (loaded === null) {
    const state = describeViewState('loading', '登場人物')
    return (
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">登場人物</h2>
        <p role="status" className="text-sm text-slate-600">
          {state.title}
        </p>
      </section>
    )
  }

  const { cast, characters, looks } = loaded
  const busy = saving || disabled

  const addRow = (): void => {
    newRowCount.current += 1
    setFeedback(null)
    setRows((current) => [...current, emptyCastRow(`new-${String(newRowCount.current)}`, nextOrder(current))])
  }

  const save = (): void => {
    const validation = validateCast(rows, looks)
    if (!validation.ok) {
      setRowErrors(validation.errors)
      setFeedback({ tone: 'error', message: INVALID_INPUT_MESSAGE })
      return
    }

    setRowErrors({})
    setFeedback(null)
    setSaving(true)
    void castApi()
      .replaceShotCast(shotId, validation.entries)
      .then((next) => {
        setLoaded((current) => (current === null ? current : { ...current, cast: next }))
        setRows(toCastRows(next))
        setFeedback({ tone: 'success', message: '登場人物を保存しました。' })
      })
      .catch((cause: unknown) => {
        setFeedback({ tone: 'error', message: `保存に失敗しました: ${describeError(cause)}` })
      })
      .finally(() => {
        setSaving(false)
      })
  }

  /**
   * 保存済みの行は API で外し、まだ保存していない行は手元で取り消すだけにする。
   * **どちらも Character 自体は消さない。**
   */
  const unlink = (row: CastRow): void => {
    const saved = cast.find((entry) => entry.characterId === row.key)
    if (saved === undefined) {
      setRows((current) => removeRow(current, row.key))
      return
    }

    setFeedback(null)
    setSaving(true)
    void castApi()
      .unlinkShotCharacter(shotId, saved.characterId)
      .then(() => {
        // 他の行の編集途中を消さないよう、引き直さず手元の状態から同じ 1 件だけ外す。
        setLoaded((current) =>
          current === null
            ? current
            : { ...current, cast: current.cast.filter((e) => e.characterId !== saved.characterId) },
        )
        setRows((current) => removeRow(current, row.key))
        setFeedback({ tone: 'success', message: `${WORDING.unlink}しました。` })
      })
      .catch((cause: unknown) => {
        setFeedback({ tone: 'error', message: `${WORDING.unlink}に失敗しました: ${describeError(cause)}` })
      })
      .finally(() => {
        setSaving(false)
      })
  }

  if (characters.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">登場人物</h2>
        <EmptyState
          message={NO_CHARACTERS_NOTICE}
          actionHref={NEW_CHARACTER_HREF}
          actionLabel="キャラクターを登録する"
          hint="登録したキャラクターに Look（衣装）を作ると、この Shot に割り当てられます。"
        />
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">登場人物</h2>
      <p className="text-sm text-slate-600">
        ここで選んだ人の四面図と Look が、生成の参照画像として使われます。Look は必ず選んでください。
      </p>

      {rows.length === 0 ? (
        <p
          role="status"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600"
        >
          {CAST_EMPTY_NOTICE}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <ShotCastRow
              key={row.key}
              row={row}
              characters={characters}
              looks={looks}
              errors={rowErrors[row.key] ?? {}}
              disabled={busy}
              saved={cast.some((entry) => entry.characterId === row.key)}
              onChange={(patch) => {
                setRows((current) => replaceRow(current, row.key, patch))
              }}
              onSelectCharacter={(characterId) => {
                setRows((current) => applyCharacterChange(current, row.key, characterId, looks))
              }}
              onUnlink={() => {
                unlink(row)
              }}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={addRow}>
          登場人物を追加
        </Button>
        <Button tone="primary" disabled={busy} onClick={save}>
          {saving ? '保存中…' : `登場人物を${WORDING.save}`}
        </Button>
        {feedback !== null && (
          <p
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            className={`text-sm ${FEEDBACK_CLASS[feedback.tone]}`}
          >
            {feedback.message}
          </p>
        )}
      </div>
    </section>
  )
}
