import {
  CUT_MARK_KEY_HELP,
  COARSE_NUDGE_SEC,
  FINE_NUDGE_SEC,
  resolveCutMarkCommand,
  type CutMarkCommand,
} from '@/lib/cut-marks'
import { formatDuration } from '@/lib/format-time'
import {
  KEY_HINTS,
  keyToPlaybackCommand,
  resolveKeyOwner,
  type PlaybackCommand,
} from '@/lib/playback-state'

/**
 * 聴きながら切る画面の、キー 1 打の行き先を決める。
 *
 * 再生の割り当て（`playback-state`）と区切りの割り当て（`cut-marks`）は
 * 別々に作られていて、**`←` `→` と `Shift + ←` `→` が重なっている。**
 * どちらも単独では正しいが、同じ画面に両方を置くと 1 打が 2 つの意味を持つ。
 * 重なりを解くのは画面を組む側の仕事なので、ここで決める。
 *
 * **区切りの操作を優先する。** この画面の目的は切ることで、聴くことはそのための手段。
 * 矢印で区切りの間を渡れるほうが、1 秒ずつ動かすより曲の構造に沿って速い。
 * 区切りへ移ったときに再生位置も一緒に動かせば、移動手段としても失われない。
 *
 * 再生側に残るのは `Space`・`,` `.`・`Home` `End`。
 * 細かく詰める `,` `.` は区切りと重ならないので、そのまま効く。
 */

/**
 * 判定に要るぶんだけのキーイベント。両モジュールの `KeyEventLike` を同時に満たす形。
 *
 * `role` を持つのは、`role="menuitem"` のようにタグでは分からないボタンを避けるため
 * （`ownsPlainKeys`）。ここを見ていなかったので、メニュー項目の上の Enter を横取りしていた。
 */
export type CutEditorKeyEvent = {
  readonly key: string
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly target: {
    readonly tagName: string
    readonly isContentEditable: boolean
    readonly role?: string | null
  } | null
  /**
   * フォーカスがこの画面の入れ物の中にあるか。**見えているかではない。**
   * `closest` を引くのは呼び出し側（`cut-editor.tsx`）で、ここへは真偽値だけが来る。
   */
  readonly insideCutEditor: boolean
}

/** どちらの割り当てが受けたか。画面はこれを見て実行先を選ぶ。 */
export type CutEditorCommand =
  | { readonly source: 'mark'; readonly command: CutMarkCommand }
  | { readonly source: 'playback'; readonly command: PlaybackCommand }

/**
 * キー 1 打を操作へ変換する。区切りが先、余ったものを再生が受ける。
 *
 * **まず持ち主を確かめる。** `resolveKeyOwner` はワークベンチ側（`workbench-keys.ts`）と
 * 同じ関数で、答えは必ず 1 つ。だから同じ 1 打で両方が動くことが構造的に起きない。
 * 文字を打っている最中とボタンの上はここで落ちる（`keyToPlaybackCommand` は
 * 飛び先を受け取らないので、見るのは呼ぶ側の責任）。
 */
export const resolveCutEditorCommand = (event: CutEditorKeyEvent): CutEditorCommand | null => {
  if (resolveKeyOwner(event.target, event.insideCutEditor) !== 'cut-editor') return null

  const mark = resolveCutMarkCommand(event)
  if (mark !== null) return { source: 'mark', command: mark }

  const playback = keyToPlaybackCommand(event)
  if (playback !== null) return { source: 'playback', command: playback }

  return null
}

// --- 画面に出す一覧 ---

/**
 * 押す組み合わせ 1 つ。`label` は人が読む形、`event` は実際に判定へ流す形。
 *
 * **一覧は手で書かず、この表を実際の判定に通して作る。** 手で書くと、
 * 割り当てが変わったときに説明だけが古いまま残る。重なりを解いた画面では
 * とくに危うい。`←` の説明が「1 秒戻る」のままだと、嘘を表示することになる。
 */
type KeyProbe = {
  readonly label: string
  readonly event: CutEditorKeyEvent
}

const press = (
  key: string,
  modifiers: { readonly shiftKey?: boolean; readonly altKey?: boolean } = {},
): CutEditorKeyEvent => ({
  key,
  shiftKey: modifiers.shiftKey ?? false,
  altKey: modifiers.altKey ?? false,
  ctrlKey: false,
  metaKey: false,
  target: null,
  // 一覧は「この画面を操作している人」から見た説明。フォーカスは中にある前提で引く。
  insideCutEditor: true,
})

