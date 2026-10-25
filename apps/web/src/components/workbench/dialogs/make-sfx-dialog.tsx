'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { MotionWave } from '@/components/workbench/ui/motion-wave'
import { SfxCueRowFields } from '@/components/workbench/ui/sfx-cue-row-fields'
import { useShotMotion } from '@/components/workbench/use-shot-motion'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import type { WireShotMotion } from '@/lib/motion-api'
import { blankCueRow, cueRowsFromSuggestions, validateCueRows, type SfxCueRow } from '@/lib/sfx-cue-rows'

const PROGRESS: Readonly<Record<WireShotMotion['state'], string>> = {
  none: '',
  queued: '動きの分析の順番を待っています…',
  running: '動きを分析しています（AI がコマを見ています。数十秒かかります）…',
  succeeded: '',
  failed: '',
}

/**
 * 効果音を作る（ADR-0054）。Shot の採用中の Take の動きを分析し（まだなら開いたときに頼む）、
 * 動きの強さの波と出来事の印、提案する効果音の一覧を出す。直した行のうちチェックしたものを作る。
 * 使う AI はメニュー「使う AI…」の効果音。本数は 1。できた音は効果音の段に置かれる。
 *
 * `initialRows` は最初に入れておく行（プロンプトビューアの「これを元に作る」）。渡したら案では上書きせず、
 * Shot を選んでいなくても開ける（動きの分析は Shot があるときだけ出す）。
 */
export const MakeSfxDialogBody = ({ initialRows }: { readonly initialRows?: readonly SfxCueRow[] } = {}) => {
  const workbench = useWorkbench()
  const client = useMemo(() => createApiClient(), [])
  // 前の音を元に作るときは Shot に結び付けない（動きの分析を頼まない。分析は AI で絵を見るので費用が掛かることがある）。
  const reusing = initialRows !== undefined
  const shotId = reusing ? null : (workbench.dialogShotIds?.[0] ?? workbench.selectedShotId)
  const shot = shotId === null ? null : (workbench.shots?.find((candidate) => candidate.id === shotId) ?? null)
  const load = useShotMotion(shot?.id ?? null)
  const [rows, setRows] = useState<readonly SfxCueRow[] | null>(initialRows ?? null)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [accepted, setAccepted] = useState<number | null>(null)

  const motion = load.state === 'ready' ? load.motion : null
  // 案は分析が終わったときに 1 度だけ行にする（人が直した行を読み直しで消さない）。
  useEffect(() => {
    if (rows === null && motion !== null && (motion.state === 'succeeded' || motion.state === 'failed')) {
      setRows(cueRowsFromSuggestions(motion.suggestions))
    }
  }, [motion, rows])

  if (shot === null && !reusing) {
    return <p className="text-sm text-muted">効果音を作る Shot を選んでから開いてください。</p>
  }

  const change = (id: string, patch: Partial<SfxCueRow>): void => {
    setRows((current) => (current ?? []).map((row) => (row.id === id ? { ...row, ...patch } : row)))
    setAccepted(null)
  }

  const submit = async (): Promise<void> => {
    const result = validateCueRows(rows ?? [])
    if (!result.ok) {
      setErrors(result.errors)
      setFormError(result.message)
      return
    }
    setErrors({})
    setFormError(null)
    setSubmitting(true)
    try {
      const jobIds = await client.generateSfx(workbench.projectId, result.cues)
      setAccepted(jobIds.length)
      const what = shot === null ? '効果音' : `${shot.code} の効果音`
      workbench.notify(`${what}を ${String(jobIds.length)} 個作り始めました。できたら効果音の段に置かれます。`)
    } catch (cause) {
      setFormError(`効果音を作り始められませんでした: ${describeForPerson(cause)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const seek = (sec: number): void => {
    workbench.transportControls.seekTo(sec)
    workbench.transportControls.play('monitor')
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm text-muted">
        {shot === null
          ? '前に作った効果音のきっかけを入れてあります。時刻・長さ・指示（英語）・音量を直して、チェックした行を作ります。使う AI はメニュー「使う AI…」の「効果音」です。'
          : `${shot.code} の採用中の Take の動きから、効果音の案を出します。時刻・長さ・指示（英語）・音量を直して、チェックした行を作ります。使う AI はメニュー「使う AI…」の「効果音」です。`}
      </p>
      {!reusing && load.state === 'loading' && <p className="text-sm text-muted">読み込んでいます…</p>}
      {!reusing && load.state === 'error' && (
        <p role="alert" className="text-sm text-danger">
          {load.message}
        </p>
      )}
      {motion !== null && motion.takeId === null && (
        <p className="text-sm text-muted">この Shot には採用中の Take がありません。行を足して手で作れます。</p>
      )}
      {motion !== null && PROGRESS[motion.state] !== '' && (
        <p role="status" className="text-sm text-text">
          {PROGRESS[motion.state]}
        </p>
      )}
      {motion !== null && motion.failureMessage !== null && (
        <p role="alert" className="text-sm text-danger">
          {motion.failureMessage}
        </p>
      )}
      {motion?.visionUsed === false && (
        <p className="text-sm text-warn">AI で中身を見ていません（「使う AI」の文章が Claude ではないため）。動きの山だけから出した案です。</p>
      )}
      {shot !== null && motion !== null && motion.energy !== null && <MotionWave range={shot} motion={motion} onSeek={seek} />}
      {rows !== null && (
        <ul className="relative max-h-80 space-y-2 overflow-y-auto" aria-label="提案する効果音">
          {rows.map((row) => (
            <SfxCueRowFields
              key={row.id}
              row={row}
              error={errors[row.id]}
              onChange={(patch) => {
                change(row.id, patch)
              }}
              onRemove={() => {
                setRows((current) => (current ?? []).filter((candidate) => candidate.id !== row.id))
              }}
            />
          ))}
        </ul>
      )}
      <Button
        size="sm"
        onClick={() => {
          setRows((current) => [...(current ?? []), blankCueRow(workbench.transportControls.getTransport().currentSec)])
        }}
      >
        行を足す（再生位置）
      </Button>
      {formError !== null && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      {accepted !== null && (
        <p className="text-sm text-text">{`${String(accepted)} 個を受け付けました。閉じても作り続けます。`}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={workbench.closeDialog}>
          閉じる
        </Button>
        <Button size="sm" tone="primary" type="submit" disabled={submitting || rows === null}>
          {submitting ? '頼んでいます…' : 'チェックした効果音を作る'}
        </Button>
      </div>
    </form>
  )
}
