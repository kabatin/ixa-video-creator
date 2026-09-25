'use client'

import { useRouter } from 'next/navigation'

import type { MusicTrack, ProjectId, Sequence, Shot } from '@ixa/domain'
import { useState } from 'react'
import { SelectField } from '@/components/form/select-field'
import { TextField } from '@/components/form/text-field'
import { createApiClient } from '@/lib/api-client'
import { describeError } from '@/lib/api-error'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { formatClock, formatDuration } from '@/lib/format-time'
import {
  NO_SEQUENCE_VALUE,
  SUBDIVISION_OPTIONS,
  describeSection,
  initialStoryboardFormValues,
  validateStoryboardForm,
  type StoryboardFormErrors,
  type StoryboardFormValues,
} from '@/lib/storyboard-form'

/**
 * 音楽セクションを選んで Shot を一括で作る操作盤（P3-5）。
 *
 * 時間の割り方は API（さらにその先の `allocateShots`）が持つ。ここは選ばせて送るだけで、
 * **減らされたカット数の理由を必ず画面に出す**（ADR-0017）。
 */

export type StoryboardPanelProps = {
  readonly projectId: ProjectId
  readonly track: MusicTrack
  readonly analysis: WireMusicAnalysis
  readonly sequences: readonly Sequence[]
  /**
   * 割り終えたときに呼ぶ。吹き出しの中に置いたとき、閉じて結果を知らせるのに使う。
   * 渡さなければ結果はこの画面の中に出す。
   */
  readonly onCreated?: (summary: string) => void
}

type AllocateOutcome = {
  readonly createdCount: number
  readonly requestedCount: number
  readonly sectionLabel: string
  readonly warnings: readonly string[]
  readonly shots: readonly Shot[]
}

export const StoryboardPanel = ({
  projectId,
  track,
  analysis,
  sequences,
  onCreated,
}: StoryboardPanelProps) => {
  const router = useRouter()
  const [values, setValues] = useState<StoryboardFormValues>(() =>
    initialStoryboardFormValues(track.id),
  )
  const [errors, setErrors] = useState<StoryboardFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<AllocateOutcome | null>(null)

  const update = (field: keyof StoryboardFormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
  }

  const sectionOptions = analysis.sections.map((section, index) => ({
    value: String(index),
    label: describeSection(section),
  }))

  const sequenceOptions = [
    { value: NO_SEQUENCE_VALUE, label: '（Sequence に入れない）' },
    ...sequences.map((sequence) => ({ value: sequence.id, label: sequence.name })),
  ]

  const submit = async (): Promise<void> => {
    const validation = validateStoryboardForm(values, analysis.sections)
    if (!validation.ok) {
      setErrors(validation.errors)
      return
    }

    setErrors({})
    setSubmitting(true)
    try {
      const result = await createApiClient().allocateShots(projectId, validation.input)
      onCreated?.(
        `${result.section.label} を ${String(result.createdCount)} カットに割りました。` +
          (result.warnings.length > 0 ? ` 注意: ${result.warnings.join(' / ')}` : ''),
      )
      setOutcome({
        createdCount: result.createdCount,
        requestedCount: result.requestedCount,
        sectionLabel: result.section.label,
        warnings: result.warnings,
        shots: result.shots,
      })
      /**
       * **他の画面の先読み内容を捨てる。**
       * Next.js は `<Link>` が画面に入った時点で遷移先を先読みする。作る前に
       * 先読みされた内容が残っていると、作ったのに「ありません」と出る。
       */
      router.refresh()
    } catch (error) {
      // 失敗を握り潰すと「押したのに何も起きない」画面になる。必ず理由を出す。
      setErrors({ form: describeError(error) })
      setOutcome(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-base font-semibold text-text">セクションから Shot を割る</h2>
      <p className="mt-1 text-sm text-muted">
        {`BPM ${analysis.bpm.toFixed(1)} / ビート ${String(analysis.beats.length)} 個 / 解析器 ${analysis.analyzerVersion}`}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <SelectField
          id="sectionIndex"
          label="セクション"
          value={values.sectionIndex}
          options={sectionOptions}
          disabled={submitting}
          error={errors.sectionIndex}
          onChange={update('sectionIndex')}
        />
        <TextField
          id="requestedCount"
          label="カット数"
          value={values.requestedCount}
          disabled={submitting}
          error={errors.requestedCount}
          onChange={update('requestedCount')}
        />
        <SelectField
          id="subdivision"
          label="ビートの分解能"
          value={values.subdivision}
          options={[...SUBDIVISION_OPTIONS]}
          disabled={submitting}
          error={errors.subdivision}
          onChange={update('subdivision')}
        />
        <SelectField
          id="sequenceId"
          label="Sequence"
          value={values.sequenceId}
          options={sequenceOptions}
          disabled={submitting}
          error={errors.sequenceId}
          onChange={update('sequenceId')}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            void submit()
          }}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
        >
          {submitting ? '作成中…' : 'Shot を作成'}
        </button>
        {errors.form !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        )}
      </div>

      {outcome !== null && (
        <div className="mt-5 rounded-md border border-line bg-surface-2 p-4">
          <p role="status" className="text-sm text-text">
            {`${outcome.sectionLabel} を ${String(outcome.createdCount)} カットに割りました`}
          </p>

          {outcome.warnings.length > 0 && (
            <ul role="alert" className="mt-2 list-disc space-y-1 pl-5 text-sm text-warn">
              {outcome.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <ul className="mt-3 space-y-1 text-sm text-text">
            {outcome.shots.map((shot) => (
              <li key={shot.id}>
                {`${shot.code} ${formatClock(shot.startSec)} から ${formatDuration(shot.durationSec)}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
