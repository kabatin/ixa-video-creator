'use client'

import { AI_TOOLS, MUSIC_COUNT_MAX, musicToolLimits, type AiToolId } from '@ixa/domain'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/form/field-error'
import { FIELD_CONTROL_CLASS, FIELD_HINT_CLASS, FIELD_LABEL_CLASS } from '@/components/form/field-styles'
import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { TextareaField } from '@/components/form/textarea-field'
import { useMusicJobs } from '@/components/workbench/music-jobs'
import { MusicJobProgress } from '@/components/workbench/ui/music-job-progress'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { ApiError, describeForPerson } from '@/lib/api-error'
import {
  DEFAULT_MUSIC_LIMITS,
  INITIAL_MUSIC_FORM,
  durationRangeText,
  plannedMusicTool,
  validateMusicForm,
  type MusicForm,
  type MusicFormErrors,
} from '@/lib/music-job-form'

const COUNT_OPTIONS = Array.from({ length: MUSIC_COUNT_MAX }, (_, index) => {
  const value = String(index + 1)
  return { value, label: `${value} 曲` }
})

/** 曲の AI が使えない（お試し・起動していない）。API の理由の文をそのまま見せる。 */
const CONFLICT_STATUS = 409

/**
 * 選んでいる曲の AI。窓を開くたびに読む。読めなければ null（歌える AI の範囲で欄を出し、API がもう一度確かめる）。
 */
const useMusicTool = (load: (() => Promise<AiToolId>) | null): AiToolId | null => {
  const [tool, setTool] = useState<AiToolId | null>(null)
  useEffect(() => {
    if (load === null) return
    let alive = true
    load()
      .then((loaded) => {
        if (alive) setTool(loaded)
      })
      .catch(() => {
        // 案内が出ないだけ。歌なしだけの AI に歌ありを頼めば、API が理由つきで断る。
      })
    return () => {
      alive = false
    }
  }, [load])
  return tool
}

/**
 * 曲を作る（ADR-0048）。曲調と歌詞から、手元の AI（「使う AI」の曲）で楽曲を作る。
 * 頼んだら進み具合はこの中と素材ツリーの楽曲に出る。閉じても作り続け、できたら上の知らせで言う。
 */
export const MakeMusicDialogBody = () => {
  const workbench = useWorkbench()
  const music = useMusicJobs()
  const [form, setForm] = useState<MusicForm>(INITIAL_MUSIC_FORM)
  const [errors, setErrors] = useState<MusicFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const tool = useMusicTool(music?.musicTool ?? null)
  // 歌なしだけの AI（既定の Stable Audio）でも歌ありにできる。そのときは歌える AI（ACE-Step）で作る。
  const planned = tool === null ? null : plannedMusicTool(tool, form.instrumental)
  const limits = planned === null ? DEFAULT_MUSIC_LIMITS : musicToolLimits(planned)
  const rerouted = tool !== null && planned !== null && planned !== tool

  // 歌なしだけの AI を選んでいれば、歌なしで始める（そのまま押せば選んだ AI で作る）。
  useEffect(() => {
    if (tool !== null && !musicToolLimits(tool).vocals) setForm((current) => ({ ...current, instrumental: true }))
  }, [tool])

  const change = (patch: Partial<MusicForm>): void => {
    setForm((current) => ({ ...current, ...patch }))
    setAccepted(false)
  }

  const submit = async (): Promise<void> => {
    if (music === null) return
    const result = validateMusicForm(form, limits)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setFormError(null)
    setSubmitting(true)
    try {
      await music.submit(result.body)
      setAccepted(true)
    } catch (cause) {
      const message = describeForPerson(cause)
      setFormError(`曲を作り始められませんでした: ${message}`)
      if (cause instanceof ApiError && cause.status === CONFLICT_STATUS) workbench.notify(message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      // 欄の確かめはここで日本語で出す（ブラウザの吹き出しに任せない）。
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-muted">
        曲調と歌詞から楽曲を作ります。使う AI はメニュー「使う AI…」の「曲」で選びます。できた曲は楽曲に足され、解析が始まります。
      </p>
      {tool !== null && (
        <div className="rounded-md border border-line bg-surface-2 p-2 text-xs text-text">
          <p>{`曲を作る AI: ${AI_TOOLS[tool].label}`}</p>
          {!musicToolLimits(tool).vocals && !rerouted && (
            <p className="text-muted">歌なしの BGM を作ります（曲調は英語で書くのがおすすめです）。</p>
          )}
          {rerouted && planned !== null && <p className="text-muted">{`歌ありは ${AI_TOOLS[planned].label} で作ります`}</p>}
        </div>
      )}
      <TextField
        id="make-music-prompt"
        label="曲調"
        value={form.prompt}
        placeholder="例: j-pop, upbeat, female vocal, 120 bpm"
        error={errors.prompt}
        onChange={(prompt) => {
          change({ prompt })
        }}
      />
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={form.instrumental}
          onChange={(event) => {
            change({ instrumental: event.target.checked })
          }}
        />
        歌なし（歌詞は使いません）
      </label>
      <TextareaField
        id="make-music-lyrics"
        label="歌詞（なくてもよい）"
        rows={6}
        value={form.lyrics}
        disabled={form.instrumental}
        placeholder={'[verse]\n1 番の歌詞\n[chorus]\nサビの歌詞'}
        error={errors.lyrics}
        onChange={(lyrics) => {
          change({ lyrics })
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="make-music-duration" className={FIELD_LABEL_CLASS}>
            長さ（秒）
          </label>
          <input
            id="make-music-duration"
            type="number"
            inputMode="decimal"
            min={limits.durationSec.min}
            max={limits.durationSec.max}
            step={1}
            value={form.durationSec}
            aria-invalid={errors.durationSec !== undefined}
            aria-describedby={errors.durationSec === undefined ? undefined : 'make-music-duration-error'}
            onChange={(event) => {
              change({ durationSec: event.target.value })
            }}
            className={`mt-1 ${FIELD_CONTROL_CLASS}`}
          />
          <p className={FIELD_HINT_CLASS}>{durationRangeText(limits)}</p>
          <FieldError id="make-music-duration-error" message={errors.durationSec} />
        </div>
        <SelectField
          id="make-music-count"
          label="何曲"
          value={form.count}
          options={COUNT_OPTIONS}
          error={errors.count}
          onChange={(count) => {
            change({ count })
          }}
        />
      </div>
      {formError !== null && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      {accepted && <p className="text-sm text-text">受け付けました。閉じても作り続けます。</p>}
      <MusicJobProgress />
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={workbench.closeDialog}>
          閉じる
        </Button>
        <Button size="sm" tone="primary" type="submit" disabled={submitting || music === null}>
          {submitting ? '頼んでいます…' : '曲を作る'}
        </Button>
      </div>
    </form>
  )
}
