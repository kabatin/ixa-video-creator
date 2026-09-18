import { formatClock, formatDuration } from '@/lib/format-time'

/**
 * 波形と目印を描くための計算。**canvas も React も含まない純粋関数だけを置く。**
 *
 * 描画そのもの（`CanvasRenderingContext2D` の操作）は `waveform-canvas.tsx` にある。
 * ここが持つのは「どこに」「どれを」描くかの判断だけで、テストはこの層で行う。
 *
 * 時間は常に秒（float）。入力は一切変更せず、常に新しい値を返す。
 */

// --- 表示範囲 ---

/** 画面に映している時間の窓。`startSec` は常に `endSec` より小さい。 */
export type ViewRange = {
  readonly startSec: number
  readonly endSec: number
}

/**
 * これ以上は寄れない幅。
 * 1 拍が 0.5 秒（120BPM）なので、0.25 秒あれば半拍が画面幅いっぱいになる。
 * これより寄っても波形の点（曲全体で 2000 点）は増えず、拡大されるだけになる。
 */
export const MIN_VIEW_SPAN_SEC = 0.25

const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const clampInt = (value: number, min: number, max: number): number =>
  Math.min(Math.max(Math.trunc(value), min), max)

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? clampNumber(value, 0, 1) : 0

export const viewDurationSec = (view: ViewRange): number => view.endSec - view.startSec

/** 曲全体を映す窓。 */
export const fullView = (durationSec: number): ViewRange => ({
  startSec: 0,
  endSec: Math.max(Number.isFinite(durationSec) ? durationSec : 0, MIN_VIEW_SPAN_SEC),
})

/**
 * 窓を曲の中に収める。
 *
 * **画面側でクランプしないこと。** 以前ここを呼ばずにズームすると、
 * 曲の終わりを越えた空白を延々とスクロールできてしまった。
 * 非有限な値（0 除算や未初期化）が来たときも全体表示へ畳む。
 */
export const clampView = (view: ViewRange, durationSec: number): ViewRange => {
  const total = Math.max(Number.isFinite(durationSec) ? durationSec : 0, MIN_VIEW_SPAN_SEC)
  if (!Number.isFinite(view.startSec) || !Number.isFinite(view.endSec)) {
    return { startSec: 0, endSec: total }
  }
  const span = clampNumber(viewDurationSec(view), MIN_VIEW_SPAN_SEC, total)
  const startSec = clampNumber(view.startSec, 0, total - span)
  return { startSec, endSec: startSec + span }
}

// --- 秒と座標の往復 ---

export const pixelsPerSecond = (view: ViewRange, widthPx: number): number => {
  const span = viewDurationSec(view)
  if (!(span > 0) || !(widthPx > 0)) return 0
  return widthPx / span
}

/** 秒 → x 座標。窓の外なら 0 未満か `widthPx` 超になる。丸めない。 */
export const timeToX = (sec: number, view: ViewRange, widthPx: number): number => {
  const span = viewDurationSec(view)
  if (!(span > 0)) return 0
  return ((sec - view.startSec) / span) * widthPx
}

/** x 座標 → 秒。掴んだ位置を時刻に戻すときに使う。 */
export const xToTime = (x: number, view: ViewRange, widthPx: number): number => {
  if (!(widthPx > 0)) return view.startSec
  return view.startSec + (x / widthPx) * viewDurationSec(view)
}

// --- 目印の種類と見た目 ---

export type MarkerKind = 'section' | 'beat' | 'downbeat' | 'drop'

/** 縦線の基準。`center` は中央から上下へ、`top` は上端から下へ伸ばす。 */
export type MarkerAnchor = 'center' | 'top'

/**
 * 線の形だけ。**色はここに持たない**（`WaveformPalette` が持つ）。
 * canvas には CSS のクラスが効かないので、色は描く時点でテーマから解決して渡す。
 */
