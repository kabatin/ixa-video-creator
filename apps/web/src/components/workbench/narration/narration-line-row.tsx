'use client'

import { NarrationTakeId, VoiceProfileId } from '@ixa/domain'
import { useState } from 'react'
import { AutoSaveField } from '@/components/workbench/ui/auto-save-field'
import { Button } from '@/components/ui/button'
import { describeForPerson } from '@/lib/api-error'
import type { ApiClient } from '@/lib/api-client'
import { formatApproxDuration, formatClock, formatDuration } from '@/lib/format-time'
import type { UpdateNarrationLineBody, WireNarrationLine, WireNarrationOverview, WireVoice } from '@/lib/narration-api'
import { lineStatus } from '@/lib/narration-view'
import { parseClockInput } from '@/lib/time-input'
import type { Segment } from './use-segment-player'

const UNDECIDED = ''

const TONE_CLASS = { muted: 'text-muted', warn: 'text-warn', danger: 'text-danger' } as const

export type NarrationLineRowProps = {
  readonly line: WireNarrationLine
  readonly index: number
  readonly voices: readonly WireVoice[]
  readonly api: ApiClient
  /** 直した結果の一覧を出す。 */
  readonly apply: (overview: WireNarrationOverview) => void
  /** 一覧とタイムラインを取り直す（ジョブを頼んだ・消した）。 */
  readonly reload: () => void
  readonly player: { readonly play: (segment: Segment) => void; readonly stop: () => void; readonly playing: string | null }
}

/**
 * 原稿の 1 行（ADR-0038）。表示（テロップに出す字）・話す声・長さ・声にする・Take・位置・テロップ。
 * 読み（AI に読ませる字）と演出は畳んでおく（ふだんは辞書の読みで足りる）。
 */
export const NarrationLineRow = ({ line, index, voices, api, apply, reload, player }: NarrationLineRowProps) => {
  const [error, setError] = useState<string | null>(null)
  const number = `${String(index + 1)} 行目`
  const status = lineStatus(line)
  const selected = line.takes.find((take) => take.id === line.selectedTakeId) ?? null

  const patch = async (body: UpdateNarrationLineBody): Promise<void> => {
    apply(await api.updateNarrationLine(line.id, body))
  }
  const run = (action: () => Promise<unknown>): void => {
    setError(null)
    action()
      .then(() => {
        reload()
      })
      .catch((cause: unknown) => {
        setError(describeForPerson(cause))
      })
  }
  const playing = selected !== null && player.playing === selected.id

  return (
    <li className="space-y-1 rounded border border-line p-2" aria-label={number}>
      <div className="flex items-start gap-2">
        <span className="mt-1 w-5 shrink-0 text-right text-xs text-muted">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <AutoSaveField
            label={`${number}の表示`}
            hideLabel
            value={line.text}
            validate={(next) => (next.trim() === '' ? '表示を入れてください' : null)}
            onSave={(next) => patch({ text: next.trim() })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-7 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-muted">話す声</span>
          <select
            aria-label={`${number}の話す声`}
            value={line.voiceProfileId ?? UNDECIDED}
            onChange={(event) => {
              const next = event.target.value
              run(() => patch({ voiceProfileId: next === UNDECIDED ? null : VoiceProfileId.parse(next) }))
            }}
            className="h-6 rounded border border-line-strong bg-bg px-1 text-xs text-text"
          >
            <option value={UNDECIDED}>未定</option>
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted">
          {formatApproxDuration(line.estimatedSec)}
          {line.durationSec !== null && `（声 ${formatDuration(line.durationSec)}）`}
        </span>
        <Button size="sm" disabled={line.voiceProfileId === null} onClick={() => run(() => api.speakLine(line.id))}>
          声にする
        </Button>
        {line.takes.length > 0 && (
          <span className="flex items-center gap-1" role="group" aria-label={`${number}の声の Take`}>
            {line.takes.map((take) => (
              <button
                key={take.id}
                type="button"
                aria-pressed={take.id === line.selectedTakeId}
                title={formatDuration(take.durationSec)}
                onClick={() => run(() => patch({ selectedTakeId: NarrationTakeId.parse(take.id) }))}
                className={`rounded px-1 ${take.id === line.selectedTakeId ? 'bg-accent/20 text-text' : 'text-muted hover:text-text'}`}
              >
                #{take.index}
              </button>
            ))}
          </span>
        )}
        {selected !== null && (
          <Button
            size="sm"
            aria-label={playing ? `${number}の声を止める` : `${number}の声を聴く`}
            onClick={() => {
              if (playing) player.stop()
              else player.play({ key: selected.id, mediaAssetId: selected.mediaAssetId, inSec: selected.inSec, outSec: selected.outSec })
            }}
          >
            {playing ? '■' : '▶'}
          </Button>
        )}
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={line.telop}
            onChange={(event) => {
              const telop = event.target.checked
              run(() => patch({ telop }))
            }}
          />
          テロップ
        </label>
        <Button
          size="sm"
          aria-label={`${number}を削除`}
          onClick={() => run(() => api.deleteNarrationLine(line.id))}
        >
          削除
        </Button>
      </div>

      <div className="pl-7">
        <AutoSaveField
          label="位置"
          value={line.startSec === null ? '' : formatClock(line.startSec)}
          placeholder="未配置（0:03.75 のように入れる）"
          validate={(next) => (next.trim() === '' || parseClockInput(next) !== null ? null : '0:03.75 のように入れてください')}
          onSave={(next) => patch({ startSec: next.trim() === '' ? null : parseClockInput(next) })}
        />
        <details>
          <summary className="cursor-pointer text-xs text-muted">読み・演出</summary>
          <AutoSaveField
            label="読み"
            value={line.readingIsManual ? line.reading : ''}
            placeholder={line.reading}
            onSave={(next) => patch({ reading: next.trim() === '' ? null : next.trim() })}
          />
          <p className="text-xs text-muted">空なら読み辞書から作ります（いまの読み: {line.reading}）。</p>
          <AutoSaveField
            label="演出"
            value={line.direction}
            placeholder="囁くように"
            onSave={(next) => patch({ direction: next.trim() })}
          />
          {selected !== null && selected.charTimes === null && (
            <Button size="sm" onClick={() => run(() => api.requestCharTiming(NarrationTakeId.parse(selected.id)))}>
              字の時刻を取る（話している字の強調に使う）
            </Button>
          )}
        </details>
      </div>

      {status !== null && <p className={`pl-7 text-xs ${TONE_CLASS[status.tone]}`}>{status.text}</p>}
      {error !== null && (
        <p role="alert" className="pl-7 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  )
}
