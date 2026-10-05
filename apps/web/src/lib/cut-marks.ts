import type { SnapCandidate, SnapTargetKind } from '@ixa/timeline'
import { snapTime } from '@ixa/timeline'
import { formatClock, formatDuration } from '@/lib/format-time'
import {
  buildSnapCandidates,
  describeSnapResult,
  snapToleranceSec,
  type BeatSource,
  type SnapNotice,
} from '@/lib/timeline-snap'

/**
 * 「ここからここまでが 1 カット」を決めるための**区切り（boundary）の集合**を扱う。
 * React を含まない純粋関数だけを置く。描画と再生は別のファイルの担当。
 *
 * **区切りは時刻の集合であって、カットの集合ではない。**
 * N 個の区切りから N-1 個のカットができ、隣り合う区切りがそのままカットの境界になる。
 * この形にしておくと、隙間も重なりも**構造的に作れない**。
 * カットを独立した区間として持つと、片方だけ動かして隙間を作れてしまう。
 *
 * **吸着の規則はここに書かない。** 正は `packages/timeline` の
 * `collectSnapCandidates` / `snapTime` / `snapToleranceSecForZoom` だけで、
 * その呼び出しは `@/lib/timeline-snap` が既に包んでいる。規則を書き写すと必ずズレる（L-016）。
 *
 * 時間は常に秒（float）。入力は一切変更せず、常に新しい配列を返す。
 */

// --- 定数 ---

/**
 * カットの最小の尺。**1 拍ぶん。**
 *
 * 実測した楽曲は 58 小節 / 4 拍で拍間隔が約 0.5 秒（拍間隔の標準偏差 0.019 秒）。
 * 区切りは拍へ吸着させるので、**1 拍より短い尺を許すと、吸着後に 2 つの区切りが
 * 同じ拍へ着地して尺 0 のカットができる**。最小を 1 拍にすれば、吸着で潰れることが無い。
 *
 * 映像側から見ても同じ結論になる。0.5 秒は 30fps で 15 フレームで、
 * これより短いカットは絵として読めない。さらに動画生成モデルの最短尺は 4 秒
 * （ADR-0011 / lessons L-002）なので、0.5 秒未満のカットは生成の単位としても意味を持たない。
 */
export const MIN_CUT_DURATION_SEC = 0.5

/** 微調整の幅（細かい / 粗い）。拍に載せ直すのではなく、載った拍から少しずらすための値。 */
export const FINE_NUDGE_SEC = 0.01
export const COARSE_NUDGE_SEC = 0.1

/**
 * 「同じ位置」と見なす幅。**float の等値比較の都合であって、吸着の許容距離ではない。**
 * 吸着の許容距離は `snapToleranceSec` がズーム率から出す。
 */
const POSITION_EPSILON_SEC = 1e-6

// --- 区切り ---

/**
 * 1 個の区切り。
 *
 * `snappedTo` は**置いたときに何へ吸着したか**。`null` は「吸着しなかった」。
 * 判定は必ずこのフィールドで行い、時刻が候補と一致するかでは行わない。
 * 吸着した結果たまたま元の値と同じになることがあるため（lessons L-015）。
 */
export type CutMark = {
  readonly atSec: number
  readonly snappedTo: SnapTargetKind | null
}

/** 昇順に並べ直す。入力は変更しない。 */
export const sortMarks = (marks: readonly CutMark[]): readonly CutMark[] =>
  [...marks].sort((a, b) => a.atSec - b.atSec)

/**
 * 外から来た区切りを昇順・重複なしにする。復元した状態など、
 * この画面が作ったとは限らない入力に使う。同じ位置が並んだら**先頭を残す**。
 */
export const normalizeMarks = (marks: readonly CutMark[]): readonly CutMark[] =>
  sortMarks(marks.filter((mark) => Number.isFinite(mark.atSec) && mark.atSec >= 0)).reduce<
    CutMark[]
  >((kept, mark) => {
    const last = kept.at(-1)
    if (last !== undefined && Math.abs(mark.atSec - last.atSec) <= POSITION_EPSILON_SEC) {
      return kept
    }
    return [...kept, mark]
  }, [])

// --- 追加 / 削除 / 移動 ---

