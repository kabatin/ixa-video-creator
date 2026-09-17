'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from '@/lib/api-error'
import {
  clampSec,
  clampVolume,
  isRecoverableMediaError,
  mediaErrorMessage,
  refreshDelayMs,
  resolveSeekTarget,
  shouldCommitPosition,
  URL_EXPIRED_NOTICE,
  URL_REFRESHING_NOTICE,
  type SignedSource,
} from '@/lib/playback-state'
import {
  DEFAULT_VOLUME_PREFERENCE,
  readVolumePreference,
  writeVolumePreference,
  type VolumePreference,
} from '@/lib/volume-preference'

/**
 * 音源を鳴らし、いまどこを鳴らしているかを伝えるフック。
 *
 * **`<audio>` 要素を自分で持つ。** Web Audio API は波形の解析には要るが、
 * 「鳴らす・止める・飛ぶ」だけなら要素で足りる。要素なら読み込みも
 * ネットワークの切断もブラウザが面倒を見る。
 *
 * **再生位置は `timeupdate` では取らない。** あの行事は毎秒 4 回ほどしか
 * 起きず、波形の上を印が飛び飛びに動く。鳴っている間だけ
 * `requestAnimationFrame` で `currentTime` を読む。
 * **止まっている間は回さない。** 見えないところで電池を食うため。
 */

/** 取り直す手立てが無いまま期限が切れたときの文面。 */
export const URL_EXPIRED_MESSAGE = '再生用の URL の期限が切れました。画面を再読み込みしてください。'

export type UseAudioPlaybackOptions = {
  /**
   * 署名付き URL と、その有効期間。未取得なら `null`。
   *
   * **取りに行くときは期限を明示すること**（`AUDIO_URL_EXPIRES_IN_SEC`）。
   * API の既定は 300 秒で、聴きながら切る作業はそれより長い。
   * ここで受け取った `expiresInSec` が取り直しの時刻を決める。
   */
  readonly source: SignedSource | null
  /**
   * URL を取り直す。期限が近づいたときと、期限切れで再生が壊れたときに呼ばれる。
   * **渡さないと期限切れから復帰できない。** その場合は再読み込みを促す文面を出す。
   */
  readonly onRefreshSource?: () => Promise<SignedSource>
}

export type AudioPlayback = {
  readonly isPlaying: boolean
  /** いま鳴っている秒。float。 */
  readonly currentSec: number
  /** 全体の尺。メタデータが読めるまでは 0。 */
  readonly durationSec: number
  readonly isLoading: boolean
  /** 直せない失敗。`role="alert"` で出す。 */
  readonly error: string | null
  /**
   * いま自分で直しているところ。`role="status"` で出す。
   *
   * **黙って直さない。** 期限切れからの復帰は数百ミリ秒で終わるが、その間
   * 音は途切れる。理由を出さないと「たまに引っかかる画面」として記憶される。
   */
  readonly notice: string | null
  readonly play: () => void
  readonly pause: () => void
  readonly toggle: () => void
  /** 指定の秒へ飛ぶ。範囲外は端に収める。 */
  readonly seekTo: (sec: number) => void
  /** 現在位置から相対で動かす。負なら戻る。 */
  readonly nudge: (deltaSec: number) => void
  /** 0〜1。**消音とは別物。** 消音を解除したときに戻る大きさ。 */
  readonly volume: number
  readonly muted: boolean
  /** 範囲外は丸める。要素は範囲外で例外を投げるため。 */
  readonly setVolume: (value: number) => void
  readonly toggleMute: () => void
}

/** 1 つの URL につき自動復帰は 1 回まで。403 を無限に叩き直さない。 */
const MAX_RECOVERY_PER_SOURCE = 1

type ResumePoint = { readonly sec: number; readonly wasPlaying: boolean }

const startPlayback = (audio: HTMLAudioElement, onFail: (message: string) => void): void => {
  try {
    // 自動再生を止められた場合は拒否された Promise で返る。握り潰すと
    // 「押したのに鳴らない」だけが残り、理由がどこにも出ない。
    void Promise.resolve(audio.play()).catch((caught: unknown) => {
      onFail(describeError(caught))
    })
  } catch (caught) {
    // jsdom のように `play` を実装していない環境は同期で投げる。
    onFail(describeError(caught))
  }
}

const finiteDuration = (audio: HTMLAudioElement): number =>
  Number.isFinite(audio.duration) ? audio.duration : 0

