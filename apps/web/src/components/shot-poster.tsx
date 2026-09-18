'use client'

import { useState } from 'react'
import { describeMissingPoster } from '@/lib/shot-posters'

/**
 * サムネイル 1 枚（P60-3）。**表示だけ**を持つ。何を出すかの判定は `shot-posters.ts`。
 *
 * 絵が無いときは空白ではなく**理由を持った枠**を出す。空白は
 * 「まだ作っていない」と「作ったが読めない」を同じ見た目にしてしまう（L-015）。
 *
 * 署名付き URL は期限が切れる。切れた URL は 403 で返ってくるので、
 * `onError` で「読み込めません」に切り替える。**壊れた画像アイコンのまま放置しない。**
 */

export type ShotPosterSize = 'row' | 'card' | 'chip'

export type ShotPosterProps = {
  readonly url: string | null
  readonly reason: string | null
  /** 何の絵かを言う文。空枠のときは理由と組にして読み上げへ渡す。 */
  readonly alt: string
  readonly size: ShotPosterSize
}

/** 読み込みに失敗したときの文。期限切れの署名がいちばん多い。 */
export const POSTER_LOAD_FAILED_TEXT = '読み込めません'

/**
 * 枠の大きさ。`chip` だけは帯のクリップに**敷く**ので、親いっぱいに広げる。
 * 16:9 は `aspect-video` で保つ（行とカード）。
 */
const FRAME_CLASS: Readonly<Record<ShotPosterSize, string>> = {
  row: 'w-20 aspect-video',
  card: 'w-full aspect-video',
  chip: 'absolute inset-0',
}

/** 空枠の文。チップは高さが 28px しか無いので、文字は読み上げにだけ残す。 */
const NOTE_CLASS: Readonly<Record<ShotPosterSize, string>> = {
  row: 'px-1 text-center text-xs leading-tight',
  card: 'px-2 text-center text-xs leading-tight',
  chip: 'sr-only',
}

export const ShotPoster = ({ url, reason, alt, size }: ShotPosterProps) => {
  const [failed, setFailed] = useState(false)
  const frame = `overflow-hidden rounded border border-line bg-surface-2 ${FRAME_CLASS[size]}`

  if (url !== null && !failed) {
    return (
      <span className={`${frame} block`}>
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => {
            setFailed(true)
          }}
        />
      </span>
    )
  }

  // 「URL が無い」と「URL はあったが読めなかった」を書き分ける。対処が違う。
  const note = url === null ? describeMissingPoster(reason) : POSTER_LOAD_FAILED_TEXT

  return (
    <span
      role="img"
      aria-label={`${alt}: ${note}`}
      title={note}
      className={`${frame} flex items-center justify-center text-muted`}
    >
      <span className={NOTE_CLASS[size]}>{note}</span>
    </span>
  )
}
