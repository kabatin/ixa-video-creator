'use client'

import { MediaAssetId, VoiceJobId, type VoiceProfileId } from '@ixa/domain'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'

const PREVIEW_TEXT = 'こんにちは。これは試しに読む声です。'

type Preview =
  | { readonly state: 'idle' }
  | { readonly state: 'waiting'; readonly jobId: VoiceJobId }
  | { readonly state: 'ready'; readonly url: string }
  | { readonly state: 'error'; readonly message: string }

/** 好きな一文で試聴する。できたかは声のジョブの出来事（narrationEpoch）で確かめ直す。 */
export const VoicePreview = ({ voiceId }: { readonly voiceId: VoiceProfileId }) => {
  const api = useMemo(() => createApiClient(), [])
  const { narrationEpoch } = useWorkbench()
  const [text, setText] = useState(PREVIEW_TEXT)
  const [preview, setPreview] = useState<Preview>({ state: 'idle' })
  const waitingFor = preview.state === 'waiting' ? preview.jobId : null

  useEffect(() => {
    if (waitingFor === null) return undefined
    let cancelled = false
    const check = async (): Promise<void> => {
      const job = await api.getVoiceJob(waitingFor)
      if (cancelled) return
      if (job.status === 'failed' || job.status === 'cancelled') {
        setPreview({ state: 'error', message: job.error ?? '試しに読めませんでした' })
        return
      }
      if (job.status !== 'succeeded' || job.resultMediaAssetId === null) return
      const signed = await api.mediaUrl(MediaAssetId.parse(job.resultMediaAssetId))
      if (!cancelled) setPreview({ state: 'ready', url: signed.url })
    }
    check().catch((cause: unknown) => {
      if (!cancelled) setPreview({ state: 'error', message: describeForPerson(cause) })
    })
    return () => {
      cancelled = true
    }
  }, [api, waitingFor, narrationEpoch])

  const start = (): void => {
    setPreview({ state: 'idle' })
    api
      .previewVoice(voiceId, text)
      .then(({ jobId }) => {
        setPreview({ state: 'waiting', jobId: VoiceJobId.parse(jobId) })
      })
      .catch((cause: unknown) => {
        setPreview({ state: 'error', message: describeForPerson(cause) })
      })
  }

  return (
    <div className="space-y-2">
      <textarea
        aria-label="試しに読む文"
        value={text}
        maxLength={200}
        rows={2}
        onChange={(event) => {
          setText(event.target.value)
        }}
        className="w-full rounded border border-line-strong bg-bg px-2 py-1 text-sm text-text"
      />
      <Button size="sm" disabled={text.trim() === '' || preview.state === 'waiting'} onClick={start}>
        {preview.state === 'waiting' ? '作っています…' : '試しに読む'}
      </Button>
      {preview.state === 'error' && (
        <p role="alert" className="text-xs text-danger">
          試しに読めませんでした: {preview.message}
        </p>
      )}
      {preview.state === 'ready' && (
        // 試聴の音。読ませた文は上の欄に出ている。
        <audio controls autoPlay src={preview.url} className="w-full" aria-label="試しに読んだ声" />
      )}
    </div>
  )
}
