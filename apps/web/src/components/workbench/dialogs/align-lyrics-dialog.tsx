'use client'

import { lyricLines, type Shot, type ShotId } from '@ixa/domain'
import { lyricBoundaryChanges, proposeLyricBoundaries, type LyricBoundary, type LyricCueRef } from '@ixa/timeline'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { goToLyricSync } from '@/components/workbench/workbench-navigation'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { formatClock, formatDuration } from '@/lib/format-time'
import type { RoughCutApi } from '@/lib/rough-cut-api'

/** 動きの書式（`+1.50s`）。尺の書式に符号を付ける。 */
const formatShift = (sec: number): string => `${sec >= 0 ? '+' : '−'}${formatDuration(Math.abs(sec))}`

/** 説明は 1 行に収まる長さだけ。全文はインスペクターにある。 */
const DESCRIPTION_PREVIEW = 48

const optionLabel = (cue: LyricCueRef, lines: readonly string[]): string =>
  `${formatClock(cue.atSec)}「${lines[cue.index] ?? ''}」`

/** 既定の選び方（すぐ後の歌い出し）。今の位置と同じなら選ばない（動かさない）。 */
const initialChoices = (boundaries: readonly LyricBoundary[]): ReadonlyMap<ShotId, number> =>
  new Map(
    boundaries.flatMap((boundary) =>
      boundary.suggested === null || boundary.suggested.atSec === boundary.atSec
        ? []
        : [[boundary.shotId, boundary.suggested.atSec] as const],
    ),
  )

/**
 * Shot の境目を歌い出しに揃える（制作者 2026-10-02「歌詞入れて再生してみると、かなり画像と歌詞がずれてる」）。
 *
 * 区切ったのが歌詞に時刻を付ける前だったので、境目が歌い出しより中央値 1.95 秒早かった。
 * **どの絵がどの歌詞に合うかは中身で決まる**ので、揃える先は行ごとに選ぶ（次の Shot の説明を添える）。
 * 当てるのは粗編集の適用（古さ・ロックの検査と変更の履歴がある）。計算は `@ixa/timeline` の `lyric-align`。
 */
export const AlignLyricsDialogBody = ({ api }: { readonly api?: Pick<RoughCutApi, 'applyRoughCut'> }) => {
  const workbench = useWorkbench()
  const client = useMemo(() => api ?? createApiClient(), [api])
  const shots = useMemo(() => workbench.shots ?? [], [workbench.shots])
  const { lyrics, lyricCues } = workbench.project
  const lines = useMemo(() => lyricLines(lyrics), [lyrics])
  const boundaries = useMemo(() => proposeLyricBoundaries(shots, lyricCues), [shots, lyricCues])
  const [chosen, setChosen] = useState<ReadonlyMap<ShotId, number>>(() => initialChoices(boundaries))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<readonly string[]>([])

  if (lyricCues.length === 0) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          歌詞の時刻がまだありません。「歌詞を合わせる」で歌い出しに時刻を付けると、Shot の境目をそこへ揃えられます。
        </p>
        <Button
          size="sm"
          onClick={() => {
            workbench.closeDialog()
            goToLyricSync(workbench)
          }}
        >
          歌詞を合わせる
        </Button>
      </div>
    )
  }

  const shotById = new Map<ShotId, Shot>(shots.map((shot) => [shot.id, shot]))
  const outcome = lyricBoundaryChanges(shots, chosen)
  const moving = chosen.size

  const choose = (shotId: ShotId, value: string): void => {
    const next = new Map(chosen)
    if (value === '') next.delete(shotId)
    else next.set(shotId, Number(value))
    setChosen(next)
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await client.applyRoughCut(workbench.projectId, outcome.changes)
      workbench.refresh()
      if (result.skipped.length > 0) {
        setSkipped(result.skipped.map((entry) => entry.reason))
        return
      }
      workbench.notify(`Shot の境目を ${String(moving)} か所、歌い出しに揃えました。変更の履歴から戻せます。`)
      workbench.closeDialog()
    } catch (caught) {
      setError(`揃えられませんでした: ${describeForPerson(caught)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-h-[70vh] flex-col gap-3 text-sm">
      <p className="text-muted">
        境目のすぐ後の歌い出しを選んであります。その歌詞に合う絵が次の Shot でなければ、行ごとに選び直してください。
      </p>
      {boundaries.length === 0 ? (
        <p className="text-muted">Shot が 2 つ以上ないので、揃える境目がありません。</p>
      ) : (
        <ol className="relative min-h-0 flex-1 divide-y divide-line overflow-auto rounded border border-line">
          {boundaries.map((boundary) => {
            const previous = shotById.get(boundary.previousShotId)
            const shot = shotById.get(boundary.shotId)
            const target = chosen.get(boundary.shotId)
            return (
              <li key={boundary.shotId} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-36 font-semibold text-text">{`${previous?.code ?? ''} → ${shot?.code ?? ''}`}</span>
                  <span className="w-16 tabular-nums text-muted">{formatClock(boundary.atSec)}</span>
                  {boundary.blockedReason !== null ? (
                    <span className="text-xs text-warn">{boundary.blockedReason}</span>
                  ) : (
                    <>
                      <select
                        aria-label={`${shot?.code ?? ''} の頭を揃える先`}
                        value={target === undefined ? '' : String(target)}
                        disabled={busy}
                        onChange={(event) => {
                          choose(boundary.shotId, event.target.value)
                        }}
                        className="min-w-0 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-sm"
                      >
                        <option value="">動かさない</option>
                        {boundary.choices.map((cue) => (
                          <option key={cue.index} value={String(cue.atSec)}>
                            {optionLabel(cue, lines)}
                          </option>
                        ))}
                      </select>
                      <span className="w-16 text-right tabular-nums text-muted">
                        {target === undefined ? '' : formatShift(target - boundary.atSec)}
                      </span>
                    </>
                  )}
                </div>
                {shot !== undefined && shot.description.trim() !== '' && (
                  <p className="truncate text-xs text-muted">
                    {`${shot.code}: ${shot.description.slice(0, DESCRIPTION_PREVIEW)}`}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {outcome.problem !== null && (
        <p role="alert" className="text-warn">
          {outcome.problem}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {skipped.length > 0 && (
        <div role="alert" className="text-warn">
          <p>当てられなかった変更があります（ほかは当てました。変更の履歴から戻せます）。</p>
          <ul className="list-disc pl-5">
            {skipped.map((reason, index) => (
              <li key={`${String(index)}:${reason}`}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={workbench.closeDialog} disabled={busy}>
          {skipped.length > 0 ? '閉じる' : 'やめる'}
        </Button>
        <Button
          size="sm"
          tone="primary"
          disabled={busy || moving === 0 || outcome.problem !== null || skipped.length > 0}
          onClick={() => void apply()}
        >
          {`${String(moving)} か所を動かす`}
        </Button>
      </div>
    </div>
  )
}
