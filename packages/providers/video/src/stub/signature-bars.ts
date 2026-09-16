import { hslToHex } from './color.js'

/**
 * drawtext が使えない環境向けの縮退表示。
 * テキストの代わりに、specHash から決まる本数・色のカラーバーを `drawbox` で描く。
 * `drawbox` は libfreetype に依存しないため、どの FFmpeg ビルドでも使える。
 */

const MIN_BARS = 3
const BAR_VARIANTS = 5
const BAR_HEIGHT_RATIO = 0.1
const BAR_TOP_RATIO = 0.06
const PROGRESS_HEIGHT_RATIO = 0.02
const PROGRESS_SEGMENTS = 24
const TICKER_RATIO = 0.05

/**
 * 署名文字列をバイト列にする。16 進文字列ならそのまま、そうでなければ文字コードを使う。
 * どちらの場合も同じ入力からは必ず同じ列が出る。
 */
export const signatureBytes = (signature: string, count: number): readonly number[] => {
  const isHex = /^[0-9a-fA-F]+$/.test(signature) && signature.length >= 2
  const bytes: number[] = []

  for (let i = 0; i < count; i += 1) {
    if (isHex) {
      const offset = (i * 2) % signature.length
      const pair = (signature + signature).slice(offset, offset + 2)
      bytes.push(Number.parseInt(pair, 16))
      continue
    }
    bytes.push(signature.length === 0 ? 0 : signature.charCodeAt(i % signature.length) % 256)
  }

  return bytes
}

/** 明るいバー色。暗い背景の上で確実に見えるようにする。 */
const barColor = (byte: number): string => hslToHex(byte / 256, 0.8, 0.6)

/** `#RRGGBB` を drawbox が受け付ける `0xRRGGBB` 形式にする。 */
const toFfmpegColor = (hex: string): string => `0x${hex.slice(1)}`

export const barCountFor = (signature: string): number => {
  const [first] = signatureBytes(signature, 1)
  return MIN_BARS + ((first ?? 0) % BAR_VARIANTS)
}

/**
 * 署名から決まるカラーバー群。Shot / Take が変われば本数と色が変わる。
 * 同じ署名なら必ず同じ絵になる。
 */
export const buildSignatureBars = (signature: string, width: number, height: number): string => {
  const count = barCountFor(signature)
  const bytes = signatureBytes(signature, count + 1)
  const barHeight = Math.max(2, Math.round(height * BAR_HEIGHT_RATIO))
  const top = Math.round(height * BAR_TOP_RATIO)
  const slot = Math.max(2, Math.floor(width / (count * 2 + 1)))

  return Array.from({ length: count }, (_, index) => {
    const x = slot + index * slot * 2
    const color = toFfmpegColor(barColor(bytes[index + 1] ?? 0))
    return `drawbox=x=${x}:y=${top}:w=${slot}:h=${barHeight}:color=${color}:t=fill`
  }).join(',')
}

/**
 * 画面下部の進行インジケータ。
 *
 * `drawbox` の x/y/w/h 式は**フレームごとには再評価されない**（`t` は初期化時のみ）ため、
 * 伸びるバーは作れない。代わりに固定位置のセグメントを並べ、タイムライン機能である
 * `enable=gte(t\,ti)` で 1 つずつ点灯させる。`enable` はフレームごとに評価される。
 */
export const buildProgressSegments = (
  durationSec: number,
  width: number,
  height: number,
  segments = PROGRESS_SEGMENTS,
): string => {
  const barHeight = Math.max(2, Math.round(height * PROGRESS_HEIGHT_RATIO))
  const segmentWidth = Math.max(1, Math.floor(width / segments))

  return Array.from({ length: segments }, (_, index) => {
    const at = ((index * durationSec) / segments).toFixed(3)
    const x = index * segmentWidth
    return (
      `drawbox=x=${x}:y=ih-${barHeight}:w=${segmentWidth}:h=${barHeight}` +
      `:color=0xFFFFFF:t=fill:enable=gte(t\\,${at})`
    )
  }).join(',')
}

/**
 * 右下でフレームごとに明滅する小さなブロック。
 * フレーム落ち・重複をコマ送りで目視できるようにするため（タイムコードの代替）。
 */
export const buildFrameTicker = (fps: number, width: number, height: number): string => {
  const size = Math.max(4, Math.round(height * TICKER_RATIO))
  const barHeight = Math.max(2, Math.round(height * PROGRESS_HEIGHT_RATIO))
  const x = width - size - size
  const y = height - barHeight - size - size
  return (
    `drawbox=x=${x}:y=${y}:w=${size}:h=${size}:color=0xFFFFFF:t=fill` +
    `:enable=eq(mod(floor(t*${fps}+0.5)\\,2)\\,0)`
  )
}
