'use client'

import type { MediaAssetId } from '@ixa/domain'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ExclusivePlayback } from '@/components/take-compare'
import { useTransportState, useWorkbench } from '@/components/workbench/workbench-context'
import { createApiClient } from '@/lib/api-client'
import { describeForPerson } from '@/lib/api-error'
import { reachedSoloEnd, resolveSoloRange, soloStopDelayMs, type SoloRange } from '@/lib/audio-solo'
import { AUDIO_URL_EXPIRES_IN_SEC, type SignedSource } from '@/lib/playback-state'
import { useAudioPlayback, type AudioPlayback } from '@/lib/use-audio-playback'

/**
 * 音 1 本だけを鳴らす再生器（素材ビューアの試聴とインスペクターの「この音だけ鳴らす」。ADR-0052）。
 *
 * **`<audio>` はワークベンチに 1 つだけ。** 以前は素材ビューアとインスペクターがそれぞれ持ち、同じ音が
 * 重なって鳴り、署名付き URL も 2 回取っていた。どちらもここを通す。
 *
 * **画面のほかの再生（プレビュー・聴きながら切る・Take 比較）と同時に鳴らない**（`ExclusivePlayback` と同じ作法）。
 * 鳴り始めたら他を止め、他が鳴り始めたら止まる。共有の再生位置（タイムラインの位置）は動かさないので
 * 操作列の持ち主にはならない（Space はこれまでどおりプレビュー側を鳴らす＝こちらは止まる）。
 */

/** いま鳴らしている人。`range` が null なら全体を自由に（素材ビューアの試聴）。 */
export type SoloActive = { readonly key: string; readonly range: SoloRange | null }

type Request = {
  readonly key: string
  readonly mediaAssetId: MediaAssetId
  /** undefined は全体を頭から。 */
  readonly range: SoloRange | undefined
  /** true なら範囲の頭から鳴らし、終わりで止める。false は今の位置から全体を自由に。 */
  readonly limited: boolean
}

export type SoloAudioValue = {
  readonly playback: AudioPlayback
  /** 読み込めている音。 */
  readonly loadedId: MediaAssetId | null
  readonly sourceError: string | null
  readonly active: SoloActive | null
  /** 読み込みを待って鳴らす頼み（押したが音がまだ届いていない）。 */
  readonly pendingKey: string | null
  /** この音を読み込んでおく（押したらすぐ鳴るように）。別の音が鳴っていれば止める。 */
  readonly prepare: (mediaAssetId: MediaAssetId) => void
  /** 範囲の頭から鳴らし、終わりで止めて頭へ戻す。range を渡さなければ全体。 */
  readonly playRange: (key: string, mediaAssetId: MediaAssetId, range?: SoloRange) => void
  /** 今の位置から全体を鳴らす（素材ビューアの試聴）。 */
  readonly playFree: (key: string, mediaAssetId: MediaAssetId) => void
  readonly stop: () => void
  /** 取り外すときに呼ぶ。自分が鳴らしていれば止める。 */
  readonly release: (key: string) => void
}

const SoloAudioContext = createContext<SoloAudioValue | null>(null)

/** ワークベンチの外（単体の部品のテストなど）では null。鳴らす口は出さない。 */
export const useSoloAudio = (): SoloAudioValue | null => useContext(SoloAudioContext)

type MediaUrlApi = { readonly mediaUrl: (id: MediaAssetId, expiresInSec?: number) => Promise<SignedSource> }