export type MarkerStyle = {
  /** CSS px。描画時に devicePixelRatio を掛ける。 */
  readonly lineWidthPx: number
  /** 点線の `[描く, 空ける]`（CSS px）。`null` は実線。 */
  readonly dashPx: readonly [number, number] | null
  readonly anchor: MarkerAnchor
  /** 縦の占有率。1 で全高。 */
  readonly heightRatio: number
  /** この間隔より詰まったら間引く（CSS px）。0 は間引かない。 */
  readonly minSpacingPx: number
  /** 上端に置く印。色以外の手がかりとして使う。 */
  readonly capMarker: 'none' | 'triangle'
  readonly label: string
}

/**
 * 目印の見た目。**色だけで区別させない。**
 * 4 種類は「置く位置・高さ・線種・太さ・上端の印」の組み合わせで互いに違う。
 * 色が見えない利用者でも、線を見れば何の印か分かる必要がある。
 * この不変条件は `waveform-draw.test.ts` が守っている。
 *
 * セクションの境目だけ上端の短い目盛りにしてある。
 * 自動判定の精度が低く当てにできないため、**残すが波形には重ねない**（制作者の指示）。
 */
export const MARKER_STYLES: Readonly<Record<MarkerKind, MarkerStyle>> = Object.freeze({
  section: Object.freeze({
    lineWidthPx: 1,
    dashPx: null,
    anchor: 'top',
    heightRatio: 0.12,
    minSpacingPx: 4,
    capMarker: 'none',
    label: 'セクションの境目',
  }),
  beat: Object.freeze({
    lineWidthPx: 1,
    dashPx: Object.freeze([1.5, 2] as const),
    anchor: 'center',
    heightRatio: 0.34,
    minSpacingPx: 7,
    capMarker: 'none',
    label: '拍',
  }),
  downbeat: Object.freeze({
    lineWidthPx: 1.5,
    dashPx: null,
    anchor: 'center',
    heightRatio: 0.56,
    minSpacingPx: 12,
    capMarker: 'none',
    label: '小節',
  }),
  drop: Object.freeze({
    lineWidthPx: 2.5,
    dashPx: null,
    anchor: 'center',
    heightRatio: 1,
    // 曲の転換点は切りどころの候補そのもの。数も少ないので決して間引かない。
    minSpacingPx: 0,
    capMarker: 'triangle',
    label: 'ドロップ',
  }),
})

/** 奥から手前へ。ドロップが最後、つまり必ず一番上に乗る。 */
export const MARKER_DRAW_ORDER: readonly MarkerKind[] = Object.freeze([
  'section',
  'beat',
  'downbeat',
  'drop',
])

// --- 色 ---

/**
 * 描くときの色。**canvas に Tailwind のクラスは効かない**ので、
 * 役割の名前から実際の色へ解決した結果を、描く側（`waveform-canvas.tsx`）が渡す。
 *
 * この層は `document` に触らない。純粋なまま保つための引数である。
 */
export type WaveformPalette = {
  readonly background: string
  readonly wave: string
  readonly marker: Readonly<Record<MarkerKind, string>>
}

/**
 * どの役割の色を使うか。**割り当ての正はここ 1 箇所。**
 * 値そのものは `app/globals.css` のトークンが持ち、ダーク／ライトで差し替わる。
 * 解決（`getComputedStyle`）は描く側の仕事で、この層は名前しか知らない。
 */
export const WAVEFORM_COLOR_TOKENS = Object.freeze({
  background: 'surface-2',
  wave: 'muted',
  marker: Object.freeze({
    section: 'info',
    beat: 'faint',
    downbeat: 'text',
    drop: 'accent',
  } satisfies Record<MarkerKind, string>),
})

/**
 * 波形の柱の不透明度。目印の線より後ろへ下げるために透かす。
 * 塗り潰すと拍と小節が波形に埋もれ、切りどころが読めなくなる。
 */
export const WAVE_FILL_ALPHA = 0.6

/**
 * トークンを読めないときの控え（ダークの値）。
 *
 * サーバ側の描画と、`getComputedStyle` が使えない環境で使う。
 * **値の正は `app/globals.css`。** ここが効くのは読めなかったときだけで、
 * ズレても「最初の 1 フレームだけ少し違う」で済む（`--muted` などが変われば追随しない）。
 */