export const useAudioPlayback = ({
  source,
  onRefreshSource,
}: UseAudioPlaybackOptions): AudioPlayback => {
  const [active, setActive] = useState<SignedSource | null>(source)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSec, setCurrentSec] = useState(0)
  const [durationSec, setDurationSec] = useState(0)
  const [isLoading, setIsLoading] = useState(source !== null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /**
   * 音量。**最初の描画では覚え書きを読まない。**
   *
   * この画面はサーバでも描かれる。サーバに `localStorage` は無いので既定になり、
   * 最初の描画で覚え書きを読むと**サーバの結果と食い違って**React が
   * 木を作り直す（実際に「消音」と「消音を解除」で不一致になった）。
   * 読むのは描画のあと、下の効果で行う。
   */
  const [preference, setPreference] = useState<VolumePreference>(DEFAULT_VOLUME_PREFERENCE)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const resumeRef = useRef<ResumePoint | null>(null)
  const recoveriesRef = useRef(0)
  const wasPlayingRef = useRef(false)
  const propUrlRef = useRef<string | null>(source?.url ?? null)
  const refreshRef = useRef<(() => Promise<SignedSource>) | undefined>(onRefreshSource)
  /**
   * 要素を作り直したときに音量を入れ直すための控え。
   * **state を直接読むと作成の効果に依存が増え、音量を変えるたびに要素が作り直される。**
   */
  const preferenceRef = useRef<VolumePreference>(preference)

  useEffect(() => {
    refreshRef.current = onRefreshSource
  }, [onRefreshSource])

  const stopTicking = useCallback((): void => {
    if (rafRef.current === null) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const startTicking = useCallback((): void => {
    if (rafRef.current !== null) return
    const tick = (): void => {
      const audio = audioRef.current
      if (!audio || audio.paused) {
        rafRef.current = null
        return
      }
      const next = audio.currentTime
      setCurrentSec((prev) => (shouldCommitPosition(prev, next) ? next : prev))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  /**
   * URL を取り直す。取り直した先で位置と再生状態を復元するため、
   * いまどこを鳴らしていたかを先に控える。
   *
   * **取り直していることを必ず画面に出す。** 黙って直すと、音が一瞬途切れた理由が
   * どこにも残らない。直せなかったときはさらに `error` へ上げる。
   */
  const refresh = useCallback(async (reason: 'expiring' | 'failed'): Promise<void> => {
    const load = refreshRef.current
    const audio = audioRef.current
    if (!load) {
      if (reason === 'failed') setError(URL_EXPIRED_MESSAGE)
      return
    }
    setNotice(reason === 'failed' ? URL_EXPIRED_NOTICE : URL_REFRESHING_NOTICE)
    resumeRef.current = {
      sec: audio?.currentTime ?? 0,
      // 失敗して止まった直後は `paused` が true になっているため、控えた値を使う。
      wasPlaying: reason === 'failed' ? wasPlayingRef.current : !(audio?.paused ?? true),
    }
    try {
      const next = await load()
      setError(null)
      setActive(next)
    } catch (caught) {
      setNotice(null)
      setError(`音源の一時 URL を取り直せませんでした: ${describeError(caught)}`)
    }
  }, [])

  // --- 要素の生成と行事の購読。画面を離れたら必ず止める。 ---
  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'metadata'
    // **作り直しても音量が戻らないようにする。** この効果は音量に依存しないので、
    // state ではなく控えから入れる。
    audio.volume = clampVolume(preferenceRef.current.volume)
    audio.muted = preferenceRef.current.muted
    audioRef.current = audio

    const onLoadedMetadata = (): void => {
      setDurationSec(finiteDuration(audio))
      setIsLoading(false)
      const resume = resumeRef.current
      resumeRef.current = null
      if (!resume) return
      audio.currentTime = clampSec(resume.sec, finiteDuration(audio))
      setCurrentSec(audio.currentTime)
      if (resume.wasPlaying) startPlayback(audio, setError)
    }
    const onDurationChange = (): void => {
      setDurationSec(finiteDuration(audio))
    }
    const onCanPlay = (): void => {
      setIsLoading(false)
      // 鳴らせるところまで戻った。取り直しの断りはここで消す。
      setNotice(null)
      recoveriesRef.current = 0
    }
    const onWaiting = (): void => {
      setIsLoading(true)
    }
    const onPlay = (): void => {
      wasPlayingRef.current = true
      setIsPlaying(true)
      startTicking()
    }
    const onPause = (): void => {
      // 失敗して止まった場合は「鳴らしていた」という事実を消さない。
      // ブラウザによっては `error` より先に `pause` が来るため、
      // ここで消すと取り直したあとに再生が再開されない。
      if (audio.error === null) wasPlayingRef.current = false
      setIsPlaying(false)
      stopTicking()
      setCurrentSec(audio.currentTime)
    }
    const onEnded = (): void => {
      wasPlayingRef.current = false
      setIsPlaying(false)
      stopTicking()
      setCurrentSec(finiteDuration(audio))
    }
    /** 鳴っていない間の位置合わせ。滑らかさは `requestAnimationFrame` が受け持つ。 */
    const onTimeUpdate = (): void => {
      if (!audio.paused) return
      setCurrentSec(audio.currentTime)
    }
    const onSeeked = (): void => {
      setCurrentSec(audio.currentTime)
    }
    const onError = (): void => {
      const code = audio.error?.code ?? null
      stopTicking()
      setIsPlaying(false)
      setIsLoading(false)
      if (isRecoverableMediaError(code) && recoveriesRef.current < MAX_RECOVERY_PER_SOURCE) {
        recoveriesRef.current += 1
        void refresh('failed')
        return
      }
      setError(mediaErrorMessage(code))
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('seeked', onSeeked)
    audio.addEventListener('error', onError)

    return () => {
      stopTicking()
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('seeked', onSeeked)
      audio.removeEventListener('error', onError)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
      wasPlayingRef.current = false
    }
  }, [refresh, startTicking, stopTicking])

  // --- 呼び出し側が別の音源を渡したら、位置を引き継がずに初めから。 ---
  useEffect(() => {
    const nextUrl = source?.url ?? null
    if (nextUrl === propUrlRef.current) return
    propUrlRef.current = nextUrl
    resumeRef.current = null
    recoveriesRef.current = 0
    setCurrentSec(0)
    setDurationSec(0)
    setNotice(null)
    setActive(source)
  }, [source])

  // --- URL を要素へ流し込む。取り直した URL もここを通る。 ---
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!active) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(null)
    audio.src = active.url
    audio.load()
  }, [active])

  // --- 期限が切れる前に取り直す。切れてから慌てると音が途切れる。 ---
  useEffect(() => {
    if (!active || !onRefreshSource) return
    const timer = setTimeout(() => {
      void refresh('expiring')
    }, refreshDelayMs(active.expiresInSec))
    return () => {
      clearTimeout(timer)
    }
  }, [active, onRefreshSource, refresh])

  const play = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    startPlayback(audio, setError)
  }, [])

  const pause = useCallback((): void => {
    audioRef.current?.pause()
  }, [])

  const toggle = useCallback((): void => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) startPlayback(audio, setError)
    else audio.pause()
  }, [])

  const seekTo = useCallback((sec: number): void => {
    const audio = audioRef.current
    if (!audio) return
    const target = clampSec(sec, finiteDuration(audio))
    audio.currentTime = target
    setCurrentSec(target)
  }, [])

  const nudge = useCallback(
    (deltaSec: number): void => {
      const audio = audioRef.current
      if (!audio) return
      seekTo(resolveSeekTarget(audio.currentTime, deltaSec, finiteDuration(audio)))
    },
    [seekTo],
  )

  /**
   * 音量を要素へ流し、覚え書きに残す。
   *
   * **`audio.src` を差し替えても `volume` は消えない**（要素の属性であって音源の性質ではない）。
   * 消えるのは要素ごと作り直したときだけで、それは生成の効果が控えから入れ直す。
   */
  /** 描画が済んでから覚え書きを読む。ここまでは両側とも既定で揃っている。 */
  useEffect(() => {
    const stored = readVolumePreference()
    preferenceRef.current = stored
    setPreference(stored)
  }, [])

  useEffect(() => {
    preferenceRef.current = preference
    const audio = audioRef.current
    if (!audio) return
    audio.volume = clampVolume(preference.volume)
    audio.muted = preference.muted
  }, [preference])

  /**
   * **保存は操作したときだけ行う。** 状態の変化に合わせて書くと、
   * 覚え書きを読み込む前の既定値で上書きしてしまう。
   */
  const commit = useCallback((next: VolumePreference): void => {
    preferenceRef.current = next
    setPreference(next)
    writeVolumePreference(next)
  }, [])

  const setVolume = useCallback(
    (value: number): void => {
      // 丸めてから持つ。範囲外のまま持つと、要素へ入れる側で毎回考えることになる。
      commit({ ...preferenceRef.current, volume: clampVolume(value) })
    },
    [commit],
  )

  const toggleMute = useCallback((): void => {
    commit({ ...preferenceRef.current, muted: !preferenceRef.current.muted })
  }, [commit])

  return {
    isPlaying,
    currentSec,
    durationSec,
    isLoading,
    error,
    notice,
    play,
    pause,
    toggle,
    seekTo,
    nudge,
    volume: preference.volume,
    muted: preference.muted,
    setVolume,
    toggleMute,
  }
}
