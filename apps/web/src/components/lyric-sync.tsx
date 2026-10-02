'use client'

import { lyricLines } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatClock } from '@/lib/format-time'
import { currentLyricIndex, tapCue, undoCue, type CueChange } from '@/lib/lyric-sync'

export type LyricSyncProps = {
  /** 作品の歌詞（1 行 = 1 フレーズ）。 */
  readonly lyrics: string
  /** 行ごとの歌い出しの秒（前から順に付ける）。 */
  readonly cues: readonly number[]
  /** 時刻が変わった（打った・戻した）。保存は呼び出し側。 */
  readonly onCuesChange: (cues: readonly number[]) => void
  readonly currentSec: number
  /** Space で鳴らす・止める。ボタンは置かない（再生の口は下の操作列ひとつ）。 */
  readonly onTogglePlay: () => void
  /** 押した時刻を寄せる（拍へ。切ってあればそのまま）。規則は呼び出し側（`timeline-snap`）。 */
  readonly snapAt: (sec: number) => number
  /** 「歌詞をテロップにする」。確認と実行は呼び出し側。 */
  readonly onPlaceTelops: () => void
  /** 歌詞がまだ無いとき、作品の方針を開く。 */
  readonly onOpenConcept: () => void
  /** 打鍵を受けるか（見えている間・ダイアログが無い間だけ）。 */
  readonly keyboard: boolean
}

/** 欄に打っている間は打鍵を横取りしない。 */
const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)

/**
 * 歌詞を合わせる（ADR-0033。制作者 2026-10-01「聴きながら打つ」）。
 *
 * 曲を流し、フレーズの歌い出しで Enter（または「ここで歌い出す」）。次に押すフレーズを大きく出す。
 * Backspace で 1 つ戻す。Space で鳴らす・止める（ボタンは置かない。再生の口は下の操作列ひとつ）。
 * 一覧は `LyricCueList` に分け、波形の下に置く。
 * 打つ・戻すの規則は `lib/lyric-sync.ts`。
 */
export const LyricSync = (props: LyricSyncProps) => {
  const { lyrics, cues, onCuesChange, currentSec, snapAt, onTogglePlay, keyboard } = props
  const lines = lyricLines(lyrics)
  const [rejection, setRejection] = useState<string | null>(null)

  const apply = (change: CueChange): void => {
    if ('rejection' in change) {
      setRejection(change.rejection)
      return
    }
    setRejection(null)
    onCuesChange(change.cues)
  }
  const tap = (): void => {
    apply(tapCue(cues, lines, snapAt(currentSec)))
  }
  const undo = (): void => {
    setRejection(null)
    if (cues.length > 0) onCuesChange(undoCue(cues))
  }

  useEffect(() => {
    if (!keyboard) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      const run = { Enter: tap, Backspace: undo, ' ': onTogglePlay }[event.key]
      if (run === undefined) return
      event.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  if (lines.length === 0) {
    return (
      <section aria-label="歌詞を合わせる" className="space-y-2 border-b border-line p-3 text-sm">
        <p className="text-muted">歌詞がまだありません。作品の方針の「歌詞」に、1 行に 1 フレーズで入れてください。</p>
        <Button size="sm" onClick={props.onOpenConcept}>
          作品の方針を開く
        </Button>
      </section>
    )
  }

  const nowIndex = currentLyricIndex(cues, currentSec)
  const next = lines[cues.length]
  const after = lines[cues.length + 1]
  return (
    <section aria-label="歌詞を合わせる" className="space-y-3 border-b border-line p-3">
      {/* 何をする画面かを 1 行で（制作者 2026-10-02「この画面すっごいわかりづらいなー」）。 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
        <p>① 下の ▶ か Space で曲を流す → ② フレーズの歌い出しで Enter → ③ 歌詞をテロップにする</p>
        <span className="tabular-nums">{`${String(Math.min(cues.length, lines.length))} / ${String(lines.length)} フレーズ`}</span>
      </div>
      <dl aria-live="polite" className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-3 gap-y-1">
        <dt className="text-xs text-muted">いま</dt>
        <dd className="text-sm text-text">{nowIndex < 0 ? '（まだ歌い出していません）' : (lines[nowIndex] ?? '')}</dd>
        <dt className="text-xs text-muted">次に押す</dt>
        <dd data-testid="next-lyric" className="text-2xl font-semibold text-text">
          {next ?? '（最後まで合わせました）'}
        </dd>
        {after !== undefined && (
          <>
            <dt className="text-xs text-muted">その次</dt>
            <dd className="text-sm text-muted">{after}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" tone="primary" onClick={tap} disabled={next === undefined}>
          ここで歌い出す（Enter）
        </Button>
        <Button size="sm" onClick={undo} disabled={cues.length === 0}>
          1 つ戻す（Backspace）
        </Button>
        <span className="flex-1" />
        {/* 押せない理由を出す。黙って押せないボタンを置かない。 */}
        {cues.length === 0 && <span className="text-xs text-muted">時刻を 1 つ付けると押せます</span>}
        <Button size="sm" onClick={props.onPlaceTelops} disabled={cues.length === 0}>
          歌詞をテロップにする…
        </Button>
      </div>
      {rejection !== null && (
        <p role="status" className="text-xs text-warn">
          {rejection}
        </p>
      )}
    </section>
  )
}

/**
 * フレーズの一覧（打った時刻へ飛ぶ）。**畳んでおく。** 頭に置くと 58 行が案内とボタンを押し下げた。
 * まだの行は薄く出すだけ（「— まだ」を並べない）。
 */
export const LyricCueList = ({
  lyrics,
  cues,
  currentSec,
  onSeek,
}: {
  readonly lyrics: string
  readonly cues: readonly number[]
  readonly currentSec: number
  readonly onSeek: (sec: number) => void
}) => {
  const lines = lyricLines(lyrics)
  if (lines.length === 0) return null
  const nowIndex = currentLyricIndex(cues, currentSec)
  return (
    <details className="border-t border-line px-3 py-2 text-xs">
      <summary className="cursor-pointer text-muted hover:text-text">
        {`フレーズの一覧（${String(Math.min(cues.length, lines.length))} / ${String(lines.length)}。押すとその時刻へ）`}
      </summary>
      <ol className="relative mt-2 max-h-48 space-y-0.5 overflow-auto">
        {lines.map((line, index) => {
          const cue = cues[index]
          return (
            <li key={`${String(index)}:${line}`} className={index === nowIndex ? 'text-accent' : 'text-muted'}>
              {cue === undefined ? (
                <span className="px-1 opacity-60">{`${String(index + 1)}. ${line}`}</span>
              ) : (
                <button
                  type="button"
                  aria-label={`${line} の歌い出し ${formatClock(cue)} へ飛ぶ`}
                  onClick={() => {
                    onSeek(cue)
                  }}
                  className="rounded px-1 text-left hover:bg-surface-2 hover:text-text"
                >
                  {`${String(index + 1)}. ${line} — ${formatClock(cue)}`}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
