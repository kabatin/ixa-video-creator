'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatClock, formatDuration } from '@/lib/format-time'
import { THEME_ATTRIBUTE } from '@/lib/theme'
import type { WaveformPeaksResult } from '@/lib/waveform-api'
import { peaksOf } from '@/lib/waveform-api'
import {
  DEFAULT_WAVEFORM_PALETTE,
  MARKER_DRAW_ORDER,
  MARKER_STYLES,
  WAVEFORM_COLOR_TOKENS,
  WAVE_FILL_ALPHA,
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

const DEFAULT_HEIGHT_PX = 128
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
  /** 再生位置などの重ね描き。 */
  readonly children?: ReactNode
}

// --- 計測 ---

/** 要素の実寸（CSS px）。`ResizeObserver` が無い環境では 0 のままにして描画を諦める。 */
const useElementWidth = (ref: React.RefObject<HTMLElement | null>): number => {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [ref])

  return width
}

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
  readonly columns: readonly number[]
  readonly picks: readonly MarkerPick[]
  readonly view: ViewRange
  readonly widthDev: number
  readonly heightDev: number
  readonly dpr: number
  readonly palette: WaveformPalette
}

const drawMarkers = (ctx: CanvasRenderingContext2D, params: DrawParams): void => {
  const byKind = new Map<MarkerKind, MarkerPick>(params.picks.map((pick) => [pick.kind, pick]))
  for (const kind of MARKER_DRAW_ORDER) {
    const pick = byKind.get(kind)
    if (pick === undefined) continue
    const style: MarkerStyle = MARKER_STYLES[kind]
    const [top, bottom] = markerSegment(style, params.heightDev)
    const dash =
      style.dashPx === null
        ? null
        : ([style.dashPx[0] * params.dpr, style.dashPx[1] * params.dpr] as const)
    ctx.fillStyle = params.palette.marker[kind]
    for (const time of pick.times) {
      const x = timeToX(time, params.view, params.widthDev)
      fillVerticalLine(ctx, x, top, bottom, style.lineWidthPx * params.dpr, dash)
      if (style.capMarker === 'triangle') fillTriangleCap(ctx, x, 4 * params.dpr)
    }
  }
}

const draw = (canvas: HTMLCanvasElement, params: DrawParams): boolean => {
  const ctx = canvas.getContext('2d')
  if (ctx === null) return false

  ctx.clearRect(0, 0, params.widthDev, params.heightDev)
  ctx.fillStyle = params.palette.background
  ctx.fillRect(0, 0, params.widthDev, params.heightDev)

  const middle = params.heightDev / 2
  ctx.fillStyle = params.palette.wave
  params.columns.forEach((amplitude, column) => {
    const barHeight = Math.max(1, amplitude * params.heightDev * WAVE_VERTICAL_FILL)
    ctx.fillRect(column, middle - barHeight / 2, 1, barHeight)
  })

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
      {style.capMarker === 'triangle' && (
        <polygon points="4,0 10,0 7,5" fill={color} />
      )}
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

// --- 本体 ---

export const WaveformCanvas = ({
  peaks,
  durationSec,
  view,
  beats,
  downbeats,
  drops,
  sectionBoundarySec,
  heightPx = DEFAULT_HEIGHT_PX,
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
  const widthDev = Math.max(0, Math.round(widthPx * dpr))
  const heightDev = Math.max(0, Math.round(heightPx * dpr))

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || widthDev <= 0 || heightDev <= 0) return
    canvas.width = widthDev
    canvas.height = heightDev
    const columns = peakColumns(points, safeView, durationSec, widthDev)
    const ok = draw(canvas, { columns, picks, view: safeView, widthDev, heightDev, dpr, palette })
    setDrawError(ok ? null : 'この端末では波形を描画できませんでした（canvas を初期化できません）。')
  }, [points, safeView, durationSec, picks, widthDev, heightDev, dpr, palette])

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
        className="relative w-full overflow-hidden rounded-lg border border-line"
        style={{ height: `${heightPx}px` }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          className="block h-full w-full"
        />
        {children}
      </div>

      {drawError !== null && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {drawError}
        </p>
      )}

      {peaks.status === 'empty' && (
        <p className="mt-2 text-sm text-warn">
          波形の点が 0 個でした。解析は終わっていますが、音の形は表示できません。目印だけを描いています。
        </p>
      )}

      {/*
        canvas の中身を文字で出す 2 本立て。読み上げ用は canvas の `aria-label` が持つので、
        ここを `sr-only` で二重に置かない（同じ文が 2 回読まれる）。
        代わりに、目で見ても分からない「いまどこを映しているか」を出す。
      */}
      <p className="mt-2 text-xs text-muted">
        {formatClock(safeView.startSec)} – {formatClock(safeView.endSec)}（
        {formatDuration(viewDurationSec(safeView))} / 全体 {formatDuration(durationSec)}）
      </p>
      <MarkerLegend picks={picks} palette={palette} />
    </div>
  )
}
