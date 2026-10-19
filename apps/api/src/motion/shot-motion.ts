import {
  energyOnTimeline,
  motionEventsOnTimeline,
  motionEventsToSfxCues,
  onsetsOnTimeline,
  type MotionAnalysis,
  type MotionOnset,
  type MotionSfxSuggestion,
  type ProjectId,
  type Shot,
  type TakeId,
  type TimelineEnergyCurve,
  type TimelineMotionEvent,
} from '@ixa/domain'
import type { MotionAnalysisDeps } from './deps.js'

/**
 * 動きの分析を読む（ADR-0054）。**時刻は Take の秒で残っている**ので、Shot の今の使い始め・速さで
 * タイムラインの秒に直すのはここ（読むたびに直す）。
 */

export type MotionState = 'none' | 'queued' | 'running' | 'succeeded' | 'failed'

export type TakeMotionStatus = {
  readonly state: MotionState
  /** 失敗の理由（いちばん新しい行が失敗のとき）。 */
  readonly failureMessage: string | null
  /** いちばん新しい成功の結果。作り直し中・失敗の後でも前の結果は見せる。 */
  readonly analysis: MotionAnalysis | null
}

export const takeMotionStatus = async (deps: MotionAnalysisDeps, takeId: TakeId): Promise<TakeMotionStatus> => {
  const [queued, latest, succeeded] = await Promise.all([
    deps.queue.stateOf(takeId),
    deps.analyses.findLatestByTake(takeId),
    deps.analyses.findLatestSucceededByTakes([takeId]),
  ])
  const analysis = succeeded.get(takeId) ?? null
  const failureMessage = latest?.status === 'failed' ? latest.failureMessage : null
  if (queued !== null) return { state: queued, failureMessage: null, analysis }
  if (latest === null) return { state: 'none', failureMessage: null, analysis: null }
  return { state: latest.status, failureMessage, analysis }
}

/** プレビュー・書き出しと同じ Take の長さ（素材の probe）。分からなければ null。 */
const takeDurationOf = async (deps: MotionAnalysisDeps, takeId: TakeId): Promise<number | null> => {
  const take = await deps.takes.findById(takeId)
  if (take === null) return null
  const asset = await deps.mediaAssets.findById(take.mediaAssetId)
  return asset?.probe?.durationSec ?? null
}

export type ShotMotionView = TakeMotionStatus & {
  readonly takeId: TakeId | null
  readonly energy: TimelineEnergyCurve | null
  readonly onsets: readonly MotionOnset[]
  readonly events: readonly TimelineMotionEvent[]
  readonly suggestions: readonly MotionSfxSuggestion[]
}

const EMPTY = { energy: null, onsets: [], events: [], suggestions: [] } as const

/** Shot の採用中の Take の分析を、タイムラインの秒で返す。 */
export const shotMotionView = async (deps: MotionAnalysisDeps, shot: Shot): Promise<ShotMotionView> => {
  if (shot.selectedTakeId === null) {
    return { state: 'none', failureMessage: null, analysis: null, takeId: null, ...EMPTY }
  }
  const takeId = shot.selectedTakeId
  const status = await takeMotionStatus(deps, takeId)
  if (status.analysis === null) return { ...status, takeId, ...EMPTY }
  const takeDurationSec = await takeDurationOf(deps, takeId)
  const events = motionEventsOnTimeline(shot, takeDurationSec, status.analysis.events)
  return {
    ...status,
    takeId,
    energy: energyOnTimeline(shot, takeDurationSec, status.analysis.energy, status.analysis.energyHopSec),
    onsets: onsetsOnTimeline(shot, takeDurationSec, status.analysis.onsets),
    events,
    suggestions: motionEventsToSfxCues(events),
  }
}

/** 作品の全 Shot の採用中の Take の出来事（タイムラインの秒）。効果音の案の材料（`suggestSfxCues`）。 */
export const loadProjectMotionEvents = async (
  deps: MotionAnalysisDeps,
  projectId: ProjectId,
): Promise<readonly TimelineMotionEvent[]> => {
  const shots = (await deps.shots.findByProject(projectId)).filter(
    (shot): shot is Shot & { selectedTakeId: TakeId } => shot.selectedTakeId !== null,
  )
  const analyses = await deps.analyses.findLatestSucceededByTakes(shots.map((shot) => shot.selectedTakeId))
  const perShot = await Promise.all(
    shots.map(async (shot) => {
      const analysis = analyses.get(shot.selectedTakeId)
      if (analysis === undefined) return []
      return motionEventsOnTimeline(shot, await takeDurationOf(deps, shot.selectedTakeId), analysis.events)
    }),
  )
  return perShot.flat().sort((a, b) => a.startSec - b.startSec)
}
