'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatClock, formatDuration } from '@/lib/format-time'
import { useElementWidth } from '@/lib/use-element-width'
import { THEME_ATTRIBUTE } from '@/lib/theme'
import type { WaveformPeaksResult } from '@/lib/waveform-api'
import { peaksOf } from '@/lib/waveform-api'
import { HelpDisclosure } from '@/components/ui/help-disclosure'
import {
  BAND_HEIGHT_RATIO,
  BAND_ORDER,
  RULER_HEIGHT_PX,
  WAVEFORM_HEIGHT_PX,
  sectionStripes,
  seriesColumns,
  stretchBands,
  stretchSeries,
  type BandName,
} from '@/lib/waveform-bands'
import {
  DEFAULT_WAVEFORM_PALETTE,
  MARKER_STYLES,
  WAVEFORM_COLOR_TOKENS,
  WAVE_FILL_ALPHA,
  BAND_FILL_ALPHA,
  STRIPE_ALPHA,
  beatGridAnchor,
  clampView,
  describeWaveform,
  fullView,
  markerSegment,
  peakColumns,
  pickMarkers,
  timeToX,
  viewDurationSec,
  type MarkerKind,
  type MarkerPick,
  type MarkerStyle,
  type ViewRange,
  type WaveformPalette,
} from '@/lib/waveform-draw'

/**
 * 波形と目印を描く（P56-2）。
 *
 * **描くだけの部品。** 再生位置・イン点/アウト点の操作は担当が別なので、
 * この部品は入力を受け取らない。重ねたいものは `children` に渡す
 * （包む要素が `position: relative` なので、`left: %` で時刻に合わせられる）。
 *
 * 2000 点を DOM 要素で描くと重いので `<canvas>` を使う。
 * canvas は読み上げに乗らないため、`role="img"` と `aria-label` で
 * 描いた内容を文字にし、凡例でも線の形を示す。
 */

/** 波形が上下いっぱいに触れないようにする。目印の上端の印と重なって読めなくなるため。 */
const WAVE_VERTICAL_FILL = 0.88

export type WaveformCanvasProps = {
  /** 取得結果をそのまま渡す。**空配列に畳まないこと**（取得失敗と 0 点が混ざる）。 */
  readonly peaks: WaveformPeaksResult
  readonly durationSec: number
  /** 表示範囲。省略すると曲全体。ズームは呼び出し側がこの値を動かして行う。 */
  readonly view?: ViewRange
  readonly beats: readonly number[]
  readonly downbeats: readonly number[]
  readonly drops: readonly number[]
  readonly sectionBoundarySec: readonly number[]
  readonly heightPx?: number
  /** 下の行（表示範囲・読み方）を出さない。タイムラインの帯の中に置くとき（PHASE 8.4）。 */
  readonly compact?: boolean
  /** 再生位置などの重ね描き。 */
  readonly children?: ReactNode
}

// --- 計測 ---

/** キャンバスの幅の画素数の上限。ブラウザの上限（約 32767）より余裕を持たせる。 */
const MAX_CANVAS_WIDTH_PX = 16_384

/**
 * 端末の解像度。**これを見ないと波形が滲む。**
 * 外部ディスプレイへ移すと値が変わるので、変化も拾い直す。
 */
const useDevicePixelRatio = (): number => {
  const [ratio, setRatio] = useState(1)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let media: MediaQueryList | null = null
    const sync = (): void => {
      const next = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
      setRatio(next)
      media?.removeEventListener('change', sync)
      media = window.matchMedia(`(resolution: ${String(next)}dppx)`)
      media.addEventListener('change', sync)
    }
    sync()
    return () => {
      media?.removeEventListener('change', sync)
    }
  }, [])

  return ratio
}

// --- 色の解決 ---

/**
 * トークン 1 つを canvas が読める色にする。
 * `globals.css` は値を `R G B` の 3 つ組で持つので、そのまま `rgb()` に入れられる。
 * 読めなければ `null` を返し、呼び出し側が控えへ落ちる。
 */
