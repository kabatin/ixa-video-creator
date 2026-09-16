import { describe, expect, it } from 'vitest'
import { MUSIC_TRACK_ID } from '@/__tests__/fixtures'
import type { WireMusicAnalysis } from '@/lib/music-api'
import {
  AUDIO_ACCEPT,
  AUDIO_EXTENSIONS,
  LOW_BPM_CONFIDENCE,
  analysisNotice,
  analysisStats,
  decideAnalysisFreshness,
  describeAnalysisSection,
  deriveTrackTitle,
  fileExtension,
  formatBytes,
  formatPercent,
  isAudioContentType,
  isSupportedAudioFile,
  summarizeAnalysis,
  uploadPhaseLabel,
  uploadProgressRatio,
  validateAudioFile,
  validateTrackTitle,
  type UploadPhase,
} from '@/lib/music-upload'

const analysis = (patch: Partial<WireMusicAnalysis> = {}): WireMusicAnalysis => ({
  musicTrackId: MUSIC_TRACK_ID,
  analyzerVersion: 'librosa-v1',
  durationSec: 116.5,
  bpm: 128,
  bpmConfidence: 0.92,
  beats: [0, 0.47, 0.94],
  downbeats: [0, 1.88],
  sections: [{ start: 0, end: 116.5, label: 'intro', energy: 0.4 }],
  onsets: [0.01],
  drops: [32],
  waveformPeaksUrl: 'https://example.invalid/peaks.json?sig=x',
  createdAt: '2026-09-17T00:00:00.000Z',
  ...patch,
})

describe('拡張子の取り出し', () => {
  it.each([
    ['ixa-cup.wav', 'wav'],
    ['IXA-CUP.WAV', 'wav'],
    ['a.b.flac', 'flac'],
    ['noext', ''],
    ['.hidden', ''],
    ['trailing.', ''],
  ])('%s → "%s"', (name, expected) => {
    expect(fileExtension(name)).toBe(expected)
  })
})

describe('音声かどうかの判定', () => {
  it('MIME が audio/ なら拡張子を問わない', () => {
    expect(isAudioContentType('audio/wav')).toBe(true)
    expect(isAudioContentType('AUDIO/X-M4A')).toBe(true)
    expect(isAudioContentType('video/mp4')).toBe(false)
  })

  /** ブラウザは wav / m4a / flac の MIME をよく空文字で返す。拡張子で拾えないと弾いてしまう。 */
  it('MIME が空でも拡張子で音声と分かる', () => {
    expect(isSupportedAudioFile({ name: 'ixa-cup.wav', type: '', size: 34_000_000 })).toBe(true)
    expect(isSupportedAudioFile({ name: 'ixa-cup.m4a', type: '', size: 10 })).toBe(true)
  })

  it('拡張子が音声でなくても MIME が音声なら通す', () => {
    expect(isSupportedAudioFile({ name: 'track', type: 'audio/mpeg', size: 10 })).toBe(true)
  })

  it('画像や動画は通さない', () => {
    expect(isSupportedAudioFile({ name: 'takepi.png', type: 'image/png', size: 10 })).toBe(false)
    expect(isSupportedAudioFile({ name: 'cut.mp4', type: 'video/mp4', size: 10 })).toBe(false)
  })

  it('accept にすべての拡張子と audio/* が並ぶ', () => {
    for (const extension of AUDIO_EXTENSIONS) {
      expect(AUDIO_ACCEPT).toContain(`.${extension}`)
    }
    expect(AUDIO_ACCEPT).toContain('audio/*')
  })
})