/**
 * 変更できなかった理由。
 *
 * **同じ位置への追加は黙って無視せず、`duplicate` として断る。**
 * 音に合わせてキーを叩いている最中に何も起きないと、操作が効いていないのか
 * 既にそこに置いてあるのか区別できない。断って理由を出せば次の行動が決まる。
 */
export type MarkRejection =
  | { readonly reason: 'invalid'; readonly message: string }
  | { readonly reason: 'duplicate'; readonly message: string }
  | { readonly reason: 'too_close'; readonly message: string }
  | { readonly reason: 'missing'; readonly message: string }

export type MarkChangeResult =
  | {
      readonly ok: true
      readonly marks: readonly CutMark[]
      /** 操作後に選んでおくとよい区切りの位置。対象が無くなったときは -1。 */
      readonly index: number
    }
  | ({ readonly ok: false } & MarkRejection)

const reject = (rejection: MarkRejection): MarkChangeResult => ({ ok: false, ...rejection })

/** 追加・移動の可否を、自分以外の区切りとの距離だけで決める。 */
const checkPlacement = (
  others: readonly CutMark[],
  atSec: number,
  minDurationSec: number,
): MarkRejection | null => {
  if (!Number.isFinite(atSec) || atSec < 0) {
    return {
      reason: 'invalid',
      message: `区切りの位置は 0 以上の秒で指定してください: ${String(atSec)}`,
    }
  }
  for (const other of others) {
    const distance = Math.abs(other.atSec - atSec)
    if (distance <= POSITION_EPSILON_SEC) {
      return {
        reason: 'duplicate',
        message: `${formatClock(atSec)} には既に区切りがあります。`,
      }
    }
    // ちょうど最小の尺は許す。境界で弾くと、拍ぴったりに置いた区切りが入らなくなる。
    if (distance < minDurationSec - POSITION_EPSILON_SEC) {
      return {
        reason: 'too_close',
        message: `${formatClock(other.atSec)} の区切りに近すぎます。カットは ${formatDuration(minDurationSec)} 以上にしてください。`,
      }
    }
  }
  return null
}

const insertMark = (
  others: readonly CutMark[],
  mark: CutMark,
): { readonly marks: readonly CutMark[]; readonly index: number } => {
  const marks = sortMarks([...others, mark])
  return { marks, index: marks.findIndex((entry) => entry === mark) }
}

/** 区切りを 1 個足す。入力は変更しない。 */
export const addMark = (
  marks: readonly CutMark[],
  mark: CutMark,
  minDurationSec: number = MIN_CUT_DURATION_SEC,
): MarkChangeResult => {
  const rejection = checkPlacement(marks, mark.atSec, minDurationSec)
  if (rejection !== null) return reject(rejection)
  return { ok: true, ...insertMark(marks, mark) }
}

export type SectionMarksResult = {
  readonly marks: readonly CutMark[]
  /** 置けた本数。 */
  readonly added: number
  /** 既にある区切りと重なる・近すぎるので置かなかった本数。**黙って捨てない**ために数える。 */
  readonly skipped: number
}

/** 時刻の並びに区切りを置く（セクションの境目・歌い出し）。曲の頭と終わりには置かない。 */
const addMarksAt = (
  marks: readonly CutMark[],
  timesSec: readonly number[],
  snappedTo: 'section' | 'lyric' | 'narration',
  songDurationSec: number,
): SectionMarksResult =>
  timesSec
    .filter((atSec) => atSec >= MIN_CUT_DURATION_SEC && atSec <= songDurationSec - MIN_CUT_DURATION_SEC)
    .reduce<SectionMarksResult>(
      (current, atSec) => {
        const result = addMark(current.marks, { atSec, snappedTo })
        return result.ok
          ? { marks: result.marks, added: current.added + 1, skipped: current.skipped }
          : { ...current, skipped: current.skipped + 1 }
      },
      { marks, added: 0, skipped: 0 },
    )

