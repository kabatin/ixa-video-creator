/**
 * 音源再生の「決め事」だけを集めた純粋な部分。React も `<audio>` も出てこない。
 *
 * **判断をフックや部品の中に書かない。** 再生位置の丸め・範囲収め・キー割り当ては、
 * どれも「あとで必ず調整が入るのに、間違えても画面上は静かに壊れる」種類の規則である。
 * ここに集めておけば、タイマーもブラウザも無しで確かめられる。
 */

/**
 * 再生位置を state へ書き戻す最小の差。
 *
 * `requestAnimationFrame` は毎秒 60 回回る。毎回 state を更新すると、
 * 波形の上の印が動かないほどの差でも React の再描画が走る。
 * 10ms は 30fps の 1 フレーム（33ms）より細かく、目では追えない。
 */
export const MIN_POSITION_DELTA_SEC = 0.01

/** 秒として扱えない値（NaN / Infinity / 負）を 0 に潰す。 */
const toFiniteSec = (sec: number): number => (Number.isFinite(sec) ? Math.max(sec, 0) : 0)

/**
 * 再生位置を `[0, durationSec]` に収める。
 *
 * **尺が未確定（0 や NaN）のときに上限で切らない。** メタデータが読めるまで
 * 尺は 0 であり、そこで切ると先頭へ吸い寄せられて「シークが効かない」ように見える。
 */
export const clampSec = (sec: number, durationSec: number): number => {
  const value = toFiniteSec(sec)
  const limit = toFiniteSec(durationSec)
  if (limit <= 0) return value
  return Math.min(value, limit)
}

/** 再生位置の更新を state に反映すべきか。差が小さければ前の値を使い回す。 */
export const shouldCommitPosition = (prevSec: number, nextSec: number): boolean =>
  Math.abs(toFiniteSec(nextSec) - toFiniteSec(prevSec)) >= MIN_POSITION_DELTA_SEC

/** 現在位置から相対で動かした先。範囲外へは出ない。 */
export const resolveSeekTarget = (
  currentSec: number,
  deltaSec: number,
  durationSec: number,
): number =>
  clampSec(toFiniteSec(currentSec) + (Number.isFinite(deltaSec) ? deltaSec : 0), durationSec)

// ---------------------------------------------------------------------------
// キー操作
// ---------------------------------------------------------------------------

/** キー 1 打で起きること。実際に何秒動かすかは呼び出し側ではなくここが決める。 */
export type PlaybackCommand =
  | { readonly kind: 'toggle' }
  | { readonly kind: 'nudge'; readonly deltaSec: number }
  | { readonly kind: 'jump'; readonly edge: 'start' | 'end' }

/** `KeyboardEvent` のうち、割り当ての判断に要る分だけ。React 非依存にするため。 */
export type KeyEventLike = {
  readonly key: string
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
}

/** キーの飛び先。入力欄かどうかだけを見る。 */
export type KeyTargetLike = {
  readonly tagName?: string
  readonly isContentEditable?: boolean
}

const TEXT_ENTRY_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * 文字を打っている最中か。
 *
 * **ここを省くと、題名を打つスペースで曲が鳴り出す。** 打鍵のたびに音が
 * 出たり止まったりする画面は、それだけで使えない。
 */
export const isTextEntryTarget = (target: KeyTargetLike | null | undefined): boolean => {
  if (!target) return false
  if (target.isContentEditable === true) return true
  return TEXT_ENTRY_TAGS.has((target.tagName ?? '').toUpperCase())
}

/** 1 秒。波の山をひとつ跨ぐくらい。 */
export const NUDGE_SEC = 1
/** 5 秒。フレーズをひとつ跨ぐくらい。 */
export const JUMP_SEC = 5
/** 0.1 秒。切れ目を合わせ込むとき。 */
export const FINE_SEC = 0.1

/**
 * キー入力を操作へ翻訳する。割り当てを変えるならここだけを直す。
 *
 * **画面に出している一覧（`KEY_HINTS`）と必ず揃える。** 隠れた操作は無いのと同じ。
 * `Ctrl` / `Cmd` / `Alt` を伴う打鍵は、ブラウザや OS の操作なので横取りしない。
 */
export const keyToPlaybackCommand = (event: KeyEventLike): PlaybackCommand | null => {
  if (event.ctrlKey || event.metaKey || event.altKey) return null

  switch (event.key) {
    case ' ':
    case 'Spacebar':
      return { kind: 'toggle' }
    case 'ArrowLeft':
      return { kind: 'nudge', deltaSec: event.shiftKey ? -JUMP_SEC : -NUDGE_SEC }
    case 'ArrowRight':
      return { kind: 'nudge', deltaSec: event.shiftKey ? JUMP_SEC : NUDGE_SEC }
    case ',':
      return { kind: 'nudge', deltaSec: -FINE_SEC }
    case '.':
      return { kind: 'nudge', deltaSec: FINE_SEC }
    case 'Home':
      return { kind: 'jump', edge: 'start' }
    case 'End':
      return { kind: 'jump', edge: 'end' }
    default:
      return null
  }
}

/** 画面に出すキーの一覧。`keyToPlaybackCommand` と 1 対 1 で対応させること。 */
export const KEY_HINTS: ReadonlyArray<{ readonly keys: string; readonly action: string }> =
  Object.freeze([
    { keys: 'Space', action: '再生 / 一時停止' },
    { keys: '← / →', action: `${String(NUDGE_SEC)} 秒 戻る / 進む` },
    { keys: 'Shift + ← / →', action: `${String(JUMP_SEC)} 秒 戻る / 進む` },
    { keys: ', / .', action: `${String(FINE_SEC)} 秒 戻る / 進む` },
    { keys: 'Home / End', action: '先頭 / 末尾' },
  ])