const readTokenColor = (
  styles: CSSStyleDeclaration,
  token: string,
  alpha?: number,
): string | null => {
  const rgb = styles.getPropertyValue(`--${token}`).trim()
  if (rgb === '') return null
  return alpha === undefined ? `rgb(${rgb})` : `rgb(${rgb} / ${String(alpha)})`
}

const resolvePalette = (root: HTMLElement): WaveformPalette => {
  const styles = getComputedStyle(root)
  const fallback = DEFAULT_WAVEFORM_PALETTE
  const marker = (kind: MarkerKind): string =>
    readTokenColor(styles, WAVEFORM_COLOR_TOKENS.marker[kind]) ?? fallback.marker[kind]

  return {
    background: readTokenColor(styles, WAVEFORM_COLOR_TOKENS.background) ?? fallback.background,
    wave: readTokenColor(styles, WAVEFORM_COLOR_TOKENS.wave, WAVE_FILL_ALPHA) ?? fallback.wave,
    marker: {
      section: marker('section'),
      beat: marker('beat'),
      downbeat: marker('downbeat'),
      drop: marker('drop'),
    },
    bands: {
      low:
        readTokenColor(styles, WAVEFORM_COLOR_TOKENS.bands.low, BAND_FILL_ALPHA) ??
        fallback.bands.low,
      mid:
        readTokenColor(styles, WAVEFORM_COLOR_TOKENS.bands.mid, BAND_FILL_ALPHA) ??
        fallback.bands.mid,
      high:
        readTokenColor(styles, WAVEFORM_COLOR_TOKENS.bands.high, BAND_FILL_ALPHA) ??
        fallback.bands.high,
    },
    stripe: readTokenColor(styles, WAVEFORM_COLOR_TOKENS.stripe, STRIPE_ALPHA) ?? fallback.stripe,
  }
}

/**
 * いま効いている色。**最初の描画では `document` を読まない**（サーバに無い。lessons L-019）。
 * 読むのは `useEffect` の中だけで、それまでは既定のダークで描く。
 *
 * テーマは `<html data-theme>` を書き換えて切り替わる。canvas は CSS が届かないので、
 * 属性を見張って**自分で描き直す**。見張らないと、切り替えても波形だけ前の色のまま残る。
 */
const useWaveformPalette = (): WaveformPalette => {
  const [palette, setPalette] = useState<WaveformPalette>(DEFAULT_WAVEFORM_PALETTE)

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const sync = (): void => {
      setPalette(resolvePalette(root))
    }
    sync()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: [THEME_ATTRIBUTE] })
    return () => {
      observer.disconnect()
    }
  }, [])

  return palette
}

// --- canvas への描画 ---

/**
 * 縦線 1 本。`fillRect` で描くのは、`stroke` だと半ピクセルずれて滲むため。
 * 座標・太さ・破線の刻みはすべてデバイスピクセル。
 */
const fillVerticalLine = (
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  bottom: number,
  widthDev: number,
  dashDev: readonly [number, number] | null,
): void => {
  const w = Math.max(1, Math.round(widthDev))
  const left = Math.round(x) - Math.floor(w / 2)
  if (dashDev === null) {
    ctx.fillRect(left, top, w, bottom - top)
    return
  }
  const [on, off] = dashDev
  const step = Math.max(1, on + off)
  for (let y = top; y < bottom; y += step) {
    ctx.fillRect(left, y, w, Math.min(on, bottom - y))
  }
}

const fillTriangleCap = (ctx: CanvasRenderingContext2D, x: number, sizeDev: number): void => {
  ctx.beginPath()
  ctx.moveTo(Math.round(x) - sizeDev, 0)
  ctx.lineTo(Math.round(x) + sizeDev, 0)
  ctx.lineTo(Math.round(x), sizeDev * 1.5)
  ctx.closePath()
  ctx.fill()
}

