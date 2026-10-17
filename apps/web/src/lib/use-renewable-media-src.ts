'use client'

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { describeError } from '@/lib/api-error'
import { clampSec, isRecoverableMediaError } from '@/lib/playback-state'
import { mayRenewAfterError } from '@/lib/signed-url-renewal'

/**
 * `<video>` / `<audio>` の署名付き URL を、**読めなくなったときに取り直して同じ位置から続ける**。
 *
 * 以前は 2 通りの壊れ方があった。
 * - 取り直さない（書き出しの再生・声の試聴）: 5 分を過ぎてからのシークで、ブラウザが期限切れの URL へ
 *   範囲リクエストを投げ、再生が黙って止まる
 * - 時刻で `src` を差し替える（Take のカード）: 4 分ごとに、見ている途中の動画が頭へ戻る
 *
 * **時刻では差し替えない。** 読めなかったときにだけ取り直し、位置と再生中だったかを戻す
 * （`use-audio-playback.ts` と同じ考え方）。取ったばかりの URL で読めないなら素材そのものが無いので、
 * 取り直さずに理由を出す（`mayRenewAfterError`）。
 */

type ResumePoint = { readonly sec: number; readonly wasPlaying: boolean }

type MediaEvent = SyntheticEvent<HTMLMediaElement>

/** 要素に広げる分。`src` も含む。 */
export type RenewableMediaProps = {
  readonly src: string
  readonly onError: (event: MediaEvent) => void
  readonly onLoadedMetadata: (event: MediaEvent) => void
  readonly onPlay: () => void
  readonly onPause: (event: MediaEvent) => void
}

export type RenewableMediaSrc = {
  /** URL がまだ無ければ null。 */
  readonly mediaProps: RenewableMediaProps | null
  /** 直せなかった失敗。`role="alert"` で出す。 */
  readonly error: string | null
}

export type RenewableMediaOptions = {
  /** 最初に取れた URL。**変わったら位置を引き継がずに差し替える**（別の素材になったため）。 */
  readonly url: string | null
  /** 新しい URL を取りにいく。期限切れで読めなくなったときだけ呼ばれる。 */
  readonly reload: () => Promise<string>
  /** 何を読めなかったかを言う語（「動画」「声」）。 */
  readonly label: string
}

const resumePlayback = (element: HTMLMediaElement, onFail: (message: string) => void): void => {
  try {
    // 自動再生を止められた場合は拒否された Promise で返る。握り潰さずに理由を出す。
    void Promise.resolve(element.play()).catch((caught: unknown) => {
      onFail(describeError(caught))
    })
  } catch (caught) {
    // jsdom のように `play` を実装していない環境は同期で投げる。
    onFail(describeError(caught))
  }
}

export const useRenewableMediaSrc = ({ url, reload, label }: RenewableMediaOptions): RenewableMediaSrc => {
  const [current, setCurrent] = useState<string | null>(url)
  const [error, setError] = useState<string | null>(null)
  /** いまの URL を取れた時刻。取り直している間は null。 */
  const obtainedAtRef = useRef<number | null>(url === null ? null : Date.now())
  const resumeRef = useRef<ResumePoint | null>(null)
  const wasPlayingRef = useRef(false)
  const reloadRef = useRef(reload)
  const mountedRef = useRef(true)

  useEffect(() => {
    reloadRef.current = reload
  }, [reload])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 呼び出し側が別の URL を渡したら、位置を引き継がずに初めから。
  useEffect(() => {
    setCurrent(url)
    setError(null)
    resumeRef.current = null
    obtainedAtRef.current = url === null ? null : Date.now()
  }, [url])

  const onError = useCallback(
    (event: MediaEvent): void => {
      const element = event.currentTarget
      const code = element.error?.code ?? null
      if (!isRecoverableMediaError(code) || !mayRenewAfterError(obtainedAtRef.current, Date.now())) {
        // 取り直している最中に来た続きの失敗は、取り直しの結果を待つ。
        if (obtainedAtRef.current !== null) setError(`${label}を読み込めませんでした。`)
        return
      }
      obtainedAtRef.current = null
      resumeRef.current = { sec: element.currentTime, wasPlaying: wasPlayingRef.current }
      reloadRef
        .current()
        .then((next) => {
          if (!mountedRef.current) return
          obtainedAtRef.current = Date.now()
          setError(null)
          setCurrent(next)
        })
        .catch((caught: unknown) => {
          if (!mountedRef.current) return
          obtainedAtRef.current = Date.now()
          resumeRef.current = null
          setError(`${label}の一時 URL を取り直せませんでした: ${describeError(caught)}`)
        })
    },
    [label],
  )

  const onLoadedMetadata = useCallback((event: MediaEvent): void => {
    const resume = resumeRef.current
    if (resume === null) return
    resumeRef.current = null
    const element = event.currentTarget
    element.currentTime = clampSec(resume.sec, element.duration)
    if (resume.wasPlaying) {
      resumePlayback(element, (message) => {
        setError(`${label}を続きから再生できませんでした: ${message}`)
      })
      return
    }
    // `autoPlay` の要素でも、止めていたものは止めたまま戻す（差し替えで勝手に鳴り出さない）。
    element.pause()
  }, [label])

  const onPlay = useCallback((): void => {
    wasPlayingRef.current = true
  }, [])

  const onPause = useCallback((event: MediaEvent): void => {
    // 失敗して止まったときは「鳴らしていた」を消さない。ブラウザによっては `error` より先に `pause` が来る。
    if (event.currentTarget.error === null) wasPlayingRef.current = false
  }, [])

  return {
    mediaProps:
      current === null ? null : { src: current, onError, onLoadedMetadata, onPlay, onPause },
    error,
  }
}