export const DEFAULT_WAVEFORM_PALETTE: WaveformPalette = Object.freeze({
  background: 'rgb(26 33 42)',
  wave: `rgb(154 164 178 / ${String(WAVE_FILL_ALPHA)})`,
  marker: Object.freeze({
    section: 'rgb(96 165 250)',
    beat: 'rgb(108 120 138)',
    downbeat: 'rgb(230 234 240)',
    drop: 'rgb(255 210 0)',
  }),
})

/** 縦線が占める範囲（上端 y, 下端 y）。単位は呼び出し側の高さに合わせる。 */
export const markerSegment = (style: MarkerStyle, heightPx: number): readonly [number, number] => {
  const ratio = clamp01(style.heightRatio)
  if (style.anchor === 'top') return [0, heightPx * ratio]
  const half = (heightPx * ratio) / 2
  return [heightPx / 2 - half, heightPx / 2 + half]
}

// --- 間引き ---

/**
 * 残す間隔の候補。**拍を 3 個おきに残さない。**
 * 2 の冪だけにすることで、間引いても拍・8 分・小節という音楽的な区切りに揃う。
 */
export const MUSICAL_STRIDES: readonly number[] = Object.freeze([1, 2, 4, 8, 16, 32])

/**
 * 何個おきに残すかを決める。
 * 平均間隔（全体の端から端を個数で割る）が `minSpacingPx` を下回るまで間引く。
 */
export const markerStride = (
  times: readonly number[],
  pxPerSec: number,
  minSpacingPx: number,
): number => {
  if (times.length < 2 || !(minSpacingPx > 0) || !(pxPerSec > 0)) return 1
  const first = times[0] as number
  const last = times[times.length - 1] as number
  const intervalSec = (last - first) / (times.length - 1)
  if (!(intervalSec > 0)) return 1
  const needed = minSpacingPx / (intervalSec * pxPerSec)
  return MUSICAL_STRIDES.find((stride) => stride >= needed) ?? (MUSICAL_STRIDES.at(-1) as number)
}

/** 拍と小節が同じ値を指しているとみなす許容差。解析器は同一の値を返すので十分小さくてよい。 */
export const BEAT_MATCH_EPSILON_SEC = 1e-6

/**
 * 拍を間引くときの起点。
 *
 * 単純に 0 番目から数えると、残った拍が小節線と噛み合わず、
 * 2 種類の線が互い違いに並んで**拍子が読めない絵**になる。
 * 最初の小節線と一致する拍を起点にすることで、間引いても両者が重なる。
 */
export const beatGridAnchor = (
  beats: readonly number[],
  downbeats: readonly number[],
): number => {
  const first = downbeats[0]
  if (first === undefined) return 0
  const index = beats.findIndex((beat) => Math.abs(beat - first) < BEAT_MATCH_EPSILON_SEC)
  return index < 0 ? 0 : index
}

const modPositive = (value: number, modulus: number): number =>
  ((value % modulus) + modulus) % modulus

export type MarkerPick = {
  readonly kind: MarkerKind
  /** 実際に描く時刻。昇順。 */
  readonly times: readonly number[]
  /** 何個おきに残したか。1 なら間引いていない。 */
  readonly stride: number
  /** 窓の中にありながら間引きで落とした数。**0 でないなら利用者に伝えること。** */
  readonly hiddenCount: number
}

/** 線の太さぶんはみ出した目印も描く。端で線が消えて見えるのを防ぐ。 */
const EDGE_PAD_PX = 3

/**
 * 窓に入る目印を選び、密度に応じて間引く。
 *
 * 間引きの規則はこれだけ。
 * 1. 平均間隔が種類ごとの `minSpacingPx` を満たすまで、2 の冪で間隔を広げる
 * 2. 起点（拍なら最初の小節線）から数えて `stride` の倍数だけ残す
 * 3. 落とした数は `hiddenCount` に残す。黙って消さない
 */
