import { RenderPreset } from '@ixa/domain'
import { describe, expect, it } from 'vitest'
import {
  activeRenderJobs,
  DEFAULT_RENDER_PRESET,
  describeRenderJob,
  formatJobTime,
  isRenderJobActive,
  latestRenderJob,
  RENDER_PRESET_OPTIONS,
  renderElapsedSec,
  renderPresetLabel,
  renderStatusLabel,
  sortRenderJobsByNewest,
  summarizeReasons,
  type RenderJobLike,
} from '@/lib/render-display'

const CREATED_AT = new Date('2026-09-17T02:00:00.000Z')

const job = (patch: Partial<RenderJobLike> = {}): RenderJobLike => ({
  status: 'queued',
  progress: 0,
  error: null,
  outputAssetId: null,
  createdAt: CREATED_AT,
  finishedAt: null,
  ...patch,
})

describe('プリセットの選択肢', () => {
  it('ドメインの enum を 1 つも落とさない', () => {
    expect(RENDER_PRESET_OPTIONS.map((option) => option.value)).toEqual(RenderPreset.options)
  })

  it('既定はプレビュー。最初の 1 回を安く終わらせる', () => {
    expect(DEFAULT_RENDER_PRESET).toBe('preview_720p')
    expect(renderPresetLabel('preview_720p')).toContain('720p')
  })

  it('解像度やビットレートの数値を説明に書き写さない', () => {
    const hints = RENDER_PRESET_OPTIONS.map((option) => option.hint).join('')
    expect(hints).not.toMatch(/1920|1080p|3840|2160|crf|kbps/iu)
  })
})

describe('進捗の表し方（L-015: 空・0・失敗を混ぜない）', () => {
  it('順番待ちは「まだ始まっていない」。0% とは書かない', () => {
    const view = describeRenderJob(job({ status: 'queued' }))

    expect(view.phase).toBe('waiting')
    expect(view.progressPercent).toBeNull()
    expect(view.detail).toContain('まだ始まっていません')
    expect(view.isActive).toBe(true)
  })

  it('実行中で進捗の報告がまだ無いときは、0% ではなく「報告が届いていない」', () => {
    const view = describeRenderJob(job({ status: 'rendering', progress: 0 }))

    expect(view.phase).toBe('running')
    expect(view.progressPercent).toBeNull()
    expect(view.detail).toContain('進捗の報告はまだ届いていません')
  })

  it('進捗が来ていれば百分率にする', () => {
    const view = describeRenderJob(job({ status: 'encoding', progress: 0.376 }))

    expect(view.progressPercent).toBe(38)
    expect(view.detail).toContain('38%')
    expect(renderStatusLabel('encoding')).toBe('エンコード中')
  })

  it('失敗は理由を必ず出し、進捗は出さない', () => {
    const view = describeRenderJob(
      job({ status: 'failed', progress: 0.6, error: 'ffmpeg exited with 1' }),
    )

    expect(view.phase).toBe('failed')
    expect(view.progressPercent).toBeNull()
    expect(view.detail).toContain('ffmpeg exited with 1')
    expect(view.isActive).toBe(false)
  })

  it('理由が記録されていない失敗も、失敗だと分かるように出す', () => {
    const view = describeRenderJob(job({ status: 'failed', error: null }))

    expect(view.detail).toContain('理由が記録されていません')
  })

  it('中止は失敗と別の言葉にする', () => {
    const view = describeRenderJob(job({ status: 'cancelled' }))

    expect(view.phase).toBe('cancelled')
    expect(view.detail).toContain('中止')
    expect(view.progressPercent).toBeNull()
  })

  it('完了は 100% で、出力を見られると伝える', () => {
    const view = describeRenderJob(
      job({ status: 'succeeded', progress: 1, outputAssetId: 'asset' }),
    )

    expect(view.phase).toBe('succeeded')
    expect(view.progressPercent).toBe(100)
    expect(view.detail).toContain('完了しました')
    expect(view.isActive).toBe(false)
  })

  it('完了しても出力が無いときは「完了」で終わらせない', () => {
    const view = describeRenderJob(job({ status: 'succeeded', progress: 1, outputAssetId: null }))

    expect(view.detail).toContain('記録されていません')
  })

  it('範囲外の進捗は 0–100 に収める', () => {
    expect(describeRenderJob(job({ status: 'rendering', progress: 5 })).progressPercent).toBe(100)
    expect(
      describeRenderJob(job({ status: 'rendering', progress: Number.NaN })).progressPercent,
    ).toBeNull()
  })

  it('動いているジョブだけ引き直す価値がある', () => {
    expect(isRenderJobActive('queued')).toBe(true)
    expect(isRenderJobActive('rendering')).toBe(true)
    expect(isRenderJobActive('encoding')).toBe(true)
    expect(isRenderJobActive('succeeded')).toBe(false)
    expect(isRenderJobActive('failed')).toBe(false)
    expect(isRenderJobActive('cancelled')).toBe(false)
  })
})

