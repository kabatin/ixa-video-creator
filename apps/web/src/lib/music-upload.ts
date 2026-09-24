import type { MusicSection } from '@ixa/domain'
import { formatClock, formatDuration } from '@/lib/format-time'
import type { WireMusicAnalysis } from '@/lib/music-api'
import { WORDING } from '@/lib/wording'

/**
 * 音源の登録まわりの純粋なロジック。
 *
 * 画面（`audio-uploader.tsx` / `music-panel.tsx`）から判断を全部ここへ追い出す。
 * 判断がコンポーネントの中にあると、DOM を用意しないと確かめられなくなる。
 */

/**
 * 受け付ける音声の拡張子。
 *
 * MIME だけで判定しない。**ブラウザは wav / m4a / flac の種別をよく取り違える**
 * （`audio/x-m4a` になったり、空文字のまま来たりする）ため、拡張子を正とする経路も残す。
 */
export const AUDIO_EXTENSIONS: readonly string[] = Object.freeze([
  'wav',
  'mp3',
  'm4a',
  'flac',
  'aac',
  'ogg',
  'aiff',
  'aif',
])

/** `input[type=file]` の accept。拡張子と MIME の両方を並べる。 */
export const AUDIO_ACCEPT = [
  ...AUDIO_EXTENSIONS.map((extension) => `.${extension}`),
  'audio/*',
].join(',')

/** 拡張子を小文字で返す。ドットが無い・先頭・末尾なら空文字。 */
export const fileExtension = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

export const isAudioContentType = (contentType: string): boolean =>
  contentType.toLowerCase().startsWith('audio/')

/** `File` のうち判定に要る部分だけ。テストから DOM 無しで呼べるようにする。 */
export type AudioCandidate = {
  readonly name: string
  readonly type: string
  readonly size: number
}

export const isSupportedAudioFile = (file: AudioCandidate): boolean =>
  isAudioContentType(file.type) || AUDIO_EXTENSIONS.includes(fileExtension(file.name))

export type AudioValidation =
  { readonly ok: true } | { readonly ok: false; readonly reason: string }

const SUPPORTED_LIST = AUDIO_EXTENSIONS.join(' / ')

/**
 * 選ばれたファイルを登録前に弾く。
 *
 * 空ファイルをここで止めるのは、署名の要求（`bytes` は正の整数）が 422 で落ちると
 * 原因がアップロードの奥に見えてしまうため。
 */
export const validateAudioFile = (file: AudioCandidate): AudioValidation => {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, reason: `${file.name} は中身が空です。別のファイルを選んでください。` }
  }
  if (!isSupportedAudioFile(file)) {
    return {
      ok: false,
      reason: `${file.name} は音声として扱えません。対応形式: ${SUPPORTED_LIST}`,
    }
  }
  return { ok: true }
}

/** ファイル名から拡張子を落として曲名の初期値にする。空になるなら元の名前を返す。 */
export const deriveTrackTitle = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.')
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).trim()
  return base === '' ? fileName.trim() : base
}

export type TitleValidation =
  { readonly ok: true; readonly title: string } | { readonly ok: false; readonly reason: string }

export const validateTrackTitle = (raw: string): TitleValidation => {
  const title = raw.trim()
  if (title === '') return { ok: false, reason: '曲名を入力してください。' }
  return { ok: true, title }
}

/**
 * アップロードの段階。`UploadStage`（署名 / 送信 / 完了通知）に
 * チェックサム計算を足したもの。33MB の wav では計算だけで待ち時間が出るため、
 * **何も起きていないように見える区間を作らない**。
 */
export type UploadPhase = 'idle' | 'sign' | 'upload' | 'checksum' | 'complete' | 'done'

const PHASE_LABELS: Readonly<Record<UploadPhase, string>> = Object.freeze({
  idle: '待機中',
  sign: '署名付き URL を発行しています',
  upload: 'ストレージへ送信しています',
  checksum: 'チェックサムを計算しています',
  complete: '取り込みを通知しています',
  done: 'アップロードが完了しました',
})

export const uploadPhaseLabel = (phase: UploadPhase): string => PHASE_LABELS[phase]

/** 段階の開始時点の進捗。送信が支配的なので、そこへ幅を厚く割り当てる。 */
const PHASE_FLOOR: Readonly<Record<UploadPhase, number>> = Object.freeze({
  idle: 0,
  sign: 0.02,
  upload: 0.05,
  checksum: 0.9,
  complete: 0.95,
  done: 1,
})

/** 送信段階が占める幅。 */
const UPLOAD_SPAN = PHASE_FLOOR.checksum - PHASE_FLOOR.upload

const clampRatio = (value: number): number => Math.min(Math.max(value, 0), 1)

export type UploadProgress = {
  readonly phase: UploadPhase
  readonly sentBytes: number
  readonly totalBytes: number
}

/**
 * 全体の進捗を 0..1 で返す。
 * 送信中だけバイト数で細かく動き、それ以外は段階の境目で跳ねる。
 */
export const uploadProgressRatio = ({ phase, sentBytes, totalBytes }: UploadProgress): number => {
  if (phase !== 'upload') return PHASE_FLOOR[phase]
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return PHASE_FLOOR.upload
  const sent = clampRatio(sentBytes / totalBytes)
  return clampRatio(PHASE_FLOOR.upload + UPLOAD_SPAN * sent)
}

export const formatPercent = (ratio: number): string =>
  `${String(Math.round(clampRatio(Number.isFinite(ratio) ? ratio : 0) * 100))}%`

const BYTE_UNITS: readonly string[] = Object.freeze(['B', 'KB', 'MB', 'GB'])