type DrawParams = {
  /** 振幅（帯域が無い古い解析のときだけ使う）。引き伸ばし済み。 */
  readonly columns: readonly number[]
  /** 3 帯域の列（引き伸ばし済み）。null なら振幅だけで描く。 */
  readonly bandColumns: Readonly<Record<BandName, readonly number[]>> | null
  readonly stripes: readonly (readonly [number, number, 0 | 1])[]
  readonly picks: readonly MarkerPick[]
  readonly view: ViewRange
  readonly widthDev: number
  readonly heightDev: number
  readonly rulerDev: number
  readonly dpr: number
  readonly palette: WaveformPalette
}

/**
 * 目印（UI-WORKBENCH-2 §3.2）。**波の上に線を重ねない。**
 * 小節頭・セクションの境目・ドロップは上の帯（ruler）に刻む。
 * 拍は間引かずに描ける近さ（1 本ずつ 7px 以上空く）のときだけ、波の上に薄く描く。
 */
const drawMarkers = (ctx: CanvasRenderingContext2D, params: DrawParams): void => {
  const byKind = new Map<MarkerKind, MarkerPick>(params.picks.map((pick) => [pick.kind, pick]))
  const ruler = params.rulerDev
  const tick = (kind: MarkerKind, top: number, bottom: number, widthPx: number): void => {
    const pick = byKind.get(kind)
    if (pick === undefined) return
    ctx.fillStyle = params.palette.marker[kind]
    for (const time of pick.times) {
      fillVerticalLine(
        ctx,
        timeToX(time, params.view, params.widthDev),
        top,
        bottom,
        widthPx * params.dpr,
        null,
      )
    }
  }

  const beats = byKind.get('beat')
  if (beats !== undefined && beats.stride === 1) {
    const style = MARKER_STYLES.beat
    const dash =
      style.dashPx === null
        ? null
        : ([style.dashPx[0] * params.dpr, style.dashPx[1] * params.dpr] as const)
    ctx.fillStyle = params.palette.marker.beat
    for (const time of beats.times) {
      fillVerticalLine(
        ctx,
        timeToX(time, params.view, params.widthDev),
        ruler,
        params.heightDev,
        params.dpr,
        dash,
      )
    }
  }
  tick('downbeat', ruler * 0.5, ruler, 1)
  tick('section', 0, ruler, 1.5)

  const drops = byKind.get('drop')
  if (drops !== undefined) {
    ctx.fillStyle = params.palette.marker.drop
    for (const time of drops.times)
      fillTriangleCap(ctx, timeToX(time, params.view, params.widthDev), 4 * params.dpr)
  }
}

/** 中心から上下対称に 1 列ずつ塗る。 */
const fillMirrored = (
  ctx: CanvasRenderingContext2D,
  values: readonly number[],
  middle: number,
  maxHeight: number,
): void => {
  values.forEach((value, column) => {
    const height = Math.max(1, value * maxHeight)
    ctx.fillRect(column, middle - height / 2, 1, height)
  })
}

const draw = (canvas: HTMLCanvasElement, params: DrawParams): boolean => {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return false

  ctx.clearRect(0, 0, params.widthDev, params.heightDev)
  ctx.fillStyle = params.palette.background
  ctx.fillRect(0, 0, params.widthDev, params.heightDev)

  // セクションは面で見せる。交互に薄く敷く（線を重ねない）。
  ctx.fillStyle = params.palette.stripe
  params.stripes.forEach(([start, end, parity]) => {
    if (parity === 0) return
    const left = timeToX(start, params.view, params.widthDev)
    const right = timeToX(end, params.view, params.widthDev)
    ctx.fillRect(left, 0, right - left, params.heightDev)
  })

  const waveTop = params.rulerDev
  const waveHeight = params.heightDev - waveTop
  const middle = waveTop + waveHeight / 2
  const usable = waveHeight * WAVE_VERTICAL_FILL

  if (params.bandColumns === null) {
    ctx.fillStyle = params.palette.wave
    fillMirrored(ctx, params.columns, middle, usable)
  } else {
    for (const band of BAND_ORDER) {
      ctx.fillStyle = params.palette.bands[band]
      fillMirrored(ctx, params.bandColumns[band], middle, usable * BAND_HEIGHT_RATIO[band])
    }
  }

  drawMarkers(ctx, params)
  return true
}

// --- 凡例 ---

