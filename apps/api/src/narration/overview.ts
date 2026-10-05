import {
  estimateSpeechSec,
  lineReading,
  takeDurationSec,
  voiceSpecHash,
  voiceSpecOf,
  type NarrationLine,
  type NarrationTake,
  type ProjectId,
  type ReadingEntry,
  type VoiceJob,
  type VoiceProfile,
} from '@ixa/domain'
import type { NarrationDeps } from './deps.js'

/**
 * ナレーションの一覧（ADR-0038）。行に、読み（辞書から）・話す長さの見積もり・声の Take・作り直しが要るか・
 * 最後のジョブを添える。画面はこれを 1 回取れば描ける。
 */

export type NarrationLineView = NarrationLine & {
  /** 声の AI に渡す読み（手で入れた読み、無ければ辞書から）。 */
  readonly reading: string
  readonly readingIsManual: boolean
  /** 話す長さの見積もり（秒。声の速さで割る）。 */
  readonly estimatedSec: number
  /** 選んだ Take の長さ。無ければ null。 */
  readonly durationSec: number | null
  /** 選んだ Take を作ったときと、読み・声・設定が変わったか（作り直しが要る）。 */
  readonly stale: boolean
  readonly takes: readonly NarrationTake[]
  /** 最後の声のジョブ（状態と失敗の理由）。 */
  readonly job: VoiceJob | null
}

export type NarrationOverview = {
  readonly lines: readonly NarrationLineView[]
  readonly totalEstimatedSec: number
  /** 置いた行のいちばん後ろの終わり（秒）。置いていなければ 0。 */
  readonly endSec: number
}

/** 行の長さ。選んだ Take があればその長さ、無ければ見積もり。 */
export const lineLengthSec = (view: Pick<NarrationLineView, 'durationSec' | 'estimatedSec'>): number =>
  view.durationSec ?? view.estimatedSec

const viewOf = async (
  line: NarrationLine,
  context: {
    readonly voices: ReadonlyMap<string, VoiceProfile>
    readonly takes: readonly NarrationTake[]
    readonly job: VoiceJob | null
    readonly dictionary: readonly ReadingEntry[]
  },
): Promise<NarrationLineView> => {
  const voice = line.voiceProfileId === null ? undefined : context.voices.get(line.voiceProfileId)
  const reading = lineReading(line, context.dictionary).reading
  const selected = context.takes.find((take) => take.id === line.selectedTakeId)
  const currentHash = voice === undefined ? null : await voiceSpecHash(voiceSpecOf(voice, line, reading))
  return {
    ...line,
    reading,
    readingIsManual: line.reading !== null,
    estimatedSec: estimateSpeechSec(reading, voice?.speed ?? 1),
    durationSec: selected === undefined ? null : takeDurationSec(selected),
    // 録音の Take（指定のハッシュが無い）は、作り直すものではない。
    stale: selected !== undefined && selected.specHash !== null && currentHash !== null && selected.specHash !== currentHash,
    takes: context.takes,
    job: context.job,
  }
}

export const buildNarrationOverview = async (deps: NarrationDeps, projectId: ProjectId): Promise<NarrationOverview> => {
  const [lines, voices, settings] = await Promise.all([
    deps.lines.findByProject(projectId),
    deps.voices.findByProject(projectId),
    deps.audioSettings.get(projectId),
  ])
  const lineIds = lines.map((line) => line.id)
  const [takes, jobs] = await Promise.all([deps.takes.findByLines(lineIds), deps.voiceJobs.findLatestByLines(lineIds)])
  const voiceMap = new Map(voices.map((voice) => [voice.id as string, voice]))
  const views = await Promise.all(
    lines.map((line) =>
      viewOf(line, {
        voices: voiceMap,
        takes: takes.filter((take) => take.lineId === line.id),
        job: jobs.find((job) => job.lineId === line.id) ?? null,
        dictionary: settings.readingDictionary,
      }),
    ),
  )
  const endSec = views.reduce((latest, view) => (view.startSec === null ? latest : Math.max(latest, view.startSec + lineLengthSec(view))), 0)
  return {
    lines: views,
    totalEstimatedSec: Math.round(views.reduce((sum, view) => sum + view.estimatedSec, 0) * 10) / 10,
    endSec,
  }
}
