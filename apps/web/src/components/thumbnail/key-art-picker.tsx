'use client'

import {
  KEY_ART_INSTRUCTION_MAX_LENGTH,
  KEY_ART_MAX_COUNT,
  type ImageGenerationJobId,
  type MediaAssetId,
} from '@ixa/domain'
import { useState } from 'react'
import { MediaImage } from '@/components/media-image'
import { Button } from '@/components/ui/button'
import type { KeyArtJobs } from '@/components/thumbnail/use-key-art-jobs'
import type { WireKeyArtJob } from '@/lib/thumbnail-api'

/**
 * 背景を AI に描かせる（キーアート。ADR-0051）。頼んだ分ができるまで一覧を引き直し、できたものから並べる。
 * 前に描かせた絵も候補に出す（描き直さずに選べる）。1 枚 1 分ほどかかる。
 * 追いかけはダイアログの側（`useKeyArtJobs`）が持つ。タブを替えても消えない。
 */

export type KeyArtPickerProps = {
  readonly keyArt: KeyArtJobs
  readonly selectedAssetId: MediaAssetId | null
  readonly onPick: (mediaAssetId: MediaAssetId) => void
}

type Candidate = { readonly jobId: ImageGenerationJobId; readonly mediaAssetId: MediaAssetId }

const candidatesOf = (jobs: readonly WireKeyArtJob[]): readonly Candidate[] =>
  jobs.flatMap((job) =>
    job.status === 'succeeded' && job.mediaAssetId !== null ? [{ jobId: job.id, mediaAssetId: job.mediaAssetId }] : [],
  )

export const KeyArtPicker = ({ keyArt, selectedAssetId, onPick }: KeyArtPickerProps) => {
  const [instruction, setInstruction] = useState('')
  const [count, setCount] = useState(2)
  const { jobs, requested, drawing, submitting, canGenerate, note } = keyArt

  const mine = jobs.filter((job) => requested.includes(job.id))
  const failures = mine.flatMap((job) => (job.status === 'failed' && job.error !== null ? [job.error] : []))
  const candidates = candidatesOf(jobs)

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-text">
        指示（なくても描けます）
        <textarea
          className="min-h-20 rounded border border-line bg-surface p-2 text-sm"
          value={instruction}
          maxLength={KEY_ART_INSTRUCTION_MAX_LENGTH}
          placeholder="例: 夕焼けの屋上で 3 人が振り向く"
          onChange={(event) => setInstruction(event.target.value)}
        />
        <span className="text-xs text-muted">{`${String([...instruction].length)} / ${String(KEY_ART_INSTRUCTION_MAX_LENGTH)} 字`}</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-text">
          何枚
          <select
            className="rounded border border-line bg-surface px-2 py-1 text-sm"
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {Array.from({ length: KEY_ART_MAX_COUNT }, (_unused, index) => index + 1).map((n) => (
              <option key={n} value={n}>{`${String(n)} 枚`}</option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          tone="primary"
          disabled={!canGenerate}
          onClick={() => void keyArt.generate({ count, instruction })}
        >
          {submitting ? '送信中…' : '描かせる'}
        </Button>
      </div>
      {drawing > 0 && (
        <p role="status" className="text-xs text-muted">{`${String(drawing)} 枚を描いています。1 枚 1 分ほどかかります。`}</p>
      )}
      {failures.map((message, index) => (
        <p key={`${String(index)}:${message}`} role="alert" className="text-xs text-danger">
          {`描けませんでした: ${message}`}
        </p>
      ))}
      {note !== null && (
        <p role="alert" className="text-xs text-warn">
          {note}
        </p>
      )}
      {candidates.length > 0 && (
        <ul className="relative grid max-h-64 grid-cols-2 gap-2 overflow-y-auto" aria-label="AI が描いた絵">
          {candidates.map((candidate, index) => (
            <li key={candidate.jobId}>
              <button
                type="button"
                aria-pressed={candidate.mediaAssetId === selectedAssetId}
                className={`w-full rounded border p-1 ${
                  candidate.mediaAssetId === selectedAssetId ? 'border-accent' : 'border-line hover:bg-surface-2'
                }`}
                onClick={() => onPick(candidate.mediaAssetId)}
              >
                <MediaImage
                  mediaAssetId={candidate.mediaAssetId}
                  alt={`AI が描いた絵 ${String(index + 1)}`}
                  className="aspect-video w-full rounded object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
