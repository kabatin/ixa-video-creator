'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMusicJobs } from '@/components/workbench/music-jobs'
import { describeForPerson } from '@/lib/api-error'
import { activeMusicJobs, describeMusicJob } from '@/lib/music-job-form'

/**
 * 曲を作っている間の進み具合と「止める」（ADR-0048）。作っていなければ何も出さない。
 * 読めなかったときは黙らない（「作っていない」に化けさせない。L-015）。
 */
export const MusicJobProgress = () => {
  const music = useMusicJobs()
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (music === null) return null
  if (music.jobs.state === 'error') {
    return (
      <p role="alert" className="px-1 text-xs text-danger">
        {music.jobs.message}
      </p>
    )
  }
  const active = music.jobs.state === 'ready' ? activeMusicJobs(music.jobs.value) : []
  if (active.length === 0) return null

  const stop = (): void => {
    setStopping(true)
    setError(null)
    music
      .cancel()
      .catch((cause: unknown) => {
        setError(`止められませんでした: ${describeForPerson(cause)}`)
      })
      .finally(() => {
        setStopping(false)
      })
  }

  return (
    <div role="status" className="space-y-1 px-1 text-xs text-muted">
      {active.map((job) => (
        <p key={job.id}>{describeMusicJob(job)}</p>
      ))}
      <Button size="sm" disabled={stopping} onClick={stop}>
        {stopping ? '止めています…' : '止める'}
      </Button>
      {error !== null && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