export const SoloAudioProvider = ({ api, children }: { readonly api?: MediaUrlApi; readonly children: ReactNode }) => {
  const client = useMemo<MediaUrlApi>(() => api ?? createApiClient(), [api])
  const [wantedId, setWantedId] = useState<MediaAssetId | null>(null)
  const [loaded, setLoaded] = useState<{ readonly id: MediaAssetId; readonly source: SignedSource } | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [active, setActive] = useState<SoloActive | null>(null)
  const [pending, setPending] = useState<Request | null>(null)

  const loadSource = useCallback(async (): Promise<SignedSource> => {
    if (wantedId === null) throw new Error('鳴らす音が決まっていません')
    return client.mediaUrl(wantedId, AUDIO_URL_EXPIRES_IN_SEC)
  }, [client, wantedId])

  // 音が替わったときだけ URL を取る（同じ音を見る場所が 2 つあっても 1 回）。期限が来たら useAudioPlayback が取り直す。
  useEffect(() => {
    if (wantedId === null) return
    let cancelled = false
    setSourceError(null)
    loadSource()
      .then((source) => {
        if (!cancelled) setLoaded({ id: wantedId, source })
      })
      .catch((cause: unknown) => {
        if (!cancelled) setSourceError(describeForPerson(cause))
      })
    return () => {
      cancelled = true
    }
  }, [loadSource, wantedId])

  const playback = useAudioPlayback({ source: loaded?.source ?? null, onRefreshSource: loadSource })
  const { isPlaying, currentSec, durationSec, pause, seekTo, play } = playback
  const loadedId = loaded?.id ?? null

  /** 同じ関数を渡し続ける（読み込む音が替わるたびに作り直すと、見ている場所どうしで取り合いになる）。 */
  const wantedRef = useRef(wantedId)
  wantedRef.current = wantedId
  const prepare = useCallback(
    (mediaAssetId: MediaAssetId): void => {
      if (mediaAssetId === wantedRef.current) return
      wantedRef.current = mediaAssetId
      pause()
      setActive(null)
      setWantedId(mediaAssetId)
    },
    [pause],
  )

  /** 読み込めている音で、頼みどおりに鳴らす。**押した手の中で呼ぶ**（自動再生の制限に掛からない）。 */
  const start = useCallback(
    (request: Request): void => {
      if (!request.limited) {
        setActive({ key: request.key, range: null })
        play()
        return
      }
      const resolved = resolveSoloRange(request.range, durationSec)
      if (resolved === null) return
      seekTo(resolved.inSec)
      setActive({ key: request.key, range: resolved })
      play()
    },
    [durationSec, play, seekTo],
  )

  const request = useCallback(
    (next: Request): void => {
      if (next.mediaAssetId === loadedId && durationSec > 0) {
        setPending(null)
        start(next)
        return
      }
      prepare(next.mediaAssetId)
      setPending(next)
    },
    [durationSec, loadedId, prepare, start],
  )

  // 押したときに音がまだ届いていなければ、届いたところで鳴らす。
  useEffect(() => {
    if (pending === null || pending.mediaAssetId !== loadedId || durationSec <= 0) return
    setPending(null)
    start(pending)
  }, [pending, loadedId, durationSec, start])

  const stop = useCallback((): void => {
    setPending(null)
    pause()
    if (active !== null && active.range !== null) seekTo(active.range.inSec)
    setActive(null)
  }, [active, pause, seekTo])

  /**
   * 取り外すときの口。**同じ関数を渡し続ける**（鳴らす人が替わるたびに作り直すと、取り外しの片付けが
   * 古い「鳴らしている人」で走り、いま鳴り始めた別の人を止めてしまう）。今の値は控えから読む。
   */
  const activeRef = useRef(active)
  activeRef.current = active
  const pauseRef = useRef(pause)
  pauseRef.current = pause
  const release = useCallback((key: string): void => {
    setPending((current) => (current?.key === key ? null : current))
    if (activeRef.current?.key !== key) return
    pauseRef.current()
    setActive(null)
  }, [])

  // 範囲の終わりで止めて頭へ戻す。位置が進むたびに、残りの時間で止める予約を掛け直す（描画を待たずに止める）。
  const range = active?.range ?? null
  useEffect(() => {
    if (!isPlaying || range === null) return
    const finish = (): void => {
      pause()
      seekTo(range.inSec)
    }
    if (reachedSoloEnd(currentSec, range)) {
      finish()
      return
    }
    const delay = soloStopDelayMs(currentSec, range)
    if (delay === null) return
    const timer = setTimeout(finish, delay)
    return () => {
      clearTimeout(timer)
    }
  }, [isPlaying, currentSec, range, pause, seekTo])

  useExclusive(isPlaying, pause)

  const value = useMemo<SoloAudioValue>(
    () => ({
      playback,
      loadedId,
      sourceError,
      active,
      pendingKey: pending?.key ?? null,
      prepare,
      playRange: (key, mediaAssetId, soloRange) => {
        request({ key, mediaAssetId, range: soloRange, limited: true })
      },
      playFree: (key, mediaAssetId) => {
        request({ key, mediaAssetId, range: undefined, limited: false })
      },
      stop,
      release,
    }),
    [playback, loadedId, sourceError, active, pending, prepare, request, stop, release],
  )
  return <SoloAudioContext.Provider value={value}>{children}</SoloAudioContext.Provider>
}

/**
 * 画面のほかの再生と同時に鳴らない（Take 比較の `CompareBoard` と同じ作法）。
 * 鳴り始め・止まりを知らせ（変化のときだけ）、他が鳴り始めたら止まる。
 */
const useExclusive = (isPlaying: boolean, pause: () => void): void => {
  const transport = useTransportState()
  const { transportControls } = useWorkbench()
  const exclusive: ExclusivePlayback = {
    othersPlaying: transport.playing,
    onPlayingChange: (playing) => {
      if (playing) transportControls.pause()
    },
    commandPlaying: null,
  }
  const reportRef = useRef(exclusive.onPlayingChange)
  reportRef.current = exclusive.onPlayingChange
  const wasPlayingRef = useRef(isPlaying)
  useEffect(() => {
    if (wasPlayingRef.current === isPlaying) return
    wasPlayingRef.current = isPlaying
    reportRef.current(isPlaying)
  }, [isPlaying])

  const { othersPlaying } = exclusive
  useEffect(() => {
    if (othersPlaying) pause()
  }, [othersPlaying, pause])
}