/**
 * セクションの境目すべてに区切りを置く（制作者の要望 2026-09-26）。
 *
 * 以前の「セクションから割る」は 1 つのセクションの中を N 等分するもので、数秒しかない
 * セクションを割る場面が無かった。制作者は青い線を目印に 1 本ずつ置いていたので、一度に置く。
 * 置いたあとは普通の区切りなので消せる（セクション判定は外れることがある）。
 *
 * 曲の頭と終わりには置かない（もともと境界になる）。置けるかどうかは `addMark` の規則に従う。
 */
export const addSectionMarks = (
  marks: readonly CutMark[],
  boundariesSec: readonly number[],
  songDurationSec: number,
): SectionMarksResult => addMarksAt(marks, boundariesSec, 'section', songDurationSec)

/**
 * 歌い出しすべてに区切りを置く（制作者 2026-10-02「テロップを置いたってことは時間が割とはっきりするので、
 * 区切りもつけやすくなる」）。セクションの境目と同じ置き方。要らない区切りは普通に消せる。
 */
export const addLyricMarks = (
  marks: readonly CutMark[],
  cuesSec: readonly number[],
  songDurationSec: number,
): SectionMarksResult => addMarksAt(marks, cuesSec, 'lyric', songDurationSec)

/** ナレーションの話し始めすべてに区切りを置く（ADR-0038）。歌い出しと同じ置き方。 */
export const addNarrationMarks = (
  marks: readonly CutMark[],
  cuesSec: readonly number[],
  songDurationSec: number,
): SectionMarksResult => addMarksAt(marks, cuesSec, 'narration', songDurationSec)

/** ナレーションの切れ目にまとめて置いた結果の知らせ。**何も起きなかったときも理由を言う。** */
export const describeNarrationMarks = (result: SectionMarksResult): string => {
  if (result.added === 0) {
    return result.skipped === 0
      ? '置いたナレーションの行がまだありません。ナレーションの「再生位置から並べる」で置くと使えます。'
      : 'ナレーションの切れ目には、すでに区切りがあります。'
  }
  const skipped =
    result.skipped === 0 ? '' : `（${String(result.skipped)} 本は近くに区切りがあるので置きませんでした）`
  return `ナレーションの切れ目に区切りを ${String(result.added)} 本置きました${skipped}。`
}

/**
 * 曲の無い作品の区切り（ADR-0038）。先頭・各行の話し始め・最後の行の終わり。API へそのまま送れる境界の列。
 * 行の間の無音は前のカットに入れる。近すぎる境（`MIN_CUT_DURATION_SEC` 未満）は詰める。行が無ければ空。
 */
export const narrationCutBoundaries = (
  lines: readonly { readonly startSec: number; readonly durationSec: number }[],
): readonly number[] => {
  if (lines.length === 0) return []
  const endSec = Math.max(...lines.map((line) => line.startSec + line.durationSec))
  const starts = lines.map((line) => line.startSec).sort((a, b) => a - b)
  const inner = starts.reduce<readonly number[]>(
    (kept, atSec) => (atSec - (kept[kept.length - 1] ?? 0) >= MIN_CUT_DURATION_SEC ? [...kept, atSec] : kept),
    [0],
  )
  // 終わりが最後の境に近すぎれば、その境を外して前のカットに入れる。
  const last = inner[inner.length - 1] ?? 0
  const body = endSec - last >= MIN_CUT_DURATION_SEC || inner.length === 1 ? inner : inner.slice(0, -1)
  return [...body, endSec]
}

/** 歌い出しにまとめて置いた結果の知らせ。**何も起きなかったときも理由を言う。** */
export const describeLyricMarks = (result: SectionMarksResult): string => {
  if (result.added === 0) {
    return result.skipped === 0
      ? '歌詞の時刻がまだありません。「歌詞を合わせる」で歌い出しに時刻を付けると使えます。'
      : '歌い出しには、すでに区切りがあります。'
  }
  const skipped =
    result.skipped === 0
      ? ''
      : `（${String(result.skipped)} 本は近くに区切りがあるので置きませんでした）`
  return `歌い出しに区切りを ${String(result.added)} 本置きました${skipped}。`
}

