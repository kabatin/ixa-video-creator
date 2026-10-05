'use client'

import { DUCKING_DEPTH_DB, type ProjectId, type ReadingEntry } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { SaveAudioSettingsBody, WireAudioSettings } from '@/lib/narration-api'

const STRENGTHS = [
  { label: '弱め', depthDb: DUCKING_DEPTH_DB.weak },
  { label: 'ふつう', depthDb: DUCKING_DEPTH_DB.medium },
  { label: '強め', depthDb: DUCKING_DEPTH_DB.strong },
] as const

const nearestStrength = (depthDb: number): number =>
  STRENGTHS.reduce<number>((best, s) => (Math.abs(s.depthDb - depthDb) < Math.abs(best - depthDb) ? s.depthDb : best), STRENGTHS[1].depthDb)

/**
 * 作品の音の設定（ADR-0038 / 0039）。読み辞書・ナレーションの間に BGM を下げる・話している字の強調。
 * 保存は丸ごと置き換える（PUT）。保存するとテロップが作り直される（読みと強調はテロップに効く）。
 */
export const NarrationSettings = ({
  projectId,
  api,
  onSaved,
}: {
  readonly projectId: ProjectId
  readonly api: ApiClient
  readonly onSaved: () => void
}) => {
  const [settings, setSettings] = useState<WireAudioSettings | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [draft, setDraft] = useState<ReadingEntry>({ written: '', reading: '' })
  const [color, setColor] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getAudioSettings(projectId)
      .then((loaded) => {
        if (!cancelled) setSettings(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setStatus(`音の設定を読み込めませんでした: ${describeForPerson(cause)}`)
      })
    return () => {
      cancelled = true
    }
  }, [api, projectId])

  if (settings === null) return status === null ? <p className="text-xs text-muted">読み込んでいます…</p> : <p role="alert" className="text-xs text-danger">{status}</p>

  const save = (next: SaveAudioSettingsBody): void => {
    setStatus('保存しています…')
    api
      .saveAudioSettings(projectId, next)
      .then((saved) => {
        setSettings(saved)
        setStatus('保存しました。')
        onSaved()
      })
      .catch((cause: unknown) => {
        setStatus(`保存できませんでした: ${describeForPerson(cause)}`)
      })
  }
  const body: SaveAudioSettingsBody = {
    readingDictionary: settings.readingDictionary,
    ducking: settings.ducking,
    telopHighlight: settings.telopHighlight,
  }

  return (
    <div className="space-y-3 text-sm">
      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-muted">読み辞書（読み間違えやすい言葉の読み）</legend>
        {settings.readingDictionary.map((entry) => (
          <div key={entry.written} className="flex items-center gap-2 text-xs">
            <span className="w-24 truncate">{entry.written}</span>
            <span className="text-muted">→</span>
            <span className="flex-1 truncate">{entry.reading}</span>
            <Button
              size="sm"
              aria-label={`${entry.written} の読みを消す`}
              onClick={() => {
                save({ ...body, readingDictionary: settings.readingDictionary.filter((e) => e.written !== entry.written) })
              }}
            >
              消す
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 text-xs">
          <input
            aria-label="書き方"
            placeholder="戦子"
            value={draft.written}
            onChange={(event) => {
              setDraft({ ...draft, written: event.target.value })
            }}
            className="h-6 w-24 rounded border border-line-strong bg-bg px-1"
          />
          <span className="text-muted">→</span>
          <input
            aria-label="読み"
            placeholder="せんこ"
            value={draft.reading}
            onChange={(event) => {
              setDraft({ ...draft, reading: event.target.value })
            }}
            className="h-6 flex-1 rounded border border-line-strong bg-bg px-1"
          />
          <Button
            size="sm"
            disabled={draft.written.trim() === '' || draft.reading.trim() === ''}
            onClick={() => {
              save({ ...body, readingDictionary: [...settings.readingDictionary, { written: draft.written.trim(), reading: draft.reading.trim() }] })
              setDraft({ written: '', reading: '' })
            }}
          >
            足す
          </Button>
        </div>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-muted">ナレーションの間に BGM を下げる</legend>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.ducking.enabled}
            onChange={(event) => {
              save({ ...body, ducking: { ...settings.ducking, enabled: event.target.checked } })
            }}
          />
          下げる
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted">強さ</span>
          <select
            aria-label="BGM を下げる強さ"
            value={nearestStrength(settings.ducking.depthDb)}
            disabled={!settings.ducking.enabled}
            onChange={(event) => {
              save({ ...body, ducking: { ...settings.ducking, depthDb: Number(event.target.value) } })
            }}
            className="h-6 rounded border border-line-strong bg-bg px-1"
          >
            {STRENGTHS.map((strength) => (
              <option key={strength.depthDb} value={strength.depthDb}>
                {strength.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-muted">話している字の強調（テロップ）</legend>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.telopHighlight.enabled}
            onChange={(event) => {
              save({ ...body, telopHighlight: { ...settings.telopHighlight, enabled: event.target.checked } })
            }}
          />
          話している字を色で塗る
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted">色</span>
          {/* 選んでいる間は保存しない（色を動かすたびにテロップを作り直さない）。離したら保存する。 */}
          <input
            type="color"
            aria-label="強調の色"
            value={color ?? settings.telopHighlight.color}
            disabled={!settings.telopHighlight.enabled}
            onChange={(event) => {
              setColor(event.target.value)
            }}
            onBlur={() => {
              if (color !== null && color !== settings.telopHighlight.color) {
                save({ ...body, telopHighlight: { ...settings.telopHighlight, color } })
              }
              setColor(null)
            }}
          />
        </label>
        <p className="text-xs text-muted">字の時刻がある声だけ塗ります（Mac の声と Gemini は、行の「字の時刻を取る」で付けます）。</p>
      </fieldset>

      {status !== null && <p className="text-xs text-muted">{status}</p>}
    </div>
  )
}