/**
 * 両方の割り当てが説明している組み合わせを網羅する。
 * ここに載っていない打鍵は画面にも出ない。
 */
const KEY_PROBES: readonly KeyProbe[] = [
  { label: 'Space', event: press(' ') },
  { label: 'Enter / S', event: press('Enter') },
  { label: 'Backspace', event: press('Backspace') },
  { label: 'Delete / X', event: press('Delete') },
  { label: '← / →', event: press('ArrowLeft') },
  { label: 'Shift + ← / →', event: press('ArrowLeft', { shiftKey: true }) },
  { label: 'Alt + ← / →', event: press('ArrowLeft', { altKey: true }) },
  { label: ', / .', event: press(',') },
  { label: 'Home / End', event: press('Home') },
  { label: 'N', event: press('N') },
]

/** 左右が対になっている説明は、片側だけ調べて両方ぶんの文にする。 */
const PAIRED_LABELS: ReadonlySet<string> = new Set(['← / →', 'Shift + ← / →', 'Alt + ← / →'])

const describeMarkCommand = (command: CutMarkCommand): string => {
  switch (command.type) {
    case 'place_mark':
      return 'いまの再生位置に区切りを置く'
    case 'remove_previous_mark':
      return '再生位置の直前にある区切りを消す'
    case 'remove_selected_mark':
      return '選んでいる区切りを消す'
    case 'select_previous_mark':
    case 'select_next_mark':
      return '前 / 次の区切りへ移る（再生位置もそこへ動く）'
    case 'nudge_selected_mark':
      return `選んでいる区切りを ${formatDuration(Math.abs(command.deltaSec))} 動かす`
    case 'toggle_snap':
      return '吸着を入れる / 切る'
  }
}

const describePlaybackCommand = (command: PlaybackCommand, paired: boolean): string => {
  switch (command.kind) {
    case 'toggle':
      return '再生 / 一時停止'
    case 'nudge': {
      const amount = formatDuration(Math.abs(command.deltaSec))
      return paired ? `${amount} 戻る / 進む` : `${amount} 動かす`
    }
    case 'jump':
      return '先頭 / 末尾へ飛ぶ'
  }
}

export type CutEditorKeyHelp = {
  readonly keys: string
  readonly action: string
  /** どちらの割り当てが受けたか。並べるときに分けたい場合に使う。 */
  readonly source: CutEditorCommand['source']
}

/**
 * 画面に出すキーの一覧を、**実際の判定から作る**。
 *
 * `cut-marks` の `CUT_MARK_KEY_HELP` と `playback-state` の `KEY_HINTS` を
 * そのまま並べてはいけない。重なった `←` `→` について両方が別の説明を持っており、
 * 並べると 2 つの矛盾した説明が同時に出る（lessons L-016）。
 */
export const describeCutEditorKeys = (): readonly CutEditorKeyHelp[] =>
  KEY_PROBES.flatMap((probe) => {
    const resolved = resolveCutEditorCommand(probe.event)
    if (resolved === null) return []
    const paired = PAIRED_LABELS.has(probe.label)
    return [
      {
        keys: probe.label,
        action:
          resolved.source === 'mark'
            ? describeMarkCommand(resolved.command)
            : describePlaybackCommand(resolved.command, paired),
        source: resolved.source,
      },
    ]
  })

/**
 * 再生側の割り当てのうち、この画面では区切りに取られて効かないもの。
 *
 * **黙って消さずに数えられるようにしておく。** どれが効かなくなったか分からないと、
 * 再生の一覧を見た人が「壊れている」と誤解する（lessons L-015）。
 */
export const shadowedPlaybackKeys = (): readonly string[] =>
  KEY_PROBES.filter((probe) => {
    const resolved = resolveCutEditorCommand(probe.event)
    return resolved?.source === 'mark' && keyToPlaybackCommand(probe.event) !== null
  }).map((probe) => probe.label)

/** 元の 2 つの一覧。取りこぼしが無いかをテストで突き合わせるために公開する。 */
export const SOURCE_KEY_HELP = {
  mark: CUT_MARK_KEY_HELP,
  playback: KEY_HINTS,
} as const

/** 微調整の幅。画面の数値入力の刻みに使う。 */
export const NUDGE_STEPS = {
  fineSec: FINE_NUDGE_SEC,
  coarseSec: COARSE_NUDGE_SEC,
} as const