/** `33.1 MB`。1024 区切り。大きな音源を選んだことが数字で分かるようにする。 */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit] as string}`
}

/**
 * 再解析の待ち合わせ判定。
 *
 * `GET /music-tracks/{id}/analysis` は**解析前でも前回の結果を返す**。
 * 「結果が有るか」で完了を判定すると、再解析を投入した直後に古い結果を掴んで
 * 「完了しました」と表示してしまう。作成時刻が変わったことを完了の条件にする。
 */
export type AnalysisFreshnessInput = {
  readonly previousCreatedAt: string | null
  readonly latest: WireMusicAnalysis | null
}

export type AnalysisFreshness =
  { readonly kind: 'waiting' } | { readonly kind: 'fresh'; readonly analysis: WireMusicAnalysis }

export const decideAnalysisFreshness = ({
  previousCreatedAt,
  latest,
}: AnalysisFreshnessInput): AnalysisFreshness =>
  latest === null || latest.createdAt === previousCreatedAt
    ? { kind: 'waiting' }
    : { kind: 'fresh', analysis: latest }

/** 信頼度がこれを下回る BPM は、そのまま尺の根拠にしない。 */
export const LOW_BPM_CONFIDENCE = 0.5

export type AnalysisSummary = {
  readonly bpm: number
  readonly bpmConfidence: number
  readonly lowConfidence: boolean
  readonly durationSec: number
  readonly beatCount: number
  readonly downbeatCount: number
  readonly sectionCount: number
  readonly dropCount: number
  /**
   * 解析は終わったのに中身が空だった項目。
   *
   * 空配列を黙って「解析済み」に畳むと、**検出できなかったことが完了に化ける**。
   * 何が取れていないかを名前で残し、画面に必ず出す。
   */
  readonly missing: readonly string[]
}

export const summarizeAnalysis = (analysis: WireMusicAnalysis): AnalysisSummary => {
  const missing = [
    analysis.beats.length === 0 ? 'ビート' : null,
    analysis.downbeats.length === 0 ? 'ダウンビート' : null,
    analysis.sections.length === 0 ? 'セクション' : null,
    // ドロップは 0 件が正しい曲がある。検出漏れと区別できないので未検出扱いにしない。
  ].filter((name): name is string => name !== null)

  return {
    bpm: analysis.bpm,
    bpmConfidence: analysis.bpmConfidence,
    lowConfidence: analysis.bpmConfidence < LOW_BPM_CONFIDENCE,
    durationSec: analysis.durationSec,
    beatCount: analysis.beats.length,
    downbeatCount: analysis.downbeats.length,
    sectionCount: analysis.sections.length,
    dropCount: analysis.drops.length,
    missing,
  }
}

export type AnalysisStat = { readonly label: string; readonly value: string }

/** 解析結果の数字を並び順ごと決める。画面は並べるだけにする。 */
export const analysisStats = (summary: AnalysisSummary): readonly AnalysisStat[] =>
  Object.freeze([
    { label: 'BPM', value: summary.bpm.toFixed(1) },
    { label: '信頼度', value: summary.bpmConfidence.toFixed(2) },
    { label: '尺', value: formatDuration(summary.durationSec) },
    { label: 'ビート', value: `${String(summary.beatCount)} 拍` },
    { label: 'ダウンビート', value: `${String(summary.downbeatCount)} 拍` },
    { label: 'セクション', value: `${String(summary.sectionCount)} 個` },
    { label: 'ドロップ', value: `${String(summary.dropCount)} 箇所` },
  ])

/** `chorus 0:32.00 – 0:56.00（24.00s） エネルギー 0.82`。 */
export const describeAnalysisSection = (section: MusicSection): string =>
  `${formatClock(section.start)} – ${formatClock(section.end)}` +
  `（${formatDuration(section.end - section.start)}） エネルギー ${section.energy.toFixed(2)}`

/**
 * 解析画面の状態。
 *
 * **「待っている」「上限まで待った」「失敗した」を 1 つにまとめない。**
 * まとめると、終わっていないものが終わったように読める（lessons L-015）。
 */
export type AnalysisPhase =
  /** 楽曲が選ばれていない。 */
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  /** 一度も解析されていない。 */
  | { readonly kind: 'none' }
  /** 解析を投入し、結果が入れ替わるのを待っている。 */
  | { readonly kind: 'waiting'; readonly waitedSec: number }
  | { readonly kind: 'ready'; readonly analysis: WireMusicAnalysis }
  /** 上限まで待ったが結果が出なかった。終わったかどうかは分かっていない。 */
  | { readonly kind: 'timeout' }
  | { readonly kind: 'error'; readonly message: string }

/** 画面に出す 1 文。`tone` は見た目ではなく**利用者が対処すべきか**で決める。 */
export type AnalysisNotice = {
  readonly tone: 'info' | 'alert'
  readonly text: string
}

export const analysisNotice = (phase: AnalysisPhase): AnalysisNotice | null => {
  switch (phase.kind) {
    case 'loading':
      return { tone: 'info', text: '解析結果を読み込んでいます…' }
    case 'none':
      return {
        tone: 'info',
        text: 'この楽曲はまだ解析されていません。Shot を割るにはビートとセクションが必要です。',
      }
    case 'waiting':
      return {
        tone: 'info',
        text: `解析中です（約 ${String(Math.round(phase.waitedSec))} 秒経過）。完了すると自動でここに出ます。`,
      }
    case 'timeout':
      return {
        tone: 'alert',
        text: `結果を待ちきれませんでした。解析はまだ続いているかもしれません。${WORDING.reload}すると今の状態が分かります。`,
      }
    case 'error':
      return { tone: 'alert', text: phase.message }
    default:
      return null
  }
}
