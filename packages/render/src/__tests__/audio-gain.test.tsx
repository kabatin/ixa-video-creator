import { dbToGain } from '@ixa/domain'
import { isValidElement, type ReactElement } from 'react'
import { Audio } from 'remotion'
import { describe, expect, it } from 'vitest'
import { AudioTrack, ClipMedia } from '../compositions/Timeline.js'
import { buildFfmpegArgs } from '../ffmpeg-filters.js'
import { audioVolumeAt, buildTimelinePlan } from '../plan.js'
import { letterboxFit } from '../presets.js'
import { makeDocument, mediaContent } from './fixtures.js'

/**
 * 音の仕上げ（ADR-0039）。曲のフェードと、ナレーションの間に曲を下げる（ダッキング）。
 * プレビューと書き出しで同じ音になるよう、配置表に「時刻 → 音量」の材料を持たせ、描く側は 1 コマごとに引く。
 */

const CANVAS = { width: 1920, height: 1080 }
const DUCKING = { enabled: true, depthDb: 10, attackSec: 0.2, releaseSec: 0.4 }
const music = { mediaUrl: 'bgm.mp3', startSec: 0, durationSec: 20, volume: 0.8 }
const voice = { mediaUrl: 'voice.m4a', startSec: 5, durationSec: 2, volume: 1, inSec: 3, role: 'voice' as const }

describe('buildTimelinePlan（音の仕上げ）', () => {
  it('曲には声の区間（まとめたもの）とダッキングの設定、声には何も付けない', () => {
    const [bgm, line] = buildTimelinePlan(makeDocument({ audio: [music, voice], ducking: DUCKING }), CANVAS).audio

    expect(bgm).toMatchObject({ role: 'music', ducking: { spans: [{ startSec: 5, endSec: 7 }], settings: DUCKING } })
    expect(line).toMatchObject({ role: 'voice', ducking: null })
  })

  it('ダッキングを切っている・設定が無いなら、曲にも付けない', () => {
    const [off] = buildTimelinePlan(makeDocument({ audio: [music, voice], ducking: { ...DUCKING, enabled: false } }), CANVAS).audio
    const [none] = buildTimelinePlan(makeDocument({ audio: [music, voice] }), CANVAS).audio
    expect(off?.ducking).toBeNull()
    expect(none?.ducking).toBeNull()
  })
})

describe('audioVolumeAt', () => {
  const [bgm] = buildTimelinePlan(
    makeDocument({ audio: [{ ...music, fadeInSec: 2, fadeOutSec: 4 }, voice], ducking: DUCKING }),
    CANVAS,
  ).audio
  if (bgm === undefined) throw new Error('曲がありません')

  it('声の間は下げ、離れていれば元の音量（音量 × フェード × ダッキング）', () => {
    expect(audioVolumeAt(bgm, 6)).toBeCloseTo(0.8 * dbToGain(-10))
    expect(audioVolumeAt(bgm, 10)).toBeCloseTo(0.8)
  })

  it('頭と終わりはフェードする', () => {
    expect(audioVolumeAt(bgm, 0)).toBe(0)
    expect(audioVolumeAt(bgm, 1)).toBeCloseTo(0.4)
    expect(audioVolumeAt(bgm, 18)).toBeCloseTo(0.4)
  })
})

describe('AudioTrack', () => {
  const props = (doc: Parameters<typeof makeDocument>[0]) => {
    const [track] = buildTimelinePlan(makeDocument(doc), CANVAS).audio
    if (track === undefined) throw new Error('音がありません')
    const sequence = AudioTrack({ track, fps: 30 }) as ReactElement<{ children: ReactElement<{ volume: unknown; startFrom: number }> }>
    const audio = sequence.props.children
    if (!isValidElement(audio) || audio.type !== Audio) throw new Error('Audio を描いていません')
    return audio.props
  }

  it('フェードやダッキングがあれば、1 コマごとの音量を渡す（シーケンスの頭からのコマ → 秒）', () => {
    const { volume } = props({ audio: [{ ...music, startSec: 1 }, voice], ducking: DUCKING })
    expect(typeof volume).toBe('function')
    // 声の間（タイムラインの 6 秒 = シーケンスの頭から 5 秒 = 150 コマ）は下げる。
    expect((volume as (frame: number) => number)(150)).toBeCloseTo(0.8 * dbToGain(-10))
  })

  it('何も掛けない音は、音量をそのまま渡す（切り出し位置も）', () => {
    expect(props({ audio: [voice] })).toMatchObject({ volume: 1, startFrom: 90 })
  })
})

describe('ClipMedia（効果音）', () => {
  /** 頭を切った効果音が、切った位置から鳴る（以前は inSec を渡しておらず、頭から鳴っていた）。 */
  it('音のクリップは切り出し位置から鳴らす', () => {
    const element = ClipMedia({
      content: { ...mediaContent('audio'), inSec: 1.5 } as never,
      fps: 30,
      video: letterboxFit(CANVAS, CANVAS),
    }) as ReactElement<{ startFrom: number }>
    expect(element.props.startFrom).toBe(45)
  })
})

describe('buildFfmpegArgs（音の仕上げ）', () => {
  const graphOf = (doc: Parameters<typeof makeDocument>[0]) => {
    const args = buildFfmpegArgs(makeDocument(doc), 'preview_720p', '/out.mp4')
    return args[args.indexOf('-filter_complex') + 1] ?? ''
  }

  it('フェードやダッキングのある音は、同じ形の音量の式を 1 コマごとに評価する', () => {
    const graph = graphOf({ audio: [{ ...music, fadeInSec: 2 }, voice], ducking: DUCKING })
    expect(graph).toMatch(/\[\d+:a\]atrim=[^[]*volume='[^']+':eval=frame/)
  })

  it('何も掛けない音は、今までどおり一定の音量', () => {
    expect(graphOf({ audio: [{ ...music, volume: 0.5 }] })).toContain('volume=0.5000,')
  })
})
