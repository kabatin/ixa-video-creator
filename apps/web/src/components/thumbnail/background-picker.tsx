'use client'

import type { ProjectId, Shot, ThumbnailBackground } from '@ixa/domain'
import { useMemo, useState } from 'react'
import { KeyArtPicker } from '@/components/thumbnail/key-art-picker'
import { Button } from '@/components/ui/button'
import { ChoiceCard } from '@/components/ui/choice-card'
import { resolveApiBaseUrl } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { formatClock } from '@/lib/format-time'
import { usePlayheadSec } from '@/lib/playhead-sec'
import { createRequester } from '@/lib/requester'
import { createShotStartFrameApi } from '@/lib/shot-start-frame-api'
import type { ShotPosterMap } from '@/lib/shot-posters'
import type { ThumbnailApi } from '@/lib/thumbnail-api'
import { shotPictureChoices, type ShotPictureChoice } from '@/lib/thumbnail-form'

/**
 * サムネイルの背景を選ぶ（ADR-0051）。いまの位置のコマ・Shot の絵・AI に描かせた 1 枚の 3 つ。
 * 選んだ背景は親が持つ（ここは選び方だけ）。
 */

type Mode = 'frame' | 'shot' | 'ai'

const MODE_LABELS: Readonly<Record<Mode, string>> = {
  frame: 'いまの位置のコマ',
  shot: 'Shot の絵',
  ai: 'AI に描かせる',
}

const modeOf = (background: ThumbnailBackground | null): Mode =>
  background?.kind === 'image' ? 'shot' : 'frame'

export type BackgroundPickerProps = {
  readonly projectId: ProjectId
  readonly background: ThumbnailBackground | null
  readonly onChange: (background: ThumbnailBackground) => void
  readonly shots: readonly Shot[]
  readonly posters: ShotPosterMap
  readonly api: ThumbnailApi
}

/** 再生位置は毎コマ変わるので、読むのはこの小さな部品だけにする（`playhead-sec.ts`）。 */
const CurrentFrameChoice = ({ onPick }: { readonly onPick: (atSec: number) => void }) => {
  const playheadSec = usePlayheadSec()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-text">{`いまの位置 ${formatClock(playheadSec)}`}</p>
      <Button size="sm" onClick={() => onPick(playheadSec)}>
        このコマにする
      </Button>
    </div>
  )
}

const ShotChoices = ({
  choices,
  onPick,
}: {
  readonly choices: readonly ShotPictureChoice[]
  readonly onPick: (choice: ShotPictureChoice) => void
}) =>
  choices.length === 0 ? (
    <p className="text-sm text-muted">絵のある Shot がまだありません。</p>
  ) : (
    <ul className="relative grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
      {choices.map((choice) => (
        <li key={choice.shotId}>
          <button
            type="button"
            className="w-full rounded border border-line bg-surface p-1 text-left hover:bg-surface-2"
            onClick={() => onPick(choice)}
          >
            {choice.posterUrl === null ? (
              <div className="aspect-video w-full rounded bg-surface-2" />
            ) : (
              <img src={choice.posterUrl} alt={`${choice.code} の絵`} className="aspect-video w-full rounded object-cover" />
            )}
            <span className="mt-1 block truncate text-xs text-muted">
              {`${choice.code}（${choice.kind === 'take' ? '採用 Take' : '最初のフレーム'}）`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )

export const BackgroundPicker = ({ projectId, background, onChange, shots, posters, api }: BackgroundPickerProps) => {
  const [mode, setMode] = useState<Mode>(modeOf(background))
  const [problem, setProblem] = useState<string | null>(null)
  const choices = useMemo(() => shotPictureChoices(shots, posters), [shots, posters])
  const startFrames = useMemo(() => createShotStartFrameApi(createRequester(resolveApiBaseUrl())), [])

  const pickShot = (choice: ShotPictureChoice): void => {
    setProblem(null)
    if (choice.kind === 'take') {
      onChange({ kind: 'timeline_frame', atSec: choice.atSec })
      return
    }
    startFrames
      .getStartFrame(choice.shotId)
      .then((frame) => {
        if (frame.mediaAssetId === null) {
          setProblem(`${choice.code} の最初のフレームが見つかりませんでした。`)
          return
        }
        onChange({ kind: 'image', mediaAssetId: frame.mediaAssetId })
      })
      .catch((cause: unknown) => {
        setProblem(`${choice.code} の絵を読めませんでした: ${describeForPerson(cause)}`)
      })
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-semibold text-text">背景</legend>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(MODE_LABELS) as Mode[]).map((key) => (
          <ChoiceCard key={key} name="thumbnail-background" checked={mode === key} onSelect={() => setMode(key)} stacked>
            <span className="text-sm">{MODE_LABELS[key]}</span>
          </ChoiceCard>
        ))}
      </div>
      {mode === 'frame' && <CurrentFrameChoice onPick={(atSec) => onChange({ kind: 'timeline_frame', atSec })} />}
      {mode === 'shot' && <ShotChoices choices={choices} onPick={pickShot} />}
      {mode === 'ai' && (
        <KeyArtPicker
          projectId={projectId}
          api={api}
          selectedAssetId={background?.kind === 'image' ? background.mediaAssetId : null}
          onPick={(mediaAssetId) => onChange({ kind: 'image', mediaAssetId })}
        />
      )}
      {background?.kind === 'timeline_frame' && (
        <p className="text-xs text-muted">{`選んでいる背景: タイムラインの ${formatClock(background.atSec)} のコマ`}</p>
      )}
      {problem !== null && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </fieldset>
  )
}
