import { dbToGain } from '@ixa/domain'
import type { AudioPlan } from './plan.js'

/**
 * ffmpeg の `volume` の式（ADR-0039）。`audioVolumeAt` と同じ形（音量 × フェード × ダッキング）を、
 * 音の頭からの秒 `t` で書く。退避用レンダラ（ffmpeg）でも、プレビュー・Remotion と同じ音にするため。
 */

const n = (value: number): string => value.toFixed(4)

/** 0..1 に収める。 */
const clip01 = (expr: string): string => `min(1,max(0,${expr}))`

const fadeExpr = (track: AudioPlan): string => {
  const parts = [
    ...(track.fadeInSec > 0 ? [clip01(`t/${n(track.fadeInSec)}`)] : []),
    ...(track.fadeOutSec > 0 ? [clip01(`(${n(track.durationSec)}-t)/${n(track.fadeOutSec)}`)] : []),
  ]
  if (parts.length === 0) return '1'
  return parts.length === 1 ? (parts[0] ?? '1') : `min(${parts.join(',')})`
}

/** 1 つの声の区間に対する倍率（前で下げ始め、区間の間は下げたまま、後で戻す）。 */
const spanExpr = (start: number, end: number, low: number, attack: number, release: number): string => {
  const before = attack > 0 ? `if(lt(t,${n(start)}),1+(${n(low)}-1)*(t-${n(start - attack)})/${n(attack)},` : `if(lt(t,${n(start)}),1,`
  const after = release > 0 ? `if(lt(t,${n(end + release)}),${n(low)}+(1-${n(low)})*(t-${n(end)})/${n(release)},1)` : '1'
  return `if(lt(t,${n(start - attack)}),1,${before}if(lte(t,${n(end)}),${n(low)},${after})))`
}

const duckExpr = (track: AudioPlan): string => {
  if (track.ducking === null) return '1'
  const { spans, settings } = track.ducking
  const low = dbToGain(-settings.depthDb)
  const terms = spans.map((span) =>
    spanExpr(span.startSec - track.startSec, span.endSec - track.startSec, low, settings.attackSec, settings.releaseSec),
  )
  return terms.reduce((acc, term) => (acc === '' ? term : `min(${acc},${term})`), '')
}

/** 音量の式。時刻で変わらない音には null（呼び出し側は一定の音量にする）。 */
export const volumeExpression = (track: AudioPlan): string | null => {
  if (track.fadeInSec <= 0 && track.fadeOutSec <= 0 && track.ducking === null) return null
  return `${n(track.volume)}*${fadeExpr(track)}*${duckExpr(track)}`
}
