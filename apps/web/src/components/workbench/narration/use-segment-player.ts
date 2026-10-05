'use client'

import type { MediaAssetId } from '@ixa/domain'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'

/** 鳴らす区間。録音は 1 つのファイルの区間を行ごとに指すので、頭と終わりで止める。 */
export type Segment = { readonly key: string; readonly mediaAssetId: MediaAssetId; readonly inSec: number; readonly outSec: number }

/**
 * 声の Take を 1 つだけ鳴らす。鳴らすときはプレビューを止める（同時に 2 つ鳴らさない）。
 * 署名付き URL は鳴らすたびに取る（切れた URL を持ち続けない）。
 */
export const useSegmentPlayer = () => {
  const { transportControls } = useWorkbench()
  const api = useMemo(() => createApiClient(), [])
  const audio = useRef<HTMLAudioElement | null>(null)
  const stopAt = useRef<number>(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => () => {
      audio.current?.pause()
    },
    [],
  )

  const stop = useCallback((): void => {
    audio.current?.pause()
    setPlaying(null)
  }, [])

  const play = useCallback(
    (segment: Segment): void => {
      setError(null)
      transportControls.pause()
      const element = audio.current ?? new Audio()
      if (audio.current === null) {
        audio.current = element
        element.addEventListener('timeupdate', () => {
          if (element.currentTime >= stopAt.current) {
            element.pause()
            setPlaying(null)
          }
        })
        element.addEventListener('ended', () => {
          setPlaying(null)
        })
      }
      api
        .mediaUrl(segment.mediaAssetId)
        .then(async (signed) => {
          element.src = signed.url
          element.currentTime = segment.inSec
          stopAt.current = segment.outSec
          setPlaying(segment.key)
          await element.play()
        })
        .catch((cause: unknown) => {
          setPlaying(null)
          setError(`声を鳴らせませんでした: ${describeForPerson(cause)}`)
        })
    },
    [api, transportControls],
  )

  return { play, stop, playing, error }
}
