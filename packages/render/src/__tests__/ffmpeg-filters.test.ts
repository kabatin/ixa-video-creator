import { describe, expect, it } from 'vitest'
import { buildFfmpegArgs } from '../ffmpeg-filters.js'
import {
  makeClip,
  makeDocument,
  makeTransition,
  makeVideo1Shot,
  mediaContent,
  shotId,
  unresolvedContent,
} from './fixtures.js'

const OUT = '/tmp/out.mp4'

const filterGraph = (args: readonly string[]): string => {
  const index = args.indexOf('-filter_complex')
  return index === -1 ? '' : (args[index + 1] ?? '')
}

describe('buildFfmpegArgs', () => {
  it('黒キャンバスをタイムライン全体の尺で作る', () => {
    const args = buildFfmpegArgs(makeDocument({ durationSec: 4 }), 'preview_720p', OUT)
    expect(args).toContain('color=c=black:s=1280x720:r=30:d=4.000000')
  })

  it('尺は -t で durationSec に固定する', () => {
    const args = buildFfmpegArgs(makeDocument({ durationSec: 7.5 }), 'preview_720p', OUT)
    expect(args[args.indexOf('-t') + 1]).toBe('7.500000')
  })

  it('Shot を inSec から切り出し、startSec の位置に重ねる', () => {
    const doc = makeDocument({ video1: [makeVideo1Shot(1, 2, 3, 1.5)] })
    const graph = filterGraph(buildFfmpegArgs(doc, 'preview_720p', OUT))
    expect(graph).toContain('trim=start=1.500000:duration=3.000000')
    expect(graph).toContain('setpts=PTS-STARTPTS+2.000000/TB')
    expect(graph).toContain("enable='between(t,2.000000,5.000000)'")
  })

  it('アスペクト比を保って収める（切り落とさない）', () => {
    const doc = makeDocument({ video1: [makeVideo1Shot(1, 0, 2)] })
    const graph = filterGraph(buildFfmpegArgs(doc, 'preview_720p', OUT))
    expect(graph).toContain('scale=1280:720:force_original_aspect_ratio=decrease')
    expect(graph).toContain('pad=1280:720:(ow-iw)/2:(oh-ih)/2')
  })

  it('音声は adelay で配置し amix で混ぜる', () => {
    const doc = makeDocument({
      audio: [
        { mediaUrl: 'a.wav', startSec: 0, durationSec: 2, volume: 1 },
        { mediaUrl: 'b.wav', startSec: 2.5, durationSec: 2, volume: 0.5 },
      ],
    })
    const graph = filterGraph(buildFfmpegArgs(doc, 'preview_720p', OUT))
    expect(graph).toContain('adelay=0:all=1')
    expect(graph).toContain('adelay=2500:all=1')
    expect(graph).toContain('volume=0.5000')
    expect(graph).toContain('amix=inputs=2:normalize=0')
  })

  it('音声が無ければ -an', () => {
    expect(buildFfmpegArgs(makeDocument(), 'preview_720p', OUT)).toContain('-an')
  })

  it('preset に従ってコーデックと CRF を選ぶ', () => {
    const args = buildFfmpegArgs(makeDocument(), 'master_4k', OUT)
    expect(args).toContain('libx265')
    expect(args[args.indexOf('-crf') + 1]).toBe('18')
  })

  it('clips は content の種別によらず 1 つも描かれない（capabilities で表明済みの縮退）', () => {
    const doc = makeDocument({
      video1: [makeVideo1Shot(1, 0, 2), makeVideo1Shot(2, 2, 2)],
      transitions: [makeTransition(1, shotId(1), shotId(2), 'dissolve', 0.5)],
      clips: [
        makeClip(1, 'TEXT', 0, 1),
        makeClip(2, 'VIDEO2', 0, 1, 0, mediaContent('video', 'https://media.test/clip.mp4')),
        makeClip(3, 'VFX', 0, 1, 0, unresolvedContent('MediaAsset が見つかりません')),
      ],
      audio: [],
    })
    const args = buildFfmpegArgs(doc, 'preview_720p', OUT)
    const graph = filterGraph(args)

    // クリップの素材は入力にすら現れない
    expect(args).not.toContain('https://media.test/clip.mp4')
    expect(graph).not.toContain('drawtext')
    // dissolve は cut に縮退する
    expect(graph).not.toContain('xfade')
    // Shot は 2 本とも cut として並ぶだけ
    expect(graph).toContain("enable='between(t,0.000000,2.000000)'")
    expect(graph).toContain("enable='between(t,2.000000,4.000000)'")
  })

  it('入力は黒キャンバス + Shot + audio だけ（クリップ由来の入力を増やさない）', () => {
    const doc = makeDocument({
      video1: [makeVideo1Shot(1, 0, 2)],
      clips: [makeClip(1, 'VIDEO2', 0, 1, 0, mediaContent('video', 'https://media.test/clip.mp4'))],
      audio: [{ mediaUrl: 'bgm.mp3', startSec: 0, durationSec: 4, volume: 1 }],
    })
    const args = buildFfmpegArgs(doc, 'preview_720p', OUT)
    expect(args.filter((arg) => arg === '-i')).toHaveLength(3)
  })

  it('出力パスは最後の引数', () => {
    const args = buildFfmpegArgs(makeDocument(), 'preview_720p', OUT)
    expect(args[args.length - 1]).toBe(OUT)
  })
})