/** 凡例の見本が短すぎて線種が読めなくなる下限。実機で 2px の見本は点にしか見えなかった。 */
const MIN_SAMPLE_LENGTH_PX = 7

/** 線の形そのものを見せる。色が見えなくても、点線・太さ・高さ・位置で区別できる。 */
const MarkerSample = ({
  style,
  color,
}: {
  readonly style: MarkerStyle
  readonly color: string
}) => {
  const height = 16
  const [top, rawBottom] = markerSegment(style, height)
  const bottom = Math.max(rawBottom, top + MIN_SAMPLE_LENGTH_PX)
  return (
    <svg width={14} height={height} aria-hidden="true" className="shrink-0">
      <line
        x1={7}
        y1={top}
        x2={7}
        y2={bottom}
        stroke={color}
        strokeWidth={style.lineWidthPx}
        strokeDasharray={style.dashPx === null ? undefined : style.dashPx.join(' ')}
      />
      {style.capMarker === 'triangle' && <polygon points="4,0 10,0 7,5" fill={color} />}
    </svg>
  )
}

const MarkerLegend = ({
  picks,
  palette,
}: {
  readonly picks: readonly MarkerPick[]
  readonly palette: WaveformPalette
}) => (
  <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
    {picks.map((pick) => (
      <li key={pick.kind} className="flex items-center gap-1.5">
        <MarkerSample style={MARKER_STYLES[pick.kind]} color={palette.marker[pick.kind]} />
        <span>
          {MARKER_STYLES[pick.kind].label} {pick.times.length}
          {pick.hiddenCount > 0 && (
            <span className="text-muted">
              （{pick.stride} 個に 1 本・{pick.hiddenCount} 個は非表示）
            </span>
          )}
        </span>
      </li>
    ))}
  </ul>
)

const BAND_LABELS: Readonly<Record<BandName, string>> = {
  low: '低域（キック・ベース）',
  mid: '中域（歌・メロディ）',
  high: '高域（ハイハット・シンバル）',
}

/** 帯域の色の意味。ブレイクでは低域（奥の太い層）が細くなる。 */
const BandLegend = ({ palette }: { readonly palette: WaveformPalette }) => (
  <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
    {BAND_ORDER.map((band) => (
      <li key={band} className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2 w-3 rounded-sm"
          style={{ background: palette.bands[band] }}
        />
        {BAND_LABELS[band]}
      </li>
    ))}
    <li>高さは曲の中での強さ。セクションは背景の縞、小節頭とドロップ（▼）は上の帯に刻む。</li>
  </ul>
)

// --- 本体 ---

