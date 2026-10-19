import type { ProjectEvent } from '@ixa/domain'
import { imageJobFailureNotice } from '@/lib/image-job-notice'
import { musicJobNotice } from '@/lib/music-job-form'
import { voiceJobNotice } from '@/lib/voice-job-notice'

/**
 * コンソール（下の区画のタブ）の記録。**React を含まない。**
 *
 * この画面を開いてから起きた出来事（上の知らせ・タイムラインの操作の結果・ジョブの完了と失敗）を
 * 新しい順に持つ。**ブラウザのメモリだけに置く。** 制作データではないので、閉じれば消えてよい。
 * 1 行の知らせは次の知らせで上書きされるので、見逃したものをここで読み返せるようにする。
 */

export type ConsoleLevel = 'info' | 'warn' | 'error'

export const CONSOLE_LEVEL_LABELS: Readonly<Record<ConsoleLevel, string>> = Object.freeze({
  info: '情報',
  warn: '警告',
  error: 'エラー',
})

export type ConsoleEntry = {
  readonly id: number
  /** 記録した時刻（ミリ秒の epoch）。画面の時計で、制作データの時刻ではない。 */
  readonly at: number
  readonly level: ConsoleLevel
  readonly text: string
}

/** 持っておく上限。超えたら古いものから捨てる。 */
export const CONSOLE_LIMIT = 200

/** 先頭に足して上限で切る。元の配列は変えない。 */
export const appendConsoleEntry = (
  entries: readonly ConsoleEntry[],
  entry: ConsoleEntry,
  limit: number = CONSOLE_LIMIT,
): readonly ConsoleEntry[] => [entry, ...entries].slice(0, limit)

const pad2 = (value: number): string => String(value).padStart(2, '0')

/** その日の時刻（時:分:秒）。タイムライン上の位置ではないので `format-time.ts` は使わない。 */
export const formatConsoleClock = (at: number): string => {
  const date = new Date(at)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export type ConsoleLog = {
  readonly getSnapshot: () => readonly ConsoleEntry[]
  readonly subscribe: (listener: () => void) => () => void
  /** 空白だけの文は記録しない。`at` はテスト用（省略で今）。 */
  readonly push: (level: ConsoleLevel, text: string, at?: number) => void
  readonly clear: () => void
}

const NO_ENTRIES: readonly ConsoleEntry[] = Object.freeze([])

/** `useSyncExternalStore` で読む小さな入れ物。ワークベンチごとに 1 つ作る。 */
export const createConsoleLog = (): ConsoleLog => {
  let entries = NO_ENTRIES
  let nextId = 1
  const listeners = new Set<() => void>()
  const emit = (): void => {
    listeners.forEach((listener) => {
      listener()
    })
  }
  return {
    getSnapshot: () => entries,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    push: (level, text, at = Date.now()) => {
      const trimmed = text.trim()
      if (trimmed === '') return
      entries = appendConsoleEntry(entries, { id: nextId, at, level, text: trimmed })
      nextId += 1
      emit()
    },
    clear: () => {
      if (entries.length === 0) return
      entries = NO_ENTRIES
      emit()
    },
  }
}

export type ConsoleLine = { readonly level: ConsoleLevel; readonly text: string }

const REASON_MISSING = '理由が届きませんでした。'

/**
 * ジョブの出来事を 1 行にする。**完了・失敗・止めた、だけ。** 待ち・実行中は数が多く、読む価値が無い。
 * 失敗の文は上の知らせと同じもの（`*-notice.ts`）を使う。2 箇所で言い方がズレないように。
 */
export const jobEventEntry = (
  event: ProjectEvent,
  shotLabel: (shotId: string) => string | null,
): ConsoleLine | null => {
  const shot = (shotId: string | null): string => (shotId === null ? null : shotLabel(shotId)) ?? 'Shot'
  switch (event.type) {
    case 'shot.status':
      return null
    case 'generation_job.status':
      if (event.status === 'succeeded') return { level: 'info', text: `${shot(event.shotId)} の Take ができました` }
      if (event.status === 'failed') {
        return { level: 'error', text: `${shot(event.shotId)} の生成に失敗しました: ${event.error ?? REASON_MISSING}` }
      }
      if (event.status === 'cancelled') return { level: 'warn', text: `${shot(event.shotId)} の生成を止めました` }
      return null
    case 'image_job.status': {
      if (event.status === 'failed') {
        const text = imageJobFailureNotice(event)
        return text === null ? null : { level: 'error', text }
      }
      const what =
        event.characterId !== null ? 'キャラクターシート' : event.shotId !== null ? `${shot(event.shotId)} の絵` : 'サムネイルの背景の絵'
      if (event.status === 'succeeded') return { level: 'info', text: `${what}ができました` }
      if (event.status === 'cancelled') return { level: 'warn', text: `${what}を作るのを止めました` }
      return null
    }
    case 'upscale_job.status':
      if (event.status === 'succeeded') {
        return { level: 'info', text: `${shot(event.shotId)} の解像度を上げた Take ができました` }
      }
      if (event.status === 'failed') {
        return { level: 'error', text: `${shot(event.shotId)} の解像度を上げられませんでした: ${event.error ?? REASON_MISSING}` }
      }
      if (event.status === 'cancelled') return { level: 'warn', text: `${shot(event.shotId)} の解像度を上げるのを止めました` }
      return null
    case 'voice_job.status': {
      if (event.status === 'failed') {
        const text = voiceJobNotice(event)
        return text === null ? null : { level: 'error', text }
      }
      if (event.status === 'succeeded') return { level: 'info', text: VOICE_DONE[event.kind] }
      if (event.status === 'cancelled') return { level: 'warn', text: '声のジョブを止めました' }
      return null
    }
    case 'music_job.status': {
      const text = musicJobNotice(event)
      if (text === null) return event.status === 'cancelled' ? { level: 'warn', text: '曲を作るのを止めました' } : null
      return { level: event.status === 'failed' ? 'error' : event.status === 'cancelled' ? 'warn' : 'info', text }
    }
    case 'sfx_job.status':
      if (event.status === 'succeeded') return { level: 'info', text: '効果音ができました' }
      if (event.status === 'failed') return { level: 'error', text: `効果音を作れませんでした: ${event.error ?? REASON_MISSING}` }
      if (event.status === 'cancelled') return { level: 'warn', text: '効果音を作るのを止めました' }
      return null
  }
}

const VOICE_DONE: Readonly<Record<Extract<ProjectEvent, { type: 'voice_job.status' }>['kind'], string>> = {
  speak: '声ができました',
  preview: '試しに読みました',
  transcribe: '録音を文字起こししました',
  char_timing: '字の時刻を取りました',
}
