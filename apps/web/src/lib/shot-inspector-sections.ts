import type { Shot, Take } from '@ixa/domain'
import { SHOT_SIZE_OPTIONS } from '@/lib/camera-options'
import { formatClock, formatDuration } from '@/lib/format-time'

/**
 * Shot のインスペクターの区切り（UI-WORKBENCH-2 §5.2、2026-10-26）。**React を含まない。**
 * 並びは作業の順。目次・畳んだときの要約・既定の開け閉めをここで決める（画面の部品に書き写さない）。
 */

export const SHOT_SECTION_IDS = [
  'storyboard',
  'references',
  'dialogue',
  'frame',
  'take',
  'time',
  'details',
  'review',
] as const
export type ShotSectionId = (typeof SHOT_SECTION_IDS)[number]

export const SHOT_SECTION_TITLES: Readonly<Record<ShotSectionId, string>> = Object.freeze({
  storyboard: '絵コンテ',
  references: '参照',
  dialogue: 'セリフ',
  frame: '絵',
  take: 'Take',
  time: '時間',
  details: '詳しい設定',
  review: 'レビュー',
})

/** 要約に要る、画面が知っていること。 */
export type ShotSectionFacts = {
  readonly shot: Pick<Shot, 'description' | 'dialogue' | 'selectedTakeId' | 'startSec' | 'durationSec' | 'camera'>
  /** ロケーションの名前。無ければ null。 */
  readonly locationName: string | null
  /** 最初のフレームが付いているか。**null は「まだ分からない」**（付いていないと混ぜない）。 */
  readonly hasStartFrame: boolean | null
  /** null は「まだ読めていない」。 */
  readonly takes: readonly Pick<Take, 'id' | 'index'>[] | null
}

const adoptedIndex = (facts: ShotSectionFacts): number | null =>
  facts.takes?.find((take) => take.id === facts.shot.selectedTakeId)?.index ?? null

/** 畳んだときに見出しに添える 1 行。言えることが無ければ undefined。 */
export const shotSectionSummary = (id: ShotSectionId, facts: ShotSectionFacts): string | undefined => {
  const { shot } = facts
  switch (id) {
    case 'storyboard':
      return shot.description.trim() === '' ? 'まだ空' : '説明あり'
    case 'references':
      return facts.locationName ?? 'ロケーションなし'
    case 'dialogue':
      return shot.dialogue.length === 0 ? 'なし' : `${String(shot.dialogue.length)} 行`
    case 'frame':
      if (facts.hasStartFrame === null) return undefined
      return facts.hasStartFrame ? '最初のフレームあり' : '最初のフレームなし'
    case 'take': {
      if (facts.takes === null) return '読み込んでいます'
      const adopted = adoptedIndex(facts)
      return `${String(facts.takes.length)} 本・採用 ${adopted === null ? 'なし' : `Take ${String(adopted)}`}`
    }
    case 'time':
      return `${formatClock(shot.startSec)} / ${formatDuration(shot.durationSec)}`
    case 'details':
      return SHOT_SIZE_OPTIONS.find((option) => option.value === shot.camera.size)?.label
    case 'review': {
      const adopted = adoptedIndex(facts)
      return adopted === null ? '採用 Take なし' : `Take ${String(adopted)}`
    }
  }
}

/** 目次に出す短い名前（数が言えるものだけ添える）。 */
export const shotSectionTocLabel = (id: ShotSectionId, facts: ShotSectionFacts): string => {
  if (id === 'dialogue' && facts.shot.dialogue.length > 0) return `セリフ ${String(facts.shot.dialogue.length)}`
  if (id === 'take' && facts.takes !== null) return `Take ${String(facts.takes.length)}本`
  return SHOT_SECTION_TITLES[id]
}

/**
 * 覚えていないときの開け閉め（制作者 2026-10-26）。作る途中で触るものを開き、普段触らないものを畳む。
 * 絵は最初のフレームがまだ無いときだけ開く（あれば絵を作る用は済んでいる）。
 */
export const shotSectionDefaultOpen = (id: ShotSectionId, facts: ShotSectionFacts): boolean => {
  switch (id) {
    case 'storyboard':
    case 'references':
    case 'take':
      return true
    case 'dialogue':
      return facts.shot.dialogue.length > 0
    case 'frame':
      return facts.hasStartFrame !== true
    case 'time':
    case 'details':
    case 'review':
      return false
  }
}
