'use client'

import { useEffect, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { formatClock } from '@/lib/format-time'
import {
  describeVolume,
  FINE_SEC,
  isTextEntryTarget,
  KEY_HINTS,
  keyToPlaybackCommand,
  MAX_VOLUME,
  MIN_VOLUME,
} from '@/lib/playback-state'
import type { AudioPlayback } from '@/lib/use-audio-playback'

/**
 * 音源の操作盤。再生・一時停止・現在位置・シーク・キー割り当ての表示。
 *
 * **再生の状態は自分で持たない。** `useAudioPlayback` の結果を受け取る。
 * 波形の画面は同じ現在位置を使って印を動かすため、状態が 2 つあると必ずずれる。
 *
 * **時刻の表示を読み上げ領域に入れない。** 毎秒 60 回変わる値を `role="status"` に
 * 置くと、読み上げが数字で埋まって他が聞こえなくなる。読み上げるのは
 * 「読み込み中」「再生中」など、めったに変わらない状態だけにする。
 */
export type AudioTransportProps = {
  readonly playback: AudioPlayback
  /** 何を鳴らしているか。無名の操作盤にしない。 */
  readonly label?: string
  /** 波形編集では再生位置と音量を一列にまとめる。 */
  readonly layout?: 'stacked' | 'inline'
  /**
   * 画面全体でキー操作を受けるか。
   * **1 つの画面に 2 つ置くときは片方を false にする。** 両方が同じ打鍵に反応する。
   */
  readonly keyboardShortcuts?: boolean
}

/**
 * 読み上げ領域に出す一行。
 *
 * **取り直し中の断りを最優先で出す。** 一瞬の途切れに理由が付かないと、
 * 利用者には原因不明の引っかかりとして残る。
 */
const stateMessage = (playback: AudioPlayback): string => {
  if (playback.notice !== null) return playback.notice
  if (playback.isLoading) return '音源を読み込んでいます'
  if (playback.isPlaying) return '再生中'
  return '停止中'
}

export const AudioTransport = ({
  playback,
  label,
  layout = 'stacked',
  keyboardShortcuts = true,
}: AudioTransportProps) => {
  const {
    isPlaying,
    currentSec,
    durationSec,
    isLoading,
    error,
    toggle,
    seekTo,
    nudge,
    volume,
    muted,
    setVolume,
    toggleMute,
  } = playback
  const seekable = durationSec > 0 && error === null

  /**
   * キー操作は画面全体で受ける。波形の上にいても効くようにするため。
   * **入力欄に飛んだ打鍵は横取りしない。** 題名を打つスペースで曲が鳴り出す。
   */
  useEffect(() => {
    if (!keyboardShortcuts) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (isTextEntryTarget(target)) return
      const command = keyToPlaybackCommand(event)
      if (!command) return
      event.preventDefault()
      if (command.kind === 'toggle') {
        toggle()
        return
      }
      if (command.kind === 'nudge') {
        nudge(command.deltaSec)
        return
      }
      seekTo(command.edge === 'start' ? 0 : durationSec)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [keyboardShortcuts, toggle, nudge, seekTo, durationSec])

  const onSeekChange = (event: ChangeEvent<HTMLInputElement>): void => {
    seekTo(Number(event.target.value))
  }

  const onVolumeChange = (event: ChangeEvent<HTMLInputElement>): void => {
    // 消音したまま音量を動かしたら、鳴らしたいということ。消音を解く。
    if (muted) toggleMute()
    setVolume(Number.parseFloat(event.target.value))
  }

  const volumePercent = `${String(Math.round(volume * 100))}%`

  return (
    <section
      aria-label={label ? `${label} の再生操作` : '再生操作'}
      className="flex flex-col gap-3"
    >
      {error !== null && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {layout === 'inline' ? (
        <div
          role="group"
          aria-label="再生位置と音量"
          className="flex flex-wrap items-center gap-x-2 gap-y-2 xl:flex-nowrap"
        >
          <Button
            // 並んだ画面の主の操作は別にある（聴きながら切るなら「区切りを置く」。P6）。
            tone="secondary"
            onClick={toggle}
            disabled={error !== null}
            aria-label={isPlaying ? '一時停止' : '再生'}
          >
            <span className="whitespace-nowrap">{isPlaying ? '一時停止' : '再生'}</span>
          </Button>
          <p className="shrink-0 font-mono text-sm tabular-nums text-text">
            <span>{formatClock(currentSec)}</span>
            <span className="text-faint"> / </span>
            <span>{formatClock(durationSec)}</span>
          </p>
          <p
            role="status"
            className={`shrink-0 ${playback.notice !== null ? 'text-xs text-warn' : 'text-xs text-muted'}`}
          >
            {stateMessage(playback)}
          </p>
          <span aria-hidden="true" className="hidden h-6 border-l border-line xl:block" />
          <input
            type="range"
            aria-label="再生位置"
            min={0}
            max={durationSec > 0 ? durationSec : 0}
            step={FINE_SEC}
            value={Math.min(currentSec, durationSec)}
            disabled={!seekable}
            onChange={onSeekChange}
            aria-valuetext={`${formatClock(currentSec)} / ${formatClock(durationSec)}`}
            className="min-w-32 flex-[2_1_20rem] accent-accent disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span aria-hidden="true" className="hidden h-6 border-l border-line xl:block" />
          <span className="shrink-0 text-sm text-text">音量</span>
          <Button size="sm" onClick={toggleMute} aria-pressed={muted}>
            <span className="whitespace-nowrap">{muted ? '消音を解除' : '消音'}</span>
          </Button>
          <input
            type="range"
            aria-label="音量"
            min={MIN_VOLUME}
            max={MAX_VOLUME}
            step={0.01}
            value={volume}
            onChange={onVolumeChange}
            aria-valuetext={describeVolume(volume, muted)}
            className="w-24 accent-accent"
          />
          <span aria-hidden="true" className="w-9 text-right text-xs tabular-nums text-muted">
            {volumePercent}
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              tone="primary"
              onClick={toggle}
              disabled={error !== null}
              aria-label={isPlaying ? '一時停止' : '再生'}
            >
              {isPlaying ? '一時停止' : '再生'}
            </Button>

            <p className="font-mono text-sm tabular-nums text-text">
              <span>{formatClock(currentSec)}</span>
              <span className="text-faint"> / </span>
              <span>{formatClock(durationSec)}</span>
            </p>

            <p
              role="status"
              className={playback.notice !== null ? 'text-xs text-warn' : 'text-xs text-muted'}
            >
              {stateMessage(playback)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={toggleMute} aria-pressed={muted}>
              {muted ? '消音を解除' : '消音'}
            </Button>

            <label className="flex flex-1 items-center gap-2 text-sm text-text">
              <span className="shrink-0">音量</span>
              <input
                type="range"
                aria-label="音量"
                min={MIN_VOLUME}
                max={MAX_VOLUME}
                step={0.01}
                value={volume}
                onChange={onVolumeChange}
                aria-valuetext={describeVolume(volume, muted)}
                className="w-full max-w-xs accent-accent"
              />
            </label>

            <p aria-hidden="true" className="text-xs text-muted">
              {describeVolume(volume, muted)}
            </p>
          </div>

          <input
            type="range"
            aria-label="再生位置"
            min={0}
            max={durationSec > 0 ? durationSec : 0}
            step={FINE_SEC}
            value={Math.min(currentSec, durationSec)}
            disabled={!seekable}
            onChange={onSeekChange}
            aria-valuetext={`${formatClock(currentSec)} / ${formatClock(durationSec)}`}
            className="w-full accent-accent disabled:cursor-not-allowed disabled:opacity-40"
          />
        </>
      )}

      {/*
        割り当ては必ず画面に出す。隠れた操作は無いのと同じ。
        `KEY_HINTS` は `keyToPlaybackCommand` と 1 対 1 で対応している。

        **ただし打鍵を受けていないときは出さない。** 一覧は「この一覧のとおりに効く」
        という約束であって、飾りではない。`keyboardShortcuts` が false のとき、
        打鍵を受けるのは画面を組む側で、そちらが別の割り当てを持っていることがある。
        両方が一覧を出すと、同じキーに 2 つの説明が並び、片方が必ず嘘になる。
        実際に「聴きながら切る」画面で矢印キーが重なり、この一覧だけが
        古い説明を出していた。
      */}
      {keyboardShortcuts && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {KEY_HINTS.map((hint) => (
            <div key={hint.keys} className="flex items-center gap-1.5">
              <dt>
                <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-text">
                  {hint.keys}
                </kbd>
              </dt>
              <dd>{hint.action}</dd>
            </div>
          ))}
        </dl>
      )}

      {isLoading && durationSec === 0 && (
        <p className="text-xs text-muted">音源を読み込んでいます…</p>
      )}
    </section>
  )
}