/** まとめて置いた結果の知らせ。**何も起きなかったときも理由を言う。** */
export const describeSectionMarks = (result: SectionMarksResult): string => {
  if (result.added === 0) {
    return result.skipped === 0
      ? 'セクションの境目が見つかっていません（解析では曲全体が 1 つのセクションです）。'
      : 'セクションの境目には、すでに区切りがあります。'
  }
  const skipped =
    result.skipped === 0
      ? ''
      : `（${String(result.skipped)} 本は近くに区切りがあるので置きませんでした）`
  return `セクションの境目に区切りを ${String(result.added)} 本置きました${skipped}。`
}

/** 区切りを 1 個消す。消したあとは、同じ位置に来る区切り（無ければ最後）を選び直す。 */
export const removeMarkAt = (marks: readonly CutMark[], index: number): MarkChangeResult => {
  if (!Number.isInteger(index) || index < 0 || index >= marks.length) {
    return reject({ reason: 'missing', message: '消す区切りが選ばれていません。' })
  }
  const next = marks.filter((_, position) => position !== index)
  return { ok: true, marks: next, index: Math.min(index, next.length - 1) }
}

/** 区切りを動かす。並び順が入れ替わることがあるので、動かした先の位置を返す。 */
export const moveMark = (
  marks: readonly CutMark[],
  index: number,
  next: CutMark,
  minDurationSec: number = MIN_CUT_DURATION_SEC,
): MarkChangeResult => {
  if (!Number.isInteger(index) || index < 0 || index >= marks.length) {
    return reject({ reason: 'missing', message: '動かす区切りが選ばれていません。' })
  }
  const others = marks.filter((_, position) => position !== index)
  const rejection = checkPlacement(others, next.atSec, minDurationSec)
  if (rejection !== null) return reject(rejection)
  return { ok: true, ...insertMark(others, next) }
}

/** 選んでいる区切りを `deltaSec` だけずらす。ずらした時点で吸着は外れる。 */
export const nudgeMarkAt = (
  marks: readonly CutMark[],
  index: number,
  deltaSec: number,
  minDurationSec: number = MIN_CUT_DURATION_SEC,
): MarkChangeResult => {
  const current = marks[index]
  if (current === undefined) {
    return reject({ reason: 'missing', message: '動かす区切りが選ばれていません。' })
  }
  return moveMark(
    marks,
    index,
    { atSec: current.atSec + deltaSec, snappedTo: null },
    minDurationSec,
  )
}

// --- 区切りの探索 ---

/** `atSec` より前にある最も近い区切り。無ければ -1。 */
export const previousMarkIndex = (marks: readonly CutMark[], atSec: number): number => {
  let found = -1
  marks.forEach((mark, index) => {
    if (mark.atSec < atSec - POSITION_EPSILON_SEC) found = index
  })
  return found
}

/** `atSec` より後にある最も近い区切り。無ければ -1。 */
export const nextMarkIndex = (marks: readonly CutMark[], atSec: number): number =>
  marks.findIndex((mark) => mark.atSec > atSec + POSITION_EPSILON_SEC)

// --- カット ---

/** 区切り 2 個から決まる 1 カット。開始と尺は常に隣り合う区切りから導く。 */
export type Cut = {
  readonly index: number
  readonly startSec: number
  readonly durationSec: number
  /** このカットを始める区切り。**null は曲の頭**（区切りを置かなくても境界になる）。 */
  readonly startMark: CutMark | null
  /** このカットを終える区切り。**null は曲の終わり**。 */
  readonly endMark: CutMark | null
}

/**
 * 区切りの集合からカットの列を作る。**曲の頭と終わりも境界にする。**
 *
 * 以前は置いた区切りの「間」だけがカットになり、頭から最初の区切りまでと、最後の区切りから
 * 終わりまでが抜けた（区切り 4 本で 3 カット）。両端に毎回区切りを置かせるのは手間なだけで、
 * 置き忘れると書き出しで頭と尻が黒くなる。
 *
 * 頭・終わりから最短の尺（`MIN_CUT_DURATION_SEC`）未満の区切りは、短いカットを作らずに
 * 曲の頭・終わりとして扱う（隣のカットを端まで伸ばす）。区切りが 0 個なら何も作らない。
 * 曲まるごと 1 カットを黙って作ると、置き忘れと区別がつかない。
 */
