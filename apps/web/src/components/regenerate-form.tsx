'use client'

import { Corrections, MAX_CORRECTION_LENGTH, MAX_CORRECTIONS, type ShotId } from '@ixa/domain'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { createApiClient, type ProjectApi } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WireGenerateResult } from '@/lib/api-schemas'
import { WORDING } from '@/lib/wording'

/**
 * 指摘を直して作り直す（PHASE 6.1）。
 *
 * レビュアーが埋めた `suggestedPromptDelta` を選んで持ってきて、
 * **送る前に人が読んで直せる**形にしてから生成へ戻す。
 *
 * `spec-compiler.ts` の方針（「人間が最終プロンプトを直接編集できるようにする」）に従う。
 * LLM でプロンプトを膨らませない。足すのは人が書いた文だけで、それがそのまま
 * 最終プロンプトの末尾に付く。**何が足されるかを隠さない**のがこの画面の仕事。
 */

/** 生成を頼む口だけ。レビューの口（`ReviewApi`）とは別の関心なので混ぜない。 */
export type RegenerateApi = Pick<ProjectApi, 'generateTakes'>

/**
 * 1 行 1 件として読む。空行と前後の空白は落とす。
 *
 * **改行で区切る。** 指摘の文には句点も読点も入るので、そこで切ると文が割れる。
 */
export const parseCorrections = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

/** 選んだ指摘の差分を入力欄の初期値にする。順序は一覧の並びのまま。 */
export const joinDeltas = (deltas: readonly string[]): string => deltas.join('\n')

/**
 * 送れるかどうかと、送れない理由。
 *
 * **上限は domain の `Corrections` に聞く。** 件数や字数をここへ書き写すと、
 * 画面では通るのに API が 422 を返す入力が生まれる。
 */
export type CorrectionsCheck =
  | { readonly ok: true; readonly corrections: readonly string[] }
  | { readonly ok: false; readonly reason: string }

export const checkCorrections = (list: readonly string[]): CorrectionsCheck => {
  if (list.length === 0)
    return { ok: false, reason: '足す文がありません。1 行以上書いてください。' }

  const parsed = Corrections.safeParse(list)
  if (parsed.success) return { ok: true, corrections: parsed.data }

  if (list.length > MAX_CORRECTIONS) {
    return {
      ok: false,
      reason: `足せるのは ${String(MAX_CORRECTIONS)} 行までです（いま ${String(list.length)} 行）。`,
    }
  }
  const tooLong = list.find((line) => line.length > MAX_CORRECTION_LENGTH)
  if (tooLong !== undefined) {
    return {
      ok: false,
      reason: `1 行は ${String(MAX_CORRECTION_LENGTH)} 字までです（いちばん長い行が ${String(tooLong.length)} 字）。`,
    }
  }
  // 上の 2 つで説明できない失敗は握り潰さず、zod の言い分をそのまま出す。
  return { ok: false, reason: parsed.error.issues.map((issue) => issue.message).join(' / ') }
}

/**
 * 最終プロンプトの末尾へ実際に足される文字列。
 * `compileSpec` が `'. '` で繋ぐので、見せる形もそれに合わせる。
 */
export const previewAppendedText = (corrections: readonly string[]): string =>
  corrections.join('. ')

export type RegenerateFormProps = {
  readonly shotId: ShotId
  /** 選んだ指摘の `suggestedPromptDelta`。入力欄の初期値になる。 */
  readonly initialDeltas: readonly string[]
  readonly disabled?: boolean
  readonly onCancel: () => void
  /**
   * 投入できたら呼ぶ。**投入結果をそのまま渡す。**
   * `jobIds` が無いと親は新しいジョブを追いかけられず、`duplicateOfTakeId` が無いと
   * 「同じ仕様の Take が既にある」ことを利用者に知らせられない。
   */
  readonly onQueued?: (result: WireGenerateResult) => void
  /** テストからの差し替え口。既定は既存の API クライアント。 */
  readonly api?: RegenerateApi
}

const defaultApi = (): RegenerateApi => createApiClient()

export const RegenerateForm = ({
  shotId,
  initialDeltas,
  disabled = false,
  onCancel,
  onQueued,
  api,
}: RegenerateFormProps) => {
  const [text, setText] = useState(() => joinDeltas(initialDeltas))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const client = useMemo<RegenerateApi>(() => api ?? defaultApi(), [api])
  const corrections = useMemo(() => parseCorrections(text), [text])
  const check = useMemo(() => checkCorrections(corrections), [corrections])
  const busy = disabled || submitting

  const submit = async (): Promise<void> => {
    if (!check.ok) return
    setSubmitting(true)
    setError(null)
    try {
      /**
       * モデルは AUTO で選び直す。**前回と同じモデルに固定しない。**
       * 直しても同じモデルで駄目なら別のモデルへ逃がせることが、
       * 作り直しを回す意味の半分を占める（ARCHITECTURE.md §13）。
       */
      const result = await client.generateTakes(shotId, {
        model: 'AUTO',
        count: 1,
        corrections: [...check.corrections],
      })
      onQueued?.(result)
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-md border border-line bg-surface-2 p-4">
      <h3 className="text-sm font-semibold text-text">指摘を直して作り直す</h3>
      <p className="mt-1 text-xs text-muted">
        1 行が 1 件です。ここに書いた文がそのまま生成プロンプトの末尾に足されます。
        {`最大 ${String(MAX_CORRECTIONS)} 行・1 行 ${String(MAX_CORRECTION_LENGTH)} 字まで。`}
      </p>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-text">プロンプトに足す文</span>
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value)
          }}
          disabled={busy}
          rows={Math.min(Math.max(corrections.length + 1, 3), 8)}
          className="mt-1 w-full rounded-md border border-line bg-surface p-2 font-mono text-xs text-text disabled:text-muted"
        />
      </label>

      {/*
        **送る前に何が足されるかを必ず見せる。** 黙って送ると、出来上がった動画を
        見るまで何を指示したのか誰も確かめられない。
      */}
      <div role="group" aria-label="送る内容" className="mt-3 rounded bg-surface p-3">
        <p className="text-xs font-semibold text-muted">
          {`送る内容（${String(corrections.length)} 件）`}
        </p>
        {corrections.length === 0 ? (
          <p className="mt-1 text-xs text-muted">まだ何も足されません。</p>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-text">
            {previewAppendedText(corrections)}
          </p>
        )}
      </div>

      {!check.ok && corrections.length > 0 && (
        <p role="alert" className="mt-2 text-xs text-warn">
          {check.reason}
        </p>
      )}

      {error !== null && (
        <p role="alert" className="mt-2 text-xs text-danger">
          作り直しを頼めませんでした: {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          tone="primary"
          size="sm"
          disabled={busy || !check.ok}
          onClick={() => {
            void submit()
          }}
        >
          {submitting ? '送信中…' : '直して作り直す'}
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          {WORDING.cancel}
        </Button>
        <span className="text-xs text-muted">モデルは自動で選び直します。</span>
      </div>
    </div>
  )
}
