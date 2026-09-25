import type { MediaAssetRepository, MusicAnalysisRepository, MusicAnalysisFailureRepository } from '@ixa/db'
import {
  MANUAL_ANALYZER_VERSION,
  MusicTrackId as MusicTrackIdSchema,
  type MusicAnalysis,
  type MusicTrack,
  type MusicTrackId,
} from '@ixa/domain'
import type { MusicAnalysisResult, MusicAnalyzer } from '@ixa/music'
import { waveformKey, type ObjectStorage } from '@ixa/storage'
import type { Logger } from 'pino'
import { z } from 'zod'
import { analysisFailureMessage } from './failure-message.js'
import { withTempDir } from '../media/temp-dir.js'
import { placeAudioForAnalysis } from './audio-source.js'

/**
 * analysis キューのジョブ処理（docs/ARCHITECTURE.md §14 / §20、ADR-0009）。
 *
 * - ジョブデータは ID のみ。実データは DB から読む（DB が真実。ADR-0008）
 * - 冪等。同じ解析器バージョンの解析が既にあれば解析も保存もしない
 * - **手動補正は常に優先。** `MANUAL_ANALYZER_VERSION` の解析があれば自動解析で上書きしない
 * - 解析結果は追記のみ。既存の行を UPDATE しない
 */

export const AnalysisJobData = z.object({ musicTrackId: MusicTrackIdSchema })
export type AnalysisJobData = z.infer<typeof AnalysisJobData>

/**
 * 既定の解析器バージョン（ADR-0009）。`apps/audio` の `ANALYZER_VERSION` と対になる。
 * 解析前に「解析済みか」を判定するには、解析器が名乗る前にその名前を知っている必要がある。
 */
export const DEFAULT_ANALYZER_VERSION = 'librosa-v2'

/** 波形ピークの保存形式。キーの中身が何かを読み手が推測しなくて済むよう object で包む。 */
export const WAVEFORM_CONTENT_TYPE = 'application/json'

/** 一時ディレクトリの接頭辞。AUDIO_ROOT 配下にジョブごとに掘る。 */
const TEMP_DIR_PREFIX = 'analysis-job-'

/**
 * MusicTrack を 1 件引くための最小の口。
 *
 * `MusicTrackRepository`（`@ixa/db`）には現時点で `findById` が無いため、
 * リポジトリ全体ではなくこの形に依存する。`findById` が足されれば
 * `createMusicTrackRepository(db)` がそのまま構造的に適合する。
 */
export type MusicTrackLookup = {
  findById(id: MusicTrackId): Promise<MusicTrack | null>
}

export type AnalysisProcessorDeps = {
  readonly musicTracks: MusicTrackLookup
  readonly musicAnalyses: MusicAnalysisRepository
  /**
   * 解析の失敗の置き場。**失敗を画面が読める形で残す。**
   * 以前はログにしか残らず、画面から「まだ終わっていない」と区別がつかなかった。
   */
  readonly analysisFailures: Pick<MusicAnalysisFailureRepository, 'record' | 'clear'>
  readonly mediaAssets: Pick<MediaAssetRepository, 'findById'>
  readonly storage: ObjectStorage
  readonly analyzer: MusicAnalyzer
  /**
   * `apps/audio` の `AUDIO_ROOT` に対応する、worker 側から見た共有ディレクトリ。
   * 音源はここへ書き出し、相対パスだけをサービスへ渡す。
   */
  readonly audioRoot: string
  readonly logger: Logger
  /** 既定 DEFAULT_ANALYZER_VERSION。解析器を差し替えたら一緒に変える。 */
  readonly analyzerVersion?: string
}

export type AnalysisOutcome =
  | { readonly state: 'skipped'; readonly reason: string }
  | { readonly state: 'analyzed'; readonly analysis: MusicAnalysis }
  | { readonly state: 'failed'; readonly code: string }

/** code を持つエラー（StorageError など）からコードを取り出す。 */
const errorCodeOf = (error: unknown): string => {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error ? error.name : 'unknown_error'
}

/**
 * 波形ピークをストレージへ置き、そのキーを返す。
 *
 * **解析行より先に置く。** `music_analyses.waveform_peaks_key` は NOT NULL で、
 * 実体の無いキーを指した行を作ると UI が必ず 404 を踏む。
 */
const storePeaks = async (
  storage: ObjectStorage,
  track: MusicTrack,
  result: Pick<MusicAnalysisResult, 'peaks' | 'waveform'>,
): Promise<string> => {
  const key = waveformKey(track.projectId, track.id)
  // v2（PHASE 8.1）: 音の大きさと 3 帯域も同じ JSON に置く。画面は version で描き分ける。
  const payload =
    result.waveform === null
      ? { peaks: result.peaks }
      : { version: 2, peaks: result.peaks, ...result.waveform }
  const body = new TextEncoder().encode(JSON.stringify(payload))
  await storage.put(key, body, { contentType: WAVEFORM_CONTENT_TYPE })
  return key
}

