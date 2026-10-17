import { describe, expect, it } from 'vitest'
import { ProjectId, SfxJobId, TimelineClipId, newId } from '../common/ids.js'
import { ProjectEvent, SHOT_LIST_EVENT_TYPES } from '../events/project-event.js'
import { MediaOrigin } from '../media/media-asset.js'
import {
  SFX_CLIP_FADE_OUT_SEC,
  SFX_DEFAULT_VOLUME,
  SfxCue,
  SfxJobSpec,
  isSfxJobFinished,
  sfxClipPlacement,
  type SfxCueInput,
} from '../sfx/sfx-job.js'

/** 効果音のきっかけ（ADR-0052）。範囲は sfx-api の契約（長さ 0.5〜10 秒・説明 1〜500 字・本数 1〜4）と同じ。 */
const aCue = (overrides: Partial<SfxCueInput> = {}): SfxCueInput => ({
  startSec: 3.75,
  durationSec: 1,
  prompt: 'cinematic impact hit',
  ...overrides,
})

describe('SfxCue', () => {
  it('契約の範囲の値は受ける（端の値も）。音量の既定は 0.8', () => {
    for (const cue of [
      aCue(),
      aCue({ startSec: 0, durationSec: 0.5, volume: 0 }),
      aCue({ durationSec: 10, volume: 2, prompt: 'a'.repeat(500) }),
    ]) {
      expect(SfxCue.safeParse(cue).success).toBe(true)
    }
    expect(SfxCue.parse(aCue()).volume).toBe(SFX_DEFAULT_VOLUME)
    expect(SFX_DEFAULT_VOLUME).toBe(0.8)
  })

  it.each([
    ['説明が空', { prompt: '   ' }, /説明を入れて/],
    ['説明が 500 字を超える', { prompt: 'a'.repeat(501) }, /500 文字まで/],
    ['説明が日本語', { prompt: '車のエンジン音' }, /英語で書いて/],
    ['説明に日本語が混ざる', { prompt: 'engine 音' }, /英語で書いて/],
    ['長さが 0.5 秒より短い', { durationSec: 0.49 }, /0.5〜10 秒/],
    ['長さが 10 秒より長い', { durationSec: 10.01 }, /0.5〜10 秒/],
    ['時刻が負', { startSec: -0.1 }, null],
    ['音量が負', { volume: -0.1 }, null],
    ['音量が 2 を超える', { volume: 2.01 }, null],
  ] as const)('%s は受けない', (_label, overrides, message) => {
    const parsed = SfxCue.safeParse(aCue(overrides))
    expect(parsed.success).toBe(false)
    if (message !== null && !parsed.success) expect(parsed.error.issues[0]?.message).toMatch(message)
  })
})

describe('SfxJobSpec', () => {
  it.each([
    ['本数が 0', { count: 0 }],
    ['本数が 5', { count: 5 }],
    ['本数が小数', { count: 1.5 }],
    ['種が負', { seed: -1 }],
  ] as const)('%s は受けない', (_label, overrides) => {
    expect(SfxJobSpec.safeParse({ cue: aCue(), count: 1, seed: null, ...overrides }).success).toBe(false)
  })

  it('本数 1〜4 と種は受ける', () => {
    expect(SfxJobSpec.safeParse({ cue: aCue(), count: 4, seed: 7 }).success).toBe(true)
    expect(SfxJobSpec.safeParse({ cue: aCue(), count: 1, seed: null }).success).toBe(true)
  })
})

describe('sfxClipPlacement', () => {
  const cue = SfxCue.parse(aCue({ volume: 1.2 }))

  it('きっかけの時刻・音量で、実際の音の長さぶん置き、短いフェードアウトを付ける', () => {
    expect(sfxClipPlacement(cue, 1.05)).toEqual({ startSec: 3.75, durationSec: 1.05, volume: 1.2, fadeOutSec: SFX_CLIP_FADE_OUT_SEC })
  })

  it('実際の長さが取れなければ頼んだ長さ。フェードは尺の半分を超えない', () => {
    expect(sfxClipPlacement(cue, null).durationSec).toBe(1)
    expect(sfxClipPlacement(cue, 0).durationSec).toBe(1)
    expect(sfxClipPlacement(cue, Number.NaN).durationSec).toBe(1)
    expect(sfxClipPlacement(cue, 0.06).fadeOutSec).toBeCloseTo(0.03)
  })
})

describe('isSfxJobFinished', () => {
  it('成功・失敗・取消だけが終わり', () => {
    expect(['queued', 'running', 'succeeded', 'failed', 'cancelled'].map((s) => isSfxJobFinished(s as never))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ])
  })
})

describe('sfx_job.status と素材の出自', () => {
  it('出来事として読め、画面の購読に入っている', () => {
    const event = ProjectEvent.parse({
      type: 'sfx_job.status',
      projectId: newId(ProjectId),
      at: new Date().toISOString(),
      jobId: newId(SfxJobId),
      status: 'succeeded',
      timelineClipId: newId(TimelineClipId),
      error: null,
    })
    expect(event.type).toBe('sfx_job.status')
    expect(SHOT_LIST_EVENT_TYPES).toContain('sfx_job.status')
  })

  it('generated_sfx はジョブを指す', () => {
    expect(MediaOrigin.safeParse({ type: 'generated_sfx', sfxJobId: newId(SfxJobId) }).success).toBe(true)
    expect(MediaOrigin.safeParse({ type: 'generated_sfx' }).success).toBe(false)
  })
})