export const pickMarkers = (
  kind: MarkerKind,
  times: readonly number[],
  view: ViewRange,
  widthPx: number,
  anchorIndex = 0,
): MarkerPick => {
  const style = MARKER_STYLES[kind]
  const pxPerSec = pixelsPerSecond(view, widthPx)
  const stride = markerStride(times, pxPerSec, style.minSpacingPx)
  const padSec = pxPerSec > 0 ? EDGE_PAD_PX / pxPerSec : 0
  const from = view.startSec - padSec
  const to = view.endSec + padSec

  const kept: number[] = []
  let visible = 0
  times.forEach((time, index) => {
    if (time < from || time > to) return
    visible += 1
    if (modPositive(index - anchorIndex, stride) === 0) kept.push(time)
  })

  return { kind, times: kept, stride, hiddenCount: visible - kept.length }
}

// --- セクションの境目 ---

/** `MusicSection` が構造的に満たす形。domain へ依存させないためにここで受ける。 */
export type SectionSpan = {
  readonly start: number
  readonly end: number
}

/**
 * セクションの境目。**先頭の 0 秒は落とす。** 曲の始まりは境目ではないため、
 * 描くと左端に意味のない線が 1 本残る。
 */
export const sectionBoundaries = (sections: readonly SectionSpan[]): readonly number[] => {
  const all = sections.flatMap((section) => [section.start, section.end])
  const sorted = [...all].filter((sec) => Number.isFinite(sec) && sec > 0).sort((a, b) => a - b)
  return sorted.filter(
    (sec, index) => index === 0 || Math.abs(sec - (sorted[index - 1] as number)) >= BEAT_MATCH_EPSILON_SEC,
  )
}

// --- 波形の柱 ---

/**
 * 列ごとの振幅（0〜1）。列は画面の 1 デバイスピクセルに対応する。
 *
 * 1 列に複数の点が入るときは**最大値**を採る。平均だと、引いて見たときに
 * 立ち上がりが均されて曲の勢いが消える。
 */
export const peakColumns = (
  peaks: readonly number[],
  view: ViewRange,
  durationSec: number,
  columnCount: number,
): readonly number[] => {
  const span = viewDurationSec(view)
  if (peaks.length === 0 || !(columnCount > 0) || !(durationSec > 0) || !(span > 0)) return []
  const perSec = peaks.length / durationSec

  return Array.from({ length: Math.trunc(columnCount) }, (_, column) => {
    const fromSec = view.startSec + (span * column) / columnCount
    const toSec = view.startSec + (span * (column + 1)) / columnCount
    const start = clampInt(Math.floor(fromSec * perSec), 0, peaks.length - 1)
    const end = Math.max(start + 1, clampInt(Math.ceil(toSec * perSec), 0, peaks.length))
    let max = 0
    for (let i = start; i < end; i += 1) {
      const value = peaks[i]
      if (value !== undefined && value > max) max = value
    }
    return clamp01(max)
  })
}

// --- 文字での説明 ---

export type WaveformSummary = {
  readonly view: ViewRange
  readonly durationSec: number
  /** 取得した波形の点数。0 は「取れなかった」ではなく「点が 0 個」。 */
  readonly peakCount: number
  readonly picks: readonly MarkerPick[]
}

/**
 * canvas は読み上げに乗らない。**描いた内容を必ず文字でも出す。**
 *
 * 間引いた事実も必ず書く。書かないと「拍が 116 個しかない曲」に読めてしまう
 * （見えていないものを見えていないと言わない集計は嘘になる。lessons L-015）。
 */
export const describeWaveform = (summary: WaveformSummary): string => {
  const { view, durationSec, peakCount, picks } = summary
  const range = `${formatClock(view.startSec)} から ${formatClock(view.endSec)}`
  const span = formatDuration(viewDurationSec(view))
  const head =
    peakCount === 0
      ? `波形の点が 0 個のため、目印だけを表示しています。曲全体は ${formatDuration(durationSec)}。`
      : `波形。曲全体 ${formatDuration(durationSec)} のうち ${range}（${span}）を表示中。`

  const parts = picks.map((pick) => {
    const style = MARKER_STYLES[pick.kind]
    const drawn = `${style.label} ${String(pick.times.length)} 個`
    if (pick.hiddenCount === 0) return drawn
    return `${drawn}（${String(pick.stride)} 個に 1 本まで間引き、${String(pick.hiddenCount)} 個は非表示）`
  })

  return parts.length === 0 ? head : `${head}${parts.join('、')}。`
}