export const buildCuts = (marks: readonly CutMark[], songDurationSec: number): readonly Cut[] => {
  const inner = sortMarks(marks).filter(
    (mark) =>
      mark.atSec >= MIN_CUT_DURATION_SEC &&
      mark.atSec <= songDurationSec - MIN_CUT_DURATION_SEC,
  )
  if (marks.length === 0) return []
  const edges: readonly (CutMark | null)[] = [null, ...inner, null]
  const timeOf = (index: number): number => {
    if (index === 0) return 0
    if (index === edges.length - 1) return songDurationSec
    return (edges[index] as CutMark).atSec
  }
  return edges.slice(0, -1).map((startMark, index) => ({
    index,
    startSec: timeOf(index),
    durationSec: timeOf(index + 1) - timeOf(index),
    startMark,
    endMark: edges[index + 1] ?? null,
  }))
}

/** API へ送る境界の列。曲の頭と終わりを含む。区切りが 0 個なら空。 */
export const cutBoundaries = (marks: readonly CutMark[], songDurationSec: number): readonly number[] => {
  const cuts = buildCuts(marks, songDurationSec)
  const last = cuts[cuts.length - 1]
  return last === undefined ? [] : [...cuts.map((cut) => cut.startSec), last.startSec + last.durationSec]
}

/**
 * カットの一覧を出すための状態。
 *
 * **「区切りが 0 個」「区切りが 1 個」「読み込めていない」を混ぜない。**
 * どれもカットは 0 件だが、利用者が取るべき次の行動が違う。同じ見た目にすると、
 * あと 1 個置けば済む状態を壊れていると誤解させる（lessons L-015）。
 */
export type CutsOutcome =
  | { readonly state: 'unreadable' }
  | { readonly state: 'no_marks' }
  | { readonly state: 'cuts'; readonly cuts: readonly Cut[] }

export const describeCuts = (
  marks: readonly CutMark[] | null,
  songDurationSec: number,
): CutsOutcome => {
  if (marks === null) return { state: 'unreadable' }
  if (marks.length === 0) return { state: 'no_marks' }
  return { state: 'cuts', cuts: buildCuts(marks, songDurationSec) }
}

// --- 吸着 ---

/** 区切りを置くときの吸着候補。Shot もクリップもまだ無い画面なので、材料は楽曲だけ。 */
export const buildCutMarkCandidates = (
  beatSource: BeatSource,
  timelineEndSec: number,
  /** 歌詞の歌い出し。区切りを歌い出しに寄せる（制作者 2026-10-02）。 */
  lyricCues: readonly number[] = [],
  /** ナレーションの話し始め（ADR-0038）。区切りを言葉の切れ目に寄せる。 */
  narrationCues: readonly number[] = [],
): readonly SnapCandidate[] =>
  buildSnapCandidates({ shots: [], clips: [], beatSource, timelineEndSec, lyricCues, narrationCues }, {})

/** ズーム率から吸着の許容距離を出す。規則は `packages/timeline` 側にある。 */
export const cutMarkToleranceSec = (pixelsPerSecond: number): number =>
  snapToleranceSec(pixelsPerSecond)

export type MarkSnapOutcome = {
  readonly mark: CutMark
  readonly notice: SnapNotice
}

/**
 * 置こうとしている時刻を候補へ寄せる。`enabled` が false なら寄せない。
 *
 * **吸着したかどうかは `snapTime` の `snappedTo` だけで決める。**
 * 値が変わったかでは決めない（lessons L-015）。
 */
export const snapMarkTime = (
  atSec: number,
  candidates: readonly SnapCandidate[],
  toleranceSec: number,
  enabled: boolean,
): MarkSnapOutcome => {
  if (!enabled) {
    return {
      mark: { atSec, snappedTo: null },
      notice: {
        state: 'off',
        label: '区切り',
        message: `吸着は切ってあります。${formatClock(atSec)} にそのまま置きました`,
      },
    }
  }
  const result = snapTime(atSec, candidates, toleranceSec)
  return {
    mark: { atSec: result.atSec, snappedTo: result.snappedTo?.kind ?? null },
    notice: describeSnapResult('区切り', atSec, result),
  }
}

// --- キーボード操作 ---

