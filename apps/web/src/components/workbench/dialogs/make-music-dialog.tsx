'use client'

import { MUSIC_COUNT_MAX, MUSIC_DURATION_MAX_SEC, MUSIC_DURATION_MIN_SEC } from '@ixa/domain'
import { useState } from 'react'
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
  INITIAL_MUSIC_FORM,
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

  const change = (patch: Partial<MusicForm>): void => {
    setForm((current) => ({ ...current, ...patch }))
    setAccepted(false)
  }

  const submit = async (): Promise<void> => {
    if (music === null) return
    const result = validateMusicForm(form)
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
      if (cause instanceof ApiError && cause.status === CONFLICT_STATUS) workbench.notify(message)
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
            min={MUSIC_DURATION_MIN_SEC}
            max={MUSIC_DURATION_MAX_SEC}
            step={1}
            value={form.durationSec}
            aria-invalid={errors.durationSec !== undefined}
            aria-describedby={errors.durationSec === undefined ? undefined : 'make-music-duration-error'}
            onChange={(event) => {
              change({ durationSec: event.target.value })
            }}
            className={`mt-1 ${FIELD_CONTROL_CLASS}`}
          />
          <p className={FIELD_HINT_CLASS}>{`${String(MUSIC_DURATION_MIN_SEC)}〜${String(MUSIC_DURATION_MAX_SEC)} 秒`}</p>
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
