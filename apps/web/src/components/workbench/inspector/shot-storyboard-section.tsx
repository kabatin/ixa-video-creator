'use client'

import type { ProjectId, Shot } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Button } from '@/components/ui/button'
import { useAssist } from '@/components/workbench/use-assist'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { createRequester } from '@/lib/requester'
import { describeMood } from '@/lib/storyboard-draft'
import {
  createStoryboardDraftApi,
  type StoryboardDraftApi,
  type WireStoryboardDraftItem,
  type WireStoryboardDraftRun,
} from '@/lib/storyboard-draft-api'

/**
 * Shot の「絵コンテ」（制作者 2026-10-03「絵コンテ自分で入力、編集することできない？ Shot のインスペクターでも
 * 単品の絵コンテ情報見れるようになってて編集削除ができればよさそうかも」）。
 *
 * - 説明と雰囲気は書けば保存される（✦ で AI に手伝わせられる）。「絵コンテを消す」で両方を空にする
 * - この Shot の AI の案（絵コンテの案）があれば、「なぜこの絵か」つきで見せ、その場で採用できる。
 *   採用した案は説明に入っているので、なぜこの絵かだけを残す（同じ文を 2 度出さない）
 */

type Draft = { readonly run: WireStoryboardDraftRun; readonly item: WireStoryboardDraftItem }

const defaultApi = (): StoryboardDraftApi => createStoryboardDraftApi(createRequester(resolveApiBaseUrl()))

/**
 * この Shot の最新の案。読み直したら（`epoch`）引き直す。案が無ければ null。
 * **どの Shot の案かを一緒に持つ。** Shot を替えた直後に前の Shot の案を出すと、「この案にする」が別の Shot で走る。
 */
const useShotDraft = (api: StoryboardDraftApi, projectId: ProjectId, shot: Shot, epoch: number): Draft | null => {
  const [loaded, setLoaded] = useState<{ readonly shotId: Shot['id']; readonly draft: Draft | null } | null>(null)
  useEffect(() => {
    let alive = true
    api
      .getLatestDraft(projectId)
      .then((latest) => {
        if (!alive) return
        const item = latest.items.find((candidate) => candidate.shotId === shot.id)
        setLoaded({ shotId: shot.id, draft: latest.run === null || item === undefined ? null : { run: latest.run, item } })
      })
      .catch(() => {
        // 案は手がかりで、無くても書ける。読めなければ出さない（理由は「絵コンテの案」の画面が出す）。
        if (alive) setLoaded({ shotId: shot.id, draft: null })
      })
    return () => {
      alive = false
    }
  }, [api, projectId, shot.id, epoch])
  return loaded?.shotId === shot.id ? loaded.draft : null
}

export const ShotStoryboardSection = ({
  shot,
  disabled,
  api,
}: {
  readonly shot: Shot
  /** 生成中は案の採用と消すを止める（書くのは止めない。生成に使われるのは投入した時点の説明）。 */
  readonly disabled: boolean
  readonly api?: StoryboardDraftApi
}) => {
  const workbench = useWorkbench()
  const assistFor = useAssist()
  const client = useMemo(() => api ?? defaultApi(), [api])
  const draft = useShotDraft(client, workbench.projectId, shot, workbench.serverEpoch)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: Parameters<typeof workbench.saveShot>[1]): Promise<void> => {
    await workbench.saveShot(shot.id, patch)
  }

  const adopt = async (current: Draft): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await client.adopt(workbench.projectId, current.run.id, [shot.id])
      workbench.applyAdoptedShots(result.shots)
    } catch (cause) {
      setError(`案を採用できませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const adopted = draft !== null && draft.item.adoptedAt !== null
  const sameAsNow =
    draft !== null && draft.item.description === shot.description && draft.item.mood === shot.mood

  return (
    <>
      <AutoSaveField
        label="説明"
        multiline
        value={shot.description}
        placeholder="夜のスタジアム。主人公がボールを追う。"
        onSave={(next) => save({ description: next })}
        assist={assistFor('shot_description', { shotId: shot.id })}
      />
      <AutoSaveField
        label="雰囲気"
        value={shot.mood ?? ''}
        placeholder="tense, cinematic"
        // 空欄は「未設定」。空文字を保存すると「空という指定」と区別できなくなる。
        onSave={(next) => save({ mood: next.trim() === '' ? null : next })}
        assist={assistFor('shot_mood', { shotId: shot.id })}
      />
      {draft !== null && (
        <div className="rounded-md border border-line bg-surface-2 p-2 text-xs">
          <p className="font-semibold text-muted">AI の案（絵コンテの案）</p>
          {adopted ? (
            <p className="mt-0.5 text-ok">採用しました（説明に入っています）</p>
          ) : (
            <>
              <p className="mt-0.5 text-sm text-text">{draft.item.description}</p>
              <p className="text-muted">{`雰囲気: ${describeMood(draft.item.mood)}`}</p>
            </>
          )}
          <p className="mt-0.5 text-muted">{`なぜこの絵か: ${draft.item.reason}`}</p>
          {!adopted && (
            <div className="mt-1.5 flex items-center gap-2">
              <Button size="sm" disabled={busy || disabled || sameAsNow} onClick={() => void adopt(draft)}>
                この案にする
              </Button>
              {sameAsNow && <span className="text-muted">いまの説明と同じです</span>}
            </div>
          )}
        </div>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {(shot.description !== '' || shot.mood !== null) && (
        <ConfirmButton
          label="絵コンテを消す"
          message="この Shot の説明と雰囲気を空にします。"
          confirmLabel="消す"
          size="sm"
          disabled={disabled}
          onConfirm={() => {
            setError(null)
            save({ description: '', mood: null }).catch((cause: unknown) => {
              setError(`絵コンテを消せませんでした: ${describeForPerson(cause)}`)
            })
          }}
        />
      )}
    </>
  )
}
