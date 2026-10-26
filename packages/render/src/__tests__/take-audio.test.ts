import { readFileSync } from 'node:fs'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { TimelineDocument } from '@ixa/domain'
import { OffthreadVideo } from 'remotion'
import { PreviewShotVideo, ShotVideo } from '../compositions/shot-video.js'
import { buildFfmpegArgs } from '../ffmpeg-filters.js'
import { TAKE_AUDIO_FADE_SEC, buildAudioPlans, buildTimelinePlan } from '../plan.js'
import { presetResolution } from '../presets.js'
import { makeDocument, makeVideo1Shot } from './fixtures.js'

/** ADR-0060: 採用 Take の音をプレビュー（Remotion）と退避用の書き出し（ffmpeg）で鳴らす。 */

type Element = ReactElement<Record<string, unknown>>
const call = (element: Element): Element =>
  (element.type as (props: Record<string, unknown>) => Element)(element.props)

const readGolden = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./golden/mv-without-dialogue.${name}.json`, import.meta.url), 'utf8'))

const box = { position: 'absolute' as const, left: 0, top: 0, width: 1920, height: 1080 }

/** 書き出しの OffthreadVideo の props（枠は除く。音量は関数かどうかだけ）。 */
const renderedVideoProps = (shot: ReturnType<typeof buildTimelinePlan>['shots'][number], fps: number) => {
  const element = ShotVideo({ shot, box, rendering: true, fps }) as Element
  const rendered = shot.kind === 'image' ? element : call(element)
  const props = Object.fromEntries(Object.entries(rendered.props).filter(([key]) => key !== 'style'))
  return { ...props, volume: typeof props.volume }
}

describe('セリフの無い MV は前と同じ（前の版で書き出した値と丸ごと比べる）', () => {
  // 入力は @ixa/timeline の前後比較と同じ文書（0057 を通った消音の Shot。Take の多くは音付き）。
  const doc = TimelineDocument.parse(readGolden('timeline'))
  const plan = buildTimelinePlan(doc, presetResolution('master_1080p'))

  it('合成の配置表', () => {
    expect(JSON.parse(JSON.stringify(plan))).toEqual(readGolden('plan'))
  })

  it('Shot の動画は消音のまま', () => {
    expect(plan.shots.map((shot) => renderedVideoProps(shot, plan.fps))).toEqual(readGolden('shot-videos'))
  })

  it('ffmpeg の引数', () => {
    expect(buildFfmpegArgs(doc, 'master_1080p', '/tmp/out.mp4')).toEqual(readGolden('ffmpeg-args'))
  })
})

const audible = (n: number, startSec: number, durationSec: number, volume = 1) => ({
  ...makeVideo1Shot(n, startSec, durationSec),
  audio: { volume },
})

describe('配置表', () => {
  it('鳴らす Shot は大きさと本体の長さ（ディゾルブの尻を含まない）を持つ', () => {
    const plan = buildTimelinePlan(
      makeDocument({ durationSec: 4, video1: [audible(1, 0, 2, 1.5), makeVideo1Shot(2, 2, 2)] }),
      { width: 1920, height: 1080 },
    )
    expect(plan.shots[0]?.audio).toEqual({ volume: 1.5, durationSec: 2 })
    expect(plan.shots[1]?.audio).toBeUndefined()
  })

  it('曲は、Take の音を鳴らす Shot の間も下げる（ナレーションと同じ）', () => {
    const doc = makeDocument({
      durationSec: 10,
      video1: [makeVideo1Shot(1, 0, 4), audible(2, 4, 2)],
      audio: [{ mediaUrl: 'https://media.test/music.wav', startSec: 0, durationSec: 10, volume: 1 }],
      ducking: { enabled: true, depthDb: 10, attackSec: 0.15, releaseSec: 0.4 },
    })
    expect(buildAudioPlans(doc)[0]?.ducking?.spans).toEqual([{ startSec: 4, endSec: 6 }])
  })

  it('ダッキングを切っていれば下げない', () => {
    const doc = makeDocument({
      durationSec: 10,
      video1: [audible(1, 4, 2)],
      audio: [{ mediaUrl: 'https://media.test/music.wav', startSec: 0, durationSec: 10, volume: 1 }],
    })
    expect(buildAudioPlans(doc)[0]?.ducking).toBeNull()
  })
})

describe('Remotion の Shot の動画', () => {
  const planAt = (fps: number) =>
    buildTimelinePlan(makeDocument({ fps, durationSec: 2, video1: [audible(1, 0, 2, 1.5)] }), { width: 1920, height: 1080 })
  const shotAt = (fps: number) => {
    const shot = planAt(fps).shots[0]
    if (shot === undefined) throw new Error('Shot がありません')
    return shot
  }
  const volumeAt = (fps: number) => {
    const video = call(ShotVideo({ shot: shotAt(fps), box, rendering: true, fps }) as Element)
    expect(video.type).toBe(OffthreadVideo)
    expect(video.props.muted).toBe(false)
    return video.props.volume as (frame: number) => number
  }

  it('書き出しは消音を外し、頭と尻のコマを弱める（0 にはせず、Take の頭の音を落とさない）', () => {
    expect(TAKE_AUDIO_FADE_SEC).toBe(0.02)
    // 24fps の 1 コマは約 42ms。フェードは 1 コマ分にし、コマの真ん中で引く。頭と尻のコマは半分の大きさ。
    const volume = volumeAt(24)
    expect(volume(0)).toBeCloseTo(0.75)
    expect(volume(1)).toBeCloseTo(1.5)
    expect(volume(46)).toBeCloseTo(1.5)
    expect(volume(47)).toBeCloseTo(0.75)
    expect(volume(48)).toBe(0)
  })

  it('1 コマが 20ms より短ければ、フェードは 20ms', () => {
    // 100fps の 1 コマは 10ms。頭のコマ（真ん中 5ms）は 1/4、3 コマ目（25ms）で元の大きさ。
    const volume = volumeAt(100)
    expect(volume(0)).toBeCloseTo(1.5 * 0.25)
    expect(volume(1)).toBeCloseTo(1.5 * 0.75)
    expect(volume(2)).toBeCloseTo(1.5)
    expect(volume(199)).toBeCloseTo(1.5 * 0.25)
  })

  it('プレビューも同じ Shot と同じ fps を下敷き付きの部品へ渡す（同じ音量の関数になる）', () => {
    const shot = shotAt(50)
    const element = ShotVideo({ shot, box, rendering: false, fps: 50 }) as Element
    expect(element.type).toBe(PreviewShotVideo)
    expect(element.props).toEqual({ shot, box, fps: 50 })
  })
})

describe('ffmpeg の引数', () => {
  const filterOf = (args: readonly string[]): string => args[args.indexOf('-filter_complex') + 1] ?? ''

  it('鳴らす Shot だけ [N:a] を足し、20ms のフェードと大きさを付けて amix に入れる', () => {
    const doc = makeDocument({
      durationSec: 6,
      video1: [makeVideo1Shot(1, 0, 2), audible(2, 2, 2, 0.5), makeVideo1Shot(3, 4, 2)],
      audio: [{ mediaUrl: 'https://media.test/music.wav', startSec: 0, durationSec: 6, volume: 1 }],
    })
    const filter = filterOf(buildFfmpegArgs(doc, 'master_1080p', '/tmp/out.mp4'))
    expect(filter).not.toContain('[1:a]')
    expect(filter).not.toContain('[3:a]')
    expect(filter).toContain(
      '[2:a]atrim=start=0.000000:duration=2.000000,asetpts=PTS-STARTPTS,apad=whole_dur=2.000000,atrim=duration=2.000000,' +
        'afade=t=in:st=0:d=0.020000,afade=t=out:st=1.980000:d=0.020000,volume=0.5000,adelay=2000:all=1[ta1]',
    )
    expect(filter).toContain('[a0][ta1]amix=inputs=2:normalize=0[amix]')
  })

  it('速度を変えた Shot は音も同じ速さにする', () => {
    const doc = makeDocument({ durationSec: 2, video1: [{ ...audible(1, 0, 2), playbackRate: 1.5, inSec: 0.5 }] })
    const filter = filterOf(buildFfmpegArgs(doc, 'master_1080p', '/tmp/out.mp4'))
    expect(filter).toContain('[1:a]atrim=start=0.500000:duration=3.000000,asetpts=PTS-STARTPTS,atempo=1.500000,apad=')
  })

  it('曲が無くても Take の音だけで音のトラックを書く', () => {
    const doc = makeDocument({ durationSec: 2, video1: [audible(1, 0, 2)] })
    const args = buildFfmpegArgs(doc, 'master_1080p', '/tmp/out.mp4')
    expect(args).not.toContain('-an')
    expect(args.slice(args.indexOf('-map', args.indexOf('-map') + 1), args.indexOf('-map', args.indexOf('-map') + 1) + 2)).toEqual(['-map', '[ta0]'])
  })
})