// ---------------------------------------------------------------------------
// 署名付き URL の期限
// ---------------------------------------------------------------------------

/** `GET /media/{id}/url` が返す形。期限は秒で来る。 */
export type SignedSource = {
  readonly url: string
  readonly expiresInSec: number
}

/**
 * 音源を取りに行くときに**要求する**期限（秒）。
 *
 * **これは要求であって、期限そのものではない。** 実際の有効期間は API が返した
 * `expiresInSec` を使う（取り直しの時刻もそこから決める）。API 側の既定は 300 秒で、
 * 聴きながら切る画面に 5 分しか居ないということはまず無い。
 * 既定のままだと 5 分を過ぎたあとのシークで、ブラウザが期限切れの URL へ
 * 範囲リクエストを投げ、再生が黙って止まる。1 時間は「この画面に居る想定時間」であって、
 * API 側の上限を書き写した値ではない。短く返されたらその値に従う。
 */
export const AUDIO_URL_EXPIRES_IN_SEC = 3_600

/**
 * 期限の何秒前に取り直すか。
 * 再生中に切れると、まだ読んでいない後半へシークした瞬間に音が死ぬ。
 */
export const REFRESH_MARGIN_SEC = 60

/**
 * 期限が切れる前に取り直しているとき。
 * 一瞬の途切れの理由を出さないと、利用者には原因不明の引っかかりに見える。
 */
export const URL_REFRESHING_NOTICE = '音源の一時 URL の期限が近づいたため取り直しています。'

/** 期限切れで止まったあと、取り直しているとき。**黙って直さない。** */
export const URL_EXPIRED_NOTICE = '音源の一時 URL の期限が切れました。取り直します。'

/** 取り直しの間隔の下限。期限が極端に短くても叩き続けないための床。 */
export const MIN_REFRESH_DELAY_MS = 10_000

/** 次に URL を取り直すまでの待ち時間（ms）。 */
export const refreshDelayMs = (
  expiresInSec: number,
  marginSec: number = REFRESH_MARGIN_SEC,
): number => {
  const lifetime = toFiniteSec(expiresInSec)
  return Math.max((lifetime - marginSec) * 1_000, MIN_REFRESH_DELAY_MS)
}

/** `MediaError.code`。数値のまま画面に出しても誰にも伝わらない。 */
export const MEDIA_ERROR_ABORTED = 1
export const MEDIA_ERROR_NETWORK = 2
export const MEDIA_ERROR_DECODE = 3
export const MEDIA_ERROR_SRC_NOT_SUPPORTED = 4

/**
 * 取り直しで直る見込みがあるか。
 *
 * 期限切れの署名付き URL は 403 として返るため、ブラウザからは
 * 「ネットワークで落ちた」「この音源は再生できない」に見える。復号の失敗は取り直しても直らない。
 */
export const isRecoverableMediaError = (code: number | null | undefined): boolean =>
  code === MEDIA_ERROR_NETWORK || code === MEDIA_ERROR_SRC_NOT_SUPPORTED

/** 失敗の理由を日本語にする。次に何をすればよいかまで書く。 */
export const mediaErrorMessage = (code: number | null | undefined): string => {
  switch (code) {
    case MEDIA_ERROR_ABORTED:
      return '音源の読み込みが中断されました。'
    case MEDIA_ERROR_NETWORK:
      return '音源を読み込めませんでした。一時 URL の期限が切れたか、通信が切れています。'
    case MEDIA_ERROR_DECODE:
      return '音源を再生できませんでした。ファイルが壊れている可能性があります。'
    case MEDIA_ERROR_SRC_NOT_SUPPORTED:
      return 'この音源を再生できません。一時 URL の期限が切れたか、形式が対応していません。'
    default:
      return '音源の再生に失敗しました。'
  }
}

// ---------------------------------------------------------------------------
// 音量
// ---------------------------------------------------------------------------

/** `HTMLMediaElement.volume` が受け付ける範囲。外すと例外になる。 */
export const MIN_VOLUME = 0
export const MAX_VOLUME = 1
export const DEFAULT_VOLUME = 1

/**
 * 音量を要素が受け付ける形に丸める。
 *
 * **範囲外を渡すと `HTMLMediaElement` は例外を投げる。** 保存した値が壊れていたり、
 * 別のところで 0〜100 の百分率を入れ違えたりしたときに、再生ごと落とさないための関門。
 * 数値でないものは既定へ倒す。0 は正しい値なので、`||` で潰さないこと。
 */
export const clampVolume = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME
  return Math.min(Math.max(value, MIN_VOLUME), MAX_VOLUME)
}

/**
 * 音量の言い方。
 *
 * **消音と音量 0 を同じ文にしない。** どちらも音は出ないが、
 * 戻し方が違う。消音は解除すれば元の大きさに戻り、音量 0 は上げ直す必要がある。
 */
export const describeVolume = (volume: number, muted: boolean): string => {
  const percent = Math.round(clampVolume(volume) * 100)
  if (muted) return `消音中（解除すると ${String(percent)}%）`
  if (percent === 0) return '音量 0%（消音ではありません。上げると鳴ります）'
  return `音量 ${String(percent)}%`
}