describe('経過時間と日時', () => {
  it('完了していれば投入から完了まで、動いていれば現在まで', () => {
    const finished = job({
      status: 'succeeded',
      finishedAt: new Date('2026-09-17T02:03:20.000Z'),
    })

    expect(renderElapsedSec(finished, Date.parse('2026-09-17T09:00:00.000Z'))).toBeCloseTo(200)
    expect(renderElapsedSec(job(), Date.parse('2026-09-17T02:00:30.000Z'))).toBeCloseTo(30)
  })

  it('時計が巻き戻っても負の経過にしない', () => {
    expect(renderElapsedSec(job(), Date.parse('2026-09-17T01:00:00.000Z'))).toBe(0)
  })

  /**
   * 日時はこの Mac の時刻で出す（UTC だと「13:52 UTC」と出て、いつのことか読み替えが要った）。
   * 書き出し画面はブラウザで読み込んでから描くので、サーバの描画とずれない。
   */
  it('日時は指定した地域の時刻（既定はブラウザの時刻）', () => {
    expect(formatJobTime(CREATED_AT, 'Asia/Tokyo')).toBe('2026-09-17 11:00')
    expect(formatJobTime(CREATED_AT, 'UTC')).toBe('2026-09-17 02:00')
    expect(formatJobTime(new Date(Number.NaN))).toBe('日時不明')
  })
})

describe('履歴の並び', () => {
  const older = { createdAt: new Date('2026-09-17T01:00:00.000Z'), id: 'old' }
  const newer = { createdAt: new Date('2026-09-17T03:00:00.000Z'), id: 'new' }

  it('最新は createdAt で決める。API の並び順に依存しない', () => {
    expect(latestRenderJob([newer, older])?.id).toBe('new')
    expect(latestRenderJob([])).toBeNull()
  })

  it('新しい順に並べ替え、元の配列は変えない', () => {
    const input = [older, newer]
    expect(sortRenderJobsByNewest(input).map((entry) => entry.id)).toEqual(['new', 'old'])
    expect(input.map((entry) => entry.id)).toEqual(['old', 'new'])
  })
})

describe('拒否理由の要約', () => {
  it('件数を残したまま先頭だけ出す', () => {
    const reasons = Array.from({ length: 72 }, (_, index) => `理由 ${String(index)}`)

    const summary = summarizeReasons(reasons)

    expect(summary.total).toBe(72)
    expect(summary.shown).toHaveLength(5)
    expect(summary.hiddenCount).toBe(67)
  })

  it('上限より少なければ全部出す', () => {
    const summary = summarizeReasons(['1 件だけ'])

    expect(summary.shown).toEqual(['1 件だけ'])
    expect(summary.hiddenCount).toBe(0)
  })
})

describe('走っている書き出しだけを取り出す', () => {
  it('動いているものだけを、元の並びのまま返す', () => {
    const jobs = [
      job({ status: 'succeeded' }),
      job({ status: 'rendering' }),
      job({ status: 'queued' }),
      job({ status: 'failed' }),
    ]
    expect(activeRenderJobs(jobs).map((entry) => entry.status)).toEqual(['rendering', 'queued'])
  })

  /** ダイアログを閉じても追跡が残るかは、この判定が 0 件と「読めていない」を混ぜないことに乗る。 */
  it('1 件も動いていなければ空。入力は変更しない', () => {
    const jobs = [job({ status: 'cancelled' }), job({ status: 'succeeded' })]
    const before = [...jobs]
    expect(activeRenderJobs(jobs)).toEqual([])
    expect(jobs).toEqual(before)
  })
})