/**
 * キー入力から決まる操作。**キーの割り当てはここだけが知っている。**
 * 画面側は返ってきた操作を実行するだけにして、押しやすさの調整を 1 箇所で済ませる。
 */
export type CutMarkCommand =
  | { readonly type: 'place_mark' }
  | { readonly type: 'remove_previous_mark' }
  | { readonly type: 'remove_selected_mark' }
  | { readonly type: 'select_previous_mark' }
  | { readonly type: 'select_next_mark' }
  | { readonly type: 'nudge_selected_mark'; readonly deltaSec: number }
  | { readonly type: 'toggle_snap' }

/** 判定に必要なぶんだけのキーイベント。DOM の型に縛らず、node でもテストできるようにする。 */
export type KeyTargetLike = {
  readonly tagName: string
  readonly isContentEditable: boolean
}

export type KeyEventLike = {
  readonly key: string
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly target: KeyTargetLike | null
}

const TYPING_TAGS: readonly string[] = ['INPUT', 'TEXTAREA', 'SELECT']

/**
 * 文字を打っている最中か。**打っている間はショートカットを効かせない。**
 * 数値で微調整する欄に `s` と打っただけで区切りが増えると、値を直せなくなる。
 */
export const isTypingTarget = (target: KeyTargetLike | null): boolean => {
  if (target === null) return false
  return target.isContentEditable || TYPING_TAGS.includes(target.tagName.toUpperCase())
}

/**
 * キー入力を操作へ変換する。当てはまらなければ null。
 *
 * 音に合わせて叩くので、**区切りを置くキーは大きく中央にある** ものを選ぶ。
 * Enter と `s`（split）の 2 つを受けるのは、再生を止める Space から指を離さずに
 * 打てる位置と、マウスに手を置いたまま打てる位置の両方を用意するため。
 * 取り消しは Backspace。Enter の隣にあり、叩き間違いを最小の動きで戻せる。
 *
 * `←` `→` は**区切りの間を移動**、修飾キー付きは**選んだ区切り自体を動かす**。
 * 「素の矢印は選択を動かす / 修飾つきは対象を動かす」で揃えてある。
 *
 * Ctrl / Cmd 付きはブラウザとアプリの操作なので、こちらでは受け取らない。
 */
export const resolveCutMarkCommand = (event: KeyEventLike): CutMarkCommand | null => {
  if (isTypingTarget(event.target)) return null
  if (event.ctrlKey || event.metaKey) return null

  switch (event.key) {
    case 'Enter':
    case 's':
    case 'S':
      return { type: 'place_mark' }
    case 'Backspace':
      return { type: 'remove_previous_mark' }
    case 'Delete':
    case 'x':
    case 'X':
      return { type: 'remove_selected_mark' }
    case 'n':
    case 'N':
      return { type: 'toggle_snap' }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const sign = event.key === 'ArrowLeft' ? -1 : 1
      if (event.shiftKey) return { type: 'nudge_selected_mark', deltaSec: sign * FINE_NUDGE_SEC }
      if (event.altKey) return { type: 'nudge_selected_mark', deltaSec: sign * COARSE_NUDGE_SEC }
      return sign < 0 ? { type: 'select_previous_mark' } : { type: 'select_next_mark' }
    }
    default:
      return null
  }
}

export type KeyHelpEntry = {
  readonly keys: string
  readonly description: string
}

/** 画面に出す割り当て表。実装と表示がズレないよう、同じファイルに置く。 */
export const CUT_MARK_KEY_HELP: readonly KeyHelpEntry[] = [
  { keys: 'Enter / S', description: 'いまの再生位置に区切りを置く' },
  { keys: 'Backspace', description: '再生位置の直前にある区切りを消す' },
  { keys: 'Delete / X', description: '選んでいる区切りを消す' },
  { keys: '← / →', description: '前 / 次の区切りへ移る' },
  {
    keys: 'Shift + ← / →',
    description: `選んでいる区切りを ${formatDuration(FINE_NUDGE_SEC)} 動かす`,
  },
  {
    keys: 'Alt + ← / →',
    description: `選んでいる区切りを ${formatDuration(COARSE_NUDGE_SEC)} 動かす`,
  },
  { keys: 'N', description: '吸着を入れる / 切る' },
]