describe('選んだファイルの検証', () => {
  it('音声ならそのまま通る', () => {
    expect(validateAudioFile({ name: 'ixa-cup.wav', type: 'audio/wav', size: 34_000_000 })).toEqual({
      ok: true,
    })
  })

  /** bytes は署名の要求で正の整数。ここで止めないと 422 が遠くで出る。 */
  it('空ファイルは理由を付けて弾く', () => {
    const result = validateAudioFile({ name: 'empty.wav', type: 'audio/wav', size: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('empty.wav')
  })

  it('音声でないファイルは対応形式を添えて弾く', () => {
    const result = validateAudioFile({ name: 'takepi.png', type: 'image/png', size: 5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('wav')
  })
})

describe('曲名', () => {
  it('拡張子を落として初期値にする', () => {
    expect(deriveTrackTitle('iXA CUP MUSIC VIDEO.wav')).toBe('iXA CUP MUSIC VIDEO')
  })

  it('拡張子が無ければそのまま使う', () => {
    expect(deriveTrackTitle('master')).toBe('master')
  })

  it('空白だけなら元の名前へ戻す', () => {
    expect(deriveTrackTitle('  .wav')).toBe('.wav')
  })

  it('前後の空白を落として受け取る', () => {
    expect(validateTrackTitle('  iXA CUP  ')).toEqual({ ok: true, title: 'iXA CUP' })
  })

  it('空白だけの曲名は弾く', () => {
    expect(validateTrackTitle('   ').ok).toBe(false)
  })
})

describe('アップロードの進捗', () => {
  it('段階が進むほど単調に増える', () => {
    const order: readonly UploadPhase[] = ['idle', 'sign', 'upload', 'checksum', 'complete', 'done']
    const ratios = order.map((phase) =>
      uploadProgressRatio({ phase, sentBytes: 0, totalBytes: 100 }),
    )
    for (let i = 1; i < ratios.length; i += 1) {
      expect(ratios[i] as number).toBeGreaterThan(ratios[i - 1] as number)
    }
  })

  it('送信中はバイト数で動く', () => {
    const half = uploadProgressRatio({ phase: 'upload', sentBytes: 50, totalBytes: 100 })
    const full = uploadProgressRatio({ phase: 'upload', sentBytes: 100, totalBytes: 100 })
    expect(half).toBeGreaterThan(uploadProgressRatio({ phase: 'upload', sentBytes: 0, totalBytes: 100 }))
    expect(full).toBeGreaterThan(half)
    expect(full).toBeLessThanOrEqual(1)
  })

  it('送信量が総量を超えても 1 を超えない', () => {
    expect(uploadProgressRatio({ phase: 'upload', sentBytes: 999, totalBytes: 100 })).toBeLessThanOrEqual(1)
  })

  it('総量が不明なら送信の開始位置に留まる', () => {
    expect(uploadProgressRatio({ phase: 'upload', sentBytes: 10, totalBytes: 0 })).toBe(
      uploadProgressRatio({ phase: 'upload', sentBytes: 0, totalBytes: 100 }),
    )
  })

  it('完了は 1', () => {
    expect(uploadProgressRatio({ phase: 'done', sentBytes: 0, totalBytes: 0 })).toBe(1)
  })

  it('すべての段階に言葉がある', () => {
    const phases: readonly UploadPhase[] = ['idle', 'sign', 'upload', 'checksum', 'complete', 'done']
    for (const phase of phases) expect(uploadPhaseLabel(phase).length).toBeGreaterThan(0)
  })

  it('百分率は 0〜100 に収まる', () => {
    expect(formatPercent(0.425)).toBe('43%')
    expect(formatPercent(-1)).toBe('0%')
    expect(formatPercent(5)).toBe('100%')
    expect(formatPercent(Number.NaN)).toBe('0%')
  })
})

describe('バイト数の表示', () => {
  it.each([
    [0, '0 B'],
    [-1, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [34_603_008, '33.0 MB'],
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('解析の待ち合わせ', () => {
  it('結果がまだ無いなら待ち続ける', () => {
    expect(decideAnalysisFreshness({ previousCreatedAt: null, latest: null })).toEqual({
      kind: 'waiting',
    })
  })

  it('初回は結果が出た時点で完了とする', () => {
    const latest = analysis()
    expect(decideAnalysisFreshness({ previousCreatedAt: null, latest })).toEqual({
      kind: 'fresh',
      analysis: latest,
    })
  })

  /**
   * 再解析では GET が前回の結果を返し続ける。
   * 「結果が有るか」で判定すると、投入した直後に古い結果を掴んで完了に化ける。
   */
  it('再解析中に前回と同じ結果を掴んでも完了にしない', () => {
    const latest = analysis({ createdAt: '2026-09-17T00:00:00.000Z' })
    const decision = decideAnalysisFreshness({
      previousCreatedAt: '2026-09-17T00:00:00.000Z',
      latest,
    })
    expect(decision).toEqual({ kind: 'waiting' })
  })

  it('作成時刻が変わったら新しい結果として受け取る', () => {
    const latest = analysis({ createdAt: '2026-09-17T00:05:00.000Z' })
    expect(
      decideAnalysisFreshness({ previousCreatedAt: '2026-09-17T00:00:00.000Z', latest }),
    ).toEqual({ kind: 'fresh', analysis: latest })
  })
})

describe('解析結果の要約', () => {
  it('件数をそのまま数える', () => {
    const summary = summarizeAnalysis(analysis())
    expect(summary.beatCount).toBe(3)
    expect(summary.downbeatCount).toBe(2)
    expect(summary.sectionCount).toBe(1)
    expect(summary.dropCount).toBe(1)
    expect(summary.missing).toEqual([])
    expect(summary.lowConfidence).toBe(false)
  })

  /**
   * 空配列を黙って「解析済み」に畳むと、検出できなかったことが完了に化ける（lessons L-015）。
   * 何が取れていないかを名前で残す。
   */
  it('ビートが 0 件なら未検出として名前を残す', () => {
    expect(summarizeAnalysis(analysis({ beats: [] })).missing).toContain('ビート')
  })

  it('取れていない項目をすべて並べる', () => {
    const summary = summarizeAnalysis(analysis({ beats: [], downbeats: [], sections: [] }))
    expect(summary.missing).toEqual(['ビート', 'ダウンビート', 'セクション'])
  })

  /** ドロップが無い曲は普通にある。検出漏れと区別できないので未検出扱いにしない。 */
  it('ドロップが 0 件でも未検出にはしない', () => {
    const summary = summarizeAnalysis(analysis({ drops: [] }))
    expect(summary.dropCount).toBe(0)
    expect(summary.missing).toEqual([])
  })

  it('BPM の信頼度が低いと印を付ける', () => {
    const low = summarizeAnalysis(analysis({ bpmConfidence: LOW_BPM_CONFIDENCE - 0.01 }))
    const high = summarizeAnalysis(analysis({ bpmConfidence: LOW_BPM_CONFIDENCE }))
    expect(low.lowConfidence).toBe(true)
    expect(high.lowConfidence).toBe(false)
  })
})

describe('解析結果の並べ方', () => {
  it('数字を決まった順で並べる', () => {
    const stats = analysisStats(summarizeAnalysis(analysis()))
    expect(stats.map((stat) => stat.label)).toEqual([
      'BPM',
      '信頼度',
      '尺',
      'ビート',
      'ダウンビート',
      'セクション',
      'ドロップ',
    ])
    expect(stats[0]).toEqual({ label: 'BPM', value: '128.0' })
  })

  it('セクションは時計形式の区間と長さで書く', () => {
    expect(
      describeAnalysisSection({ start: 32, end: 56, label: 'chorus', energy: 0.82 }),
    ).toBe('0:32.00 – 0:56.00（24.00s） エネルギー 0.82')
  })
})

describe('解析状態の知らせ方', () => {
  /** 楽曲が選ばれていないときと結果が出たときは、状況を説明する文が要らない。 */
  it.each([{ kind: 'idle' } as const, { kind: 'ready', analysis: analysis() } as const])(
    '$kind では文を出さない',
    (phase) => {
      expect(analysisNotice(phase)).toBeNull()
    },
  )

  it('待っている間は経過秒を添えて知らせる', () => {
    const notice = analysisNotice({ kind: 'waiting', waitedSec: 12 })
    expect(notice?.tone).toBe('info')
    expect(notice?.text).toContain('12')
  })

  /**
   * 「上限まで待った」を「終わった」と読ませない（lessons L-015）。
   * 対処が要るので tone は alert にする。
   */
  it('待ちきれなかったことは終了と区別して警告にする', () => {
    const notice = analysisNotice({ kind: 'timeout' })
    expect(notice?.tone).toBe('alert')
    expect(notice?.text).toContain('終わっていない可能性')
  })

  it('失敗はそのまま理由を出す', () => {
    expect(analysisNotice({ kind: 'error', message: 'API に繋がりません' })).toEqual({
      tone: 'alert',
      text: 'API に繋がりません',
    })
  })

  it('未解析は対処ではなく状況として伝える', () => {
    expect(analysisNotice({ kind: 'none' })?.tone).toBe('info')
  })
})
