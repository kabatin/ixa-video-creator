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
  readonly playing: boolean
  readonly onTogglePlay: () => void
  readonly onSeek: (sec: number) => void
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
 * Backspace で 1 つ戻す。Space で鳴らす・止める。打った行を押すとその時刻へ飛ぶ。
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
  return (
    <section aria-label="歌詞を合わせる" className="space-y-3 border-b border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-muted">{`${String(Math.min(cues.length, lines.length))}/${String(lines.length)} フレーズ`}</span>
        <Button size="sm" tone="primary" onClick={tap} disabled={next === undefined}>
          ここで歌い出す（Enter）
        </Button>
        <Button size="sm" onClick={undo} disabled={cues.length === 0}>
          1 つ戻す（Backspace）
        </Button>
        <Button size="sm" onClick={onTogglePlay}>
          {props.playing ? '止める（Space）' : '鳴らす（Space）'}
        </Button>
        <span className="flex-1" />
        <Button size="sm" onClick={props.onPlaceTelops} disabled={cues.length === 0}>
          歌詞をテロップにする…
        </Button>
      </div>
      <div aria-live="polite" className="space-y-1">
        <p className="text-xs text-muted">{`いま: ${nowIndex < 0 ? '（まだ歌い出していません）' : (lines[nowIndex] ?? '')}`}</p>
        <p className="text-xs text-muted">次に押すフレーズ</p>
        <p data-testid="next-lyric" className="text-2xl font-semibold text-text">
          {next ?? '（最後まで合わせました）'}
        </p>
        {lines[cues.length + 1] !== undefined && <p className="text-sm text-muted">{lines[cues.length + 1]}</p>}
      </div>
      {rejection !== null && (
        <p role="status" className="text-xs text-warn">
          {rejection}
        </p>
      )}
      <ol className="relative max-h-48 space-y-0.5 overflow-auto text-xs">
        {lines.map((line, index) => {
          const cue = cues[index]
          return (
            <li key={`${String(index)}:${line}`} className={index === nowIndex ? 'text-accent' : 'text-muted'}>
              {cue === undefined ? (
                <span>{`${String(index + 1)}. ${line} — まだ`}</span>
              ) : (
                <button
                  type="button"
                  aria-label={`${line} の歌い出し ${formatClock(cue)} へ飛ぶ`}
                  onClick={() => {
                    props.onSeek(cue)
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
    </section>
  )
}
