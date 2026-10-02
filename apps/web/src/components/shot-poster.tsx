'use client'

import { useContext, useState } from 'react'
import { PosterRenewalContext } from '@/lib/poster-renewal'
import { describeMissingPoster } from '@/lib/shot-posters'

/**
 * サムネイル 1 枚（P60-3）。**表示だけ**を持つ。何を出すかの判定は `shot-posters.ts`。
 *
 * 絵が無いときは空白ではなく**理由を持った枠**を出す。空白は
 * 「まだ作っていない」と「作ったが読めない」を同じ見た目にしてしまう（L-015）。
 *
 * 署名付き URL は期限が切れる。切れた URL は 403 で返ってくるので、
 * `onError` で「読み込めません」に切り替える。**壊れた画像アイコンのまま放置しない。**
 * あわせて一覧の引き直しを頼み、新しい URL が届いたら絵に戻す（読めなかったのはその URL だけ）。
 */

export type ShotPosterSize = 'row' | 'card' | 'chip'

export type ShotPosterProps = {
  readonly url: string | null
  readonly reason: string | null
  /** 何の絵かを言う文。空枠のときは理由と組にして読み上げへ渡す。 */
  readonly alt: string
  readonly size: ShotPosterSize
  /** 作っている最中（待てば出る）。絵がまだ無ければ回る印を出す。 */
  readonly pending?: boolean
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

/** 回る印の大きさ。チップは高さ 20px ほどしか無い。 */
const SPINNER_CLASS: Readonly<Record<ShotPosterSize, string>> = {
  row: 'h-3 w-3',
  card: 'h-5 w-5',
  chip: 'h-3 w-3',
}

/**
 * 作っている最中の印（制作者 2026-10-02「生成中なのが分かるようにローディングマーク」）。
 * Shot 一覧のチップは字が置けず、作っている最中も空の灰色の枠にしか見えなかった。動きを減らす設定では回さない。
 */
const Spinner = ({ size }: { readonly size: ShotPosterSize }) => (
  <span
    data-testid="poster-spinner"
    aria-hidden="true"
    className={`${SPINNER_CLASS[size]} shrink-0 rounded-full border-2 border-line-strong border-t-accent motion-safe:animate-spin`}
  />
)

export const ShotPoster = ({ url, reason, alt, size, pending = false }: ShotPosterProps) => {
  // 読めなかった URL。**URL ごとに覚える**（新しい URL が届いても「読み込めません」に留まっていた）。
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = url !== null && url === failedUrl
  const renew = useContext(PosterRenewalContext)
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
            setFailedUrl(url)
            renew?.()
          }}
        />
      </span>
    )
  }

  // 「URL が無い」と「URL はあったが読めなかった」を書き分ける。対処が違う。
  const note = url === null ? describeMissingPoster(reason) : POSTER_LOAD_FAILED_TEXT

  // 読めなかった絵は作っている最中ではない（URL はあった）。
  const working = pending && url === null

  return (
    <span
      role="img"
      aria-label={`${alt}: ${note}`}
      {...(working ? { 'aria-busy': true } : {})}
      title={note}
      className={`${frame} flex flex-col items-center justify-center gap-1 text-muted`}
    >
      {working && <Spinner size={size} />}
      <span className={NOTE_CLASS[size]}>{note}</span>
    </span>
  )
}
