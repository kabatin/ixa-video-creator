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

  return (
    <section
      aria-label={label ? `${label} の再生操作` : '再生操作'}
      className="flex flex-col gap-3"
    >
      {error !== null && (
        <p
          role="alert"
          className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          tone="primary"
          onClick={toggle}
          disabled={error !== null}
          aria-label={isPlaying ? '一時停止' : '再生'}
        >
          {isPlaying ? '一時停止' : '再生'}
        </Button>

        <p className="font-mono text-sm tabular-nums text-slate-700">
          <span>{formatClock(currentSec)}</span>
          <span className="text-slate-400"> / </span>
          <span>{formatClock(durationSec)}</span>
        </p>

        <p
          role="status"
          className={playback.notice !== null ? 'text-xs text-amber-700' : 'text-xs text-slate-500'}
        >
          {stateMessage(playback)}
        </p>
      </div>

      {/*
        音量。**消音とは別の値として持つ。** 消音を解除したときに元の大きさへ戻るので、
        消音のたびに大きさを覚え直さなくてよい。刻みは 1%。
        矢印キーはこの入力欄の中ではブラウザ既定の動きになり、画面の割り当ては効かない。
      */}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={toggleMute} aria-pressed={muted}>
          {muted ? '消音を解除' : '消音'}
        </Button>

        <label className="flex flex-1 items-center gap-2 text-sm text-slate-700">
          <span className="shrink-0">音量</span>
          <input
            type="range"
            aria-label="音量"
            min={MIN_VOLUME}
            max={MAX_VOLUME}
            step={0.01}
            value={volume}
            onChange={(event) => {
              // 消音したまま音量を動かしたら、鳴らしたいということ。消音を解く。
              if (muted) toggleMute()
              setVolume(Number.parseFloat(event.target.value))
            }}
            aria-valuetext={describeVolume(volume, muted)}
            className="w-full max-w-xs accent-slate-900"
          />
        </label>

        {/**
         * 目で読むためだけの表示。**読み上げ領域にしないこと。**
         * 同じ内容はスライダーの `aria-valuetext` が持っており、
         * 二重に持たせると読み上げが同じ文を 2 回言う。
         * 再生状態の読み上げ領域とも取り違えられる。
         */}
        <p aria-hidden="true" className="text-xs text-slate-600">
          {describeVolume(volume, muted)}
        </p>
      </div>

      {/*
        シークバーは秒そのものを値にする。割合にすると読み上げが「43%」になり、
        曲のどこかが分からない。矢印キーはこの入力欄の中では自前の割り当てを使わず、
        ブラウザ既定の刻み（0.1 秒）で動く。
      */}
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
        className="w-full accent-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
      />

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
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {KEY_HINTS.map((hint) => (
            <div key={hint.keys} className="flex items-center gap-1.5">
              <dt>
                <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-slate-700">
                  {hint.keys}
                </kbd>
              </dt>
              <dd>{hint.action}</dd>
            </div>
          ))}
        </dl>
      )}

      {isLoading && durationSec === 0 && (
        <p className="text-xs text-slate-500">音源を読み込んでいます…</p>
      )}
    </section>
  )
}