export const WaveformCanvas = ({
  peaks,
  durationSec,
  view,
  beats,
  downbeats,
  drops,
  sectionBoundarySec,
  heightPx = WAVEFORM_HEIGHT_PX,
  compact = false,
  children,
}: WaveformCanvasProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const widthPx = useElementWidth(wrapperRef)
  const dpr = useDevicePixelRatio()
  const palette = useWaveformPalette()
  const [drawError, setDrawError] = useState<string | null>(null)

  const safeView = useMemo(
    () => clampView(view ?? fullView(durationSec), durationSec),
    [view, durationSec],
  )

  const picks = useMemo(() => {
    if (widthPx <= 0) return []
    const anchor = beatGridAnchor(beats, downbeats)
    return [
      pickMarkers('section', sectionBoundarySec, safeView, widthPx),
      pickMarkers('beat', beats, safeView, widthPx, anchor),
      pickMarkers('downbeat', downbeats, safeView, widthPx),
      pickMarkers('drop', drops, safeView, widthPx),
    ]
  }, [widthPx, safeView, beats, downbeats, drops, sectionBoundarySec])

  const points = peaksOf(peaks)
  // ブラウザのキャンバスは一辺およそ 32k px が上限。タイムラインを「細かく」にすると
  // 1 曲で超えるので、画素だけ間引いて CSS 幅はそのまま伸ばす（位置はずれない）。
  const widthDev = Math.max(0, Math.min(MAX_CANVAS_WIDTH_PX, Math.round(widthPx * dpr)))
  const heightDev = Math.max(0, Math.round(heightPx * dpr))

  /**
   * 曲ごとの引き伸ばしは**曲を開いたときに 1 回だけ**（列ごとに分位を取ると重い）。
   * 帯域が無い古い解析は振幅を引き伸ばす。音圧の高い曲でも起伏が出る。
   */
  const stretched = useMemo(() => {
    const bands = peaks.status === 'ok' ? peaks.bands : null
    return {
      peaks: stretchSeries(points),
      bands: bands === null ? null : stretchBands(bands),
    }
  }, [peaks, points])

  const stripes = useMemo(
    () => sectionStripes(sectionBoundarySec, durationSec),
    [sectionBoundarySec, durationSec],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || widthDev <= 0 || heightDev <= 0) return
    canvas.width = widthDev
    canvas.height = heightDev
    const columnsOf = (series: readonly number[]): readonly number[] =>
      seriesColumns(series, safeView, durationSec, widthDev)
    const bands = stretched.bands
    const ok = draw(canvas, {
      columns: peakColumns(stretched.peaks, safeView, durationSec, widthDev),
      bandColumns:
        bands === null
          ? null
          : { low: columnsOf(bands.low), mid: columnsOf(bands.mid), high: columnsOf(bands.high) },
      stripes,
      picks,
      view: safeView,
      widthDev,
      heightDev,
      rulerDev: Math.round(RULER_HEIGHT_PX * dpr),
      dpr,
      palette,
    })
    setDrawError(
      ok ? null : 'この端末では波形を描画できませんでした（canvas を初期化できません）。',
    )
  }, [stretched, stripes, safeView, durationSec, picks, widthDev, heightDev, dpr, palette])

  if (peaks.status === 'failed') {
    return (
      <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4">
        <p className="text-sm font-semibold text-danger">波形を表示できません</p>
        <p className="mt-1 break-words text-sm text-danger">{peaks.message}</p>
        <p className="mt-2 text-sm text-danger">
          署名付き URL には期限があります。解析結果を読み直すと新しい URL が発行されます。
        </p>
      </div>
    )
  }

  const label = describeWaveform({
    view: safeView,
    durationSec,
    peakCount: points.length,
    picks,
  })

  return (
    <div>
      <div
        ref={wrapperRef}
        // 高さを決める側（聴きながら切る）が、画面に出ている波形の高さをここで測る。
        data-waveform-body=""
        className={`relative w-full overflow-hidden ${compact ? '' : 'rounded-lg border border-line'}`}
        style={{ height: `${heightPx}px` }}
      >
        <canvas ref={canvasRef} role="img" aria-label={label} className="block h-full w-full" />
        {children}
      </div>

      {drawError !== null && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {drawError}
        </p>
      )}

      {peaks.status === 'empty' && (
        <p className="mt-2 text-sm text-warn">
          波形の点が 0
          個でした。解析は終わっていますが、音の形は表示できません。目印だけを描いています。
        </p>
      )}

      {/*
        いまどこを映しているかと、目印の読み方。凡例は波形の下を 2 行占めていたので、
        `?` の中へ畳む（UI-WORKBENCH-2 §3.2）。読み上げは canvas の `aria-label` が持つ。
      */}
      {!compact && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="tabular-nums">
            {formatClock(safeView.startSec)} – {formatClock(safeView.endSec)}（
            {formatDuration(viewDurationSec(safeView))}
            {/* 全体を映しているときは同じ数字を 2 回出さない。 */}
            {Math.abs(viewDurationSec(safeView) - durationSec) > 0.01 &&
              ` / 全体 ${formatDuration(durationSec)}`}
            ）
          </span>
          {peaks.status === 'ok' && peaks.bands === null && (
            <span className="text-warn">
              古い解析のため帯域の色がありません。再解析すると出ます。
            </span>
          )}
          <HelpDisclosure label="波形の読み方">
            <BandLegend palette={palette} />
            <MarkerLegend picks={picks} palette={palette} />
          </HelpDisclosure>
        </div>
      )}
    </div>
  )
}
