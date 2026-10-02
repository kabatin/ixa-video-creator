'use client'

import { pickSheetReference, type CharacterId, type CharacterIdentityImage } from '@ixa/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { CharacterSheetApi, WireCharacterSheetState } from '@/lib/character-sheet-api'

/**
 * キャラクターシートの区画（ADR-0035。制作者 2026-10-03「動画生成に役立つ形式のキャラクターシートを 1 枚の画像から
 * 作れるといい。正面などの画像を用意したら、それを基に Codex CLI で作る」）。
 *
 * 手本は識別画像のうちキャラクターシート以外の主の画像（無ければ最初の 1 枚。規則は domain の `pickSheetReference`）。
 * できたシートは識別画像の四面図に足され、動画・絵コンテの生成で優先して使われる。
 * 頼んだら「作っています」にし、出来事が届いて `version` が変わったら読み直す（開き直しても状態は直近のジョブで出る）。
 */

type Job = WireCharacterSheetState['job']

const isDrawing = (job: Job): boolean => job?.status === 'queued' || job?.status === 'running'

export type CharacterSheetFieldProps = {
  readonly characterId: CharacterId
  /** いまの識別画像。読めていなければ null。 */
  readonly images: readonly CharacterIdentityImage[] | null
  /** 変わったら状態を読み直す（出来事が届いたとき）。 */
  readonly version: number
  /** 作っていたシートができた。識別画像を読み直させる。 */
  readonly onSheetAdded: () => void
  readonly api?: Pick<CharacterSheetApi, 'getCharacterSheet' | 'startCharacterSheet'>
}

export const CharacterSheetField = ({ characterId, images, version, onSheetAdded, api }: CharacterSheetFieldProps) => {
  const client = useMemo(() => api ?? createApiClient(), [api])
  const [job, setJob] = useState<Job | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 作っている最中を見ていたか。見ていたジョブが仕上がったときだけ識別画像を読み直させる。 */
  const watching = useRef(false)
  const added = useRef(onSheetAdded)
  added.current = onSheetAdded

  useEffect(() => {
    let alive = true
    client
      .getCharacterSheet(characterId)
      .then((state) => {
        if (!alive) return
        if (watching.current && state.job?.status === 'succeeded') added.current()
        watching.current = isDrawing(state.job)
        setJob(state.job)
      })
      .catch((cause: unknown) => {
        if (alive) setError(`キャラクターシートの状態を読めませんでした: ${describeForPerson(cause)}`)
      })
    return () => {
      alive = false
    }
  }, [client, characterId, version])

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const { jobId } = await client.startCharacterSheet(characterId)
      watching.current = true
      setJob({ id: jobId, status: 'queued', error: null })
    } catch (cause) {
      setError(`頼めませんでした: ${describeForPerson(cause)}`)
    } finally {
      setBusy(false)
    }
  }

  const hasReference = images !== null && pickSheetReference(images) !== null
  const hasSheet = images?.some((image) => image.role === 'four_view') ?? false
  const drawing = isDrawing(job ?? null)

  return (
    <section className="space-y-2 rounded-md border border-line p-2">
      <h3 className="text-xs font-semibold text-muted">キャラクターシート（四面図）</h3>
      {images !== null && !hasReference && (
        <p className="text-xs text-muted">
          正面などの画像をここへ落とすと、それを手本にキャラクターシート（正面・横・背面・斜めの全身を 1 枚に並べた絵）を作れます。
        </p>
      )}
      {hasReference && job !== undefined && (
        <Button size="sm" disabled={busy || drawing} onClick={() => void start()}>
          {hasSheet ? 'キャラクターシートを作り直す' : 'キャラクターシートを作る'}
        </Button>
      )}
      {drawing && (
        <p role="status" className="text-xs text-muted">
          キャラクターシートを作っています（1 枚 1 分ほど）。できたら識別画像に入ります。
        </p>
      )}
      {job?.status === 'failed' && (
        <p role="alert" className="text-xs text-danger">
          {`キャラクターシートを作れませんでした: ${job.error ?? '理由が届きませんでした。'}`}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted">作るのは「使う AI」の画像の欄で選んだ AI です。シートは動画・絵コンテの生成で優先して使われます。</p>
    </section>
  )
}
