import { framesToSeconds, secondsToFrames, type TimelineDocument } from '@ixa/domain'
import { totalFrames } from '@ixa/render/composition'

/**
 * プログラムモニターの純粋な計算と言葉。
 *
 * **丸めの規則をここに書かない。** 秒とフレームの往復は `@ixa/domain` の
 * `secondsToFrames` / `framesToSeconds` を、尺は `@ixa/render` の `totalFrames` を
 * そのまま呼ぶ。同じ規則を画面側に書き写すと、モニターと書き出しが必ずズレる（L-016）。
 * ズレた先が「プレビューでは合っていたのに書き出すと 1 フレーム違う」だと、
 * 原因が絵からは分からない。
 */

/** 表示位置（秒）を Player のフレーム番号へ。 */
export const secToFrame = (sec: number, fps: number): number => secondsToFrames(sec, fps)

/** Player のフレーム番号を秒へ。 */
export const frameToSec = (frame: number, fps: number): number => framesToSeconds(frame, fps)

/** コンポジションの尺。レンダリングと同じ関数で数える。 */
export const monitorDurationInFrames = (document: TimelineDocument): number =>
  totalFrames(document.durationSec, document.fps)

/**
 * 利用者が明示的に指定した再生位置。**1 回の指示ごとに `serial` が進む。**
 *
 * Player へのシークは、この指示が来たときだけ行う。親の `currentSec` は
 * Player が `frameupdate` で返した値の写しでもあるので、それを見てシークすると
 * 自分の報告（反射）と外からの指示の区別が要る。区別は推測になり、
 * React の effect の順番や Player の遅れた `frameupdate` で必ず破れる
 * （実機で 0:11 と 1:24 を 300ms ごとに往復し続けた）。
 * 「指示」を別の値として持てば、反射は一度もシークを起こさない。
 */
export type SeekCommand = {
  readonly sec: number
  /** 同じ秒を続けて押しても飛べるように、指示ごとに 1 ずつ増える。 */
  readonly serial: number
}

/** 新しい指示を作る。**渡された指示は書き換えない。** */
export const nextSeekCommand = (previous: SeekCommand | null, sec: number): SeekCommand => ({
  sec,
  serial: (previous?.serial ?? 0) + 1,
})

/** 親の幅に従い、高さを幅から決めるための比。16:9 が既定。 */
export const DEFAULT_ASPECT_RATIO = 16 / 9

/**
 * モニターの縦横比。`document` があればその解像度に従う
 * （縦動画のプロジェクトを 16:9 の枠に押し込めないため）。
 */
export const monitorAspectRatio = (document: TimelineDocument | null): number =>
  document === null ? DEFAULT_ASPECT_RATIO : document.resolution.width / document.resolution.height

/**
 * 画面に出す状態。
 *
 * **「まだ読めていない」と「Shot が 1 つも無い」を必ず分ける**（L-015 / L-021）。
 * どちらも絵は真っ黒だが、前者は待てば直り、後者は操作しないと直らない。
 * 同じ文にすると、利用者は読み込み中だと思って待ち続ける。
 */
export type MonitorStatus = 'error' | 'loading' | 'empty' | 'playing' | 'paused'

export type MonitorState = {
  readonly status: MonitorStatus
  readonly message: string
  /** 絵（Player）を出してよいか。false のときは文だけを出す。 */
  readonly canRender: boolean
}

/**
 * モニターの下に出す文。**鳴っているかどうかは言わない。**
 *
 * 再生の状態は画面の下の帯（ただひとつの再生操作）とパネルの見出しが持つ。
 * ここにも出していたため、別のパネルが鳴らしている間に**絵は動いているのに
 * 「停止中」**と出て食い違った。ここが言うのは「絵を出せない理由」だけにする。
 */
const MONITOR_MESSAGES: Readonly<Record<MonitorStatus, string>> = {
  error: '',
  loading: 'タイムラインをまだ読めていません。',
  empty: 'まだ映すものがありません。Shot に絵（最初のフレーム）か Take が付くと絵が出ます。',
  playing: '',
  paused: '',
}

/** 絵が無いまま音とテロップを流しているときに添える文。 */
const WITHOUT_PICTURES_MESSAGE = '絵はまだありません。音とテロップだけを流しています（黒い画面）。'

export type MonitorOptions = {
  /**
   * 絵（video1）が無くても、音かテロップがあれば黒い画面で流すか。**プレビューだけ**が true にする
   * （制作者 2026-10-03「テロップがあるだけではプレビューが再生できず…黒画面で問題ない」）。
   * Take の比較などは、絵が無いのに音だけ流すと何を見ているのか分からなくなるので false のまま。
   */
  readonly withoutPictures?: boolean
}

export const describeMonitorState = (
  document: TimelineDocument | null,
  playing: boolean,
  error: string | null,
  options: MonitorOptions = {},
): MonitorState => {
  if (error !== null) {
    return { status: 'error', message: error, canRender: false }
  }
  if (document === null) {
    return { status: 'loading', message: MONITOR_MESSAGES.loading, canRender: false }
  }
  const status: MonitorStatus = playing ? 'playing' : 'paused'
  if (document.video1.length === 0) {
    const audible = document.durationSec > 0 && (document.audio.length > 0 || document.clips.length > 0)
    return options.withoutPictures === true && audible
      ? { status, message: WITHOUT_PICTURES_MESSAGE, canRender: true }
      : { status: 'empty', message: MONITOR_MESSAGES.empty, canRender: false }
  }
  return { status, message: MONITOR_MESSAGES[status], canRender: true }
}

/**
 * 再生に失敗したときに出す文。
 *
 * **元の例外の本文をそのまま出さない。** Take のメディアは署名付き URL で、
 * 読み込み失敗の例外にはその URL が含まれる。画面にも `onError` の先にも
 * 署名付き URL を流さない（CLAUDE.md 規約 7 の趣旨）。
 * 期限切れは引き直せば直るので、直し方まで書く。
 */
export const monitorErrorMessage = (): string =>
  '素材を再生できませんでした。素材の URL の期限が切れた可能性があります。最新の状態にして引き直してください。'

/**
 * 素材そのものを読めなかったときの文。
 *
 * Player 全体の失敗（`monitorErrorMessage`）とは分ける。
 * こちらは **Shot 1 本の素材が 404 になった**場合で、残りの絵は出せる。
 * 同じ文にすると、1 本欠けただけでモニター全体が壊れたように見える。
 *
 * ここでも**元の URL を文に入れない**。署名付き URL を画面にも親にも渡さない。
 */
export const monitorMediaErrorMessage = (): string =>
  'この Shot の素材を読めません。素材が消えているか、URL の期限が切れた可能性があります。最新の状態にして引き直してください。'