/** 解析 → ピーク保存 → 解析行の追記。途中で throw すれば行は作られない。 */
const analyzeAndStore = async (
  deps: AnalysisProcessorDeps,
  track: MusicTrack,
  expectedVersion: string,
  audioPath: string,
): Promise<AnalysisOutcome> => {
  const result: MusicAnalysisResult = await deps.analyzer.analyze(audioPath)

  /**
   * 冪等判定は `expectedVersion` を前提に済ませている。名乗りが違うということは
   * サービスを差し替えた（＝判定が空振りしていた）ということなので、必ず気付けるようにする。
   */
  if (result.analyzerVersion !== expectedVersion) {
    deps.logger.warn(
      { musicTrackId: track.id, expectedVersion, actual: result.analyzerVersion },
      '解析器バージョンが想定と異なります。冪等判定の設定を見直してください',
    )
  }

  const waveformPeaksKey = await storePeaks(deps.storage, track, result)

  const analysis = await deps.musicAnalyses.create({
    musicTrackId: track.id,
    analyzerVersion: result.analyzerVersion,
    durationSec: result.durationSec,
    bpm: result.bpm,
    bpmConfidence: result.bpmConfidence,
    beats: result.beats,
    downbeats: result.downbeats,
    sections: result.sections,
    energyCurve: result.energyCurve,
    onsets: result.onsets,
    drops: result.drops,
    waveformPeaksKey,
  })

  deps.logger.info(
    {
      musicTrackId: track.id,
      analyzerVersion: analysis.analyzerVersion,
      bpm: analysis.bpm,
      sections: analysis.sections.length,
    },
    '音楽解析が完了しました',
  )

  return { state: 'analyzed', analysis }
}

/**
 * 解析をやり直す必要が無い理由。無ければ null。
 * 手動補正を先に見るのは、自動解析の結果で人の判断を上書きしないため（ADR-0009）。
 */
const skipReason = async (
  deps: AnalysisProcessorDeps,
  musicTrackId: MusicTrackId,
  expectedVersion: string,
): Promise<string | null> => {
  const manual = await deps.musicAnalyses.findByTrackAndVersion(
    musicTrackId,
    MANUAL_ANALYZER_VERSION,
  )
  if (manual !== null) return 'manual_override'

  const existing = await deps.musicAnalyses.findByTrackAndVersion(musicTrackId, expectedVersion)
  return existing === null ? null : 'already_analyzed'
}

/**
 * analysis ジョブを 1 件処理する。
 *
 * MusicTrack / MediaAsset が見つからない場合だけ throw する（ジョブデータが
 * 実在しない行を指している＝再試行しても直らないが、握り潰すと原因が消えるため）。
 * 音源の取得・解析・保存の失敗は failed として返し、必ずログに残す。
 */
export const processAnalysisJob = async (
  deps: AnalysisProcessorDeps,
  data: unknown,
): Promise<AnalysisOutcome> => {
  const { musicTrackId } = AnalysisJobData.parse(data)
  const expectedVersion = deps.analyzerVersion ?? DEFAULT_ANALYZER_VERSION

  const track = await deps.musicTracks.findById(musicTrackId)
  if (track === null) {
    throw new Error(`MusicTrack が見つかりません: ${musicTrackId}`)
  }

  const reason = await skipReason(deps, musicTrackId, expectedVersion)
  if (reason !== null) {
    deps.logger.debug({ musicTrackId, reason }, '解析済みなので何もしません')
    return { state: 'skipped', reason }
  }

  const asset = await deps.mediaAssets.findById(track.mediaAssetId)
  if (asset === null) {
    throw new Error(
      `MusicTrack ${musicTrackId} の音源 MediaAsset が見つかりません: ${track.mediaAssetId}`,
    )
  }

  try {
    const outcome = await withTempDir(deps.audioRoot, TEMP_DIR_PREFIX, async (jobDir) => {
      const audioPath = await placeAudioForAnalysis(deps.storage, asset, deps.audioRoot, jobDir)
      return analyzeAndStore(deps, track, expectedVersion, audioPath)
    })
    // 成功したら前の失敗を消す。消せなくても解析は成立しているので、ログに残すだけ。
    await deps.analysisFailures.clear(musicTrackId).catch((error: unknown) => {
      deps.logger.warn({ musicTrackId, err: error }, '前の解析の失敗を消せませんでした')
    })
    return outcome
  } catch (error) {
    const code = errorCodeOf(error)
    deps.logger.error({ musicTrackId, code, err: error }, '音楽解析に失敗しました')
    /**
     * **画面が読める形で残す。** 残せなかったら画面は「まだ終わっていない」と見続けるが、
     * それで元の失敗を上書きしない（ログに両方残す）。
     */
    await deps.analysisFailures
      .record(musicTrackId, analysisFailureMessage(error))
      .catch((recordError: unknown) => {
        deps.logger.error({ musicTrackId, err: recordError }, '解析の失敗を記録できませんでした')
      })
    return { state: 'failed', code }
  }
}
