import {
  DbNotFoundError,
  type NarrationLineRepository,
  type NarrationTakeRepository,
  type ProjectAudioSettingsRepository,
  type TextStyleRepository,
  type TimelineClipRepository,
  type VoiceProfileRepository,
} from '@ixa/db'
import {
  DEFAULT_NARRATION_TEXT_STYLE,
  NARRATION_STYLE_NAME,
  canonicalJson,
  narrationLineOf,
  narrationTelopClips,
  parseTextClipParams,
  type CreateTimelineClipInput,
  type NarrationLine,
  type NarrationLineId,
  type ProjectId,
  type TextStylePreset,
  type TimelineClip,
  type VoiceProfile,
} from '@ixa/domain'

/**
 * ナレーションのテロップを、行に合わせて作り直す（ADR-0038）。API（行を直した・並べた）と worker（声ができた）の
 * 両方から呼ぶ（規則を 2 か所に書かない）。**ナレーションから作ったテロップだけを差し替える**（手で置いたテロップ・歌詞は触らない）。
 * 中身が変わらなければ何もしない（タイムラインを無駄に書き換えない）。
 *
 * **見た目は当てたときに写す（ADR-0028）。** 作り直しても、その行の今のテロップの見た目を引き継ぐ（手で当てた見た目を消さない）。
 * 声の見た目で選び直すのは、テロップがまだ無い行と、呼び出し側が `restyle` で渡した行（話す声・声の見た目を変えた）だけ。
 */

export type NarrationTelopSyncDeps = {
  readonly lines: Pick<NarrationLineRepository, 'findByProject'>
  readonly takes: Pick<NarrationTakeRepository, 'findByLines'>
  readonly voices: Pick<VoiceProfileRepository, 'findByProject'>
  readonly audioSettings: Pick<ProjectAudioSettingsRepository, 'get'>
  readonly textStyles: Pick<TextStyleRepository, 'findByProject'>
  readonly timelineClips: Pick<TimelineClipRepository, 'findByProject' | 'replace'>
}

type Look = { readonly style: TextStylePreset['style']; readonly styleId: TextStylePreset['id'] | null }

/** 行の見た目。声に見た目があればそれ、無ければ「ナレーション」の見た目、それも無ければ既定。 */
const lookFor = (
  line: NarrationLine,
  voices: readonly VoiceProfile[],
  presets: readonly TextStylePreset[],
): Look => {
  const voiceStyleId = voices.find((voice) => voice.id === line.voiceProfileId)?.textStyleId ?? null
  const preset =
    (voiceStyleId === null ? undefined : presets.find((candidate) => candidate.id === voiceStyleId)) ??
    presets.find((candidate) => candidate.name === NARRATION_STYLE_NAME)
  return preset === undefined ? { style: DEFAULT_NARRATION_TEXT_STYLE, styleId: null } : { style: preset.style, styleId: preset.id }
}

/** 比べるための形（ID・作った時刻を除く。作る前の入力は層と不透明度を省けるので、既定で埋める）。 */
const shapeOf = (clip: Pick<CreateTimelineClipInput, 'track' | 'startSec' | 'durationSec' | 'layer' | 'opacity'> & { readonly content: unknown }): string =>
  canonicalJson({ track: clip.track, startSec: clip.startSec, durationSec: clip.durationSec, layer: clip.layer ?? 0, opacity: clip.opacity ?? 1, content: clip.content })

const lineOf = (clip: TimelineClip): NarrationLineId | null =>
  clip.content.type === 'text' ? narrationLineOf(clip.content.params) : null

/** その行の今のテロップ（いちばん前の枚）の見た目。読めなければ null（声の見た目で選び直す）。 */
const currentLook = (lineId: NarrationLineId, telops: readonly TimelineClip[]): Look | null => {
  const first = telops.filter((clip) => lineOf(clip) === lineId).sort((a, b) => a.startSec - b.startSec)[0]
  const params = first?.content.type === 'text' ? parseTextClipParams(first.content.params) : null
  return params?.style === undefined ? null : { style: params.style, styleId: params.styleId ?? null }
}

type SyncOptions = { readonly restyle?: readonly NarrationLineId[] }
type SyncResult = { readonly changed: boolean; readonly count: number }

const syncOnce = async (deps: NarrationTelopSyncDeps, projectId: ProjectId, options: SyncOptions): Promise<SyncResult> => {
  const [lines, voices, settings, presets, clips] = await Promise.all([
    deps.lines.findByProject(projectId),
    deps.voices.findByProject(projectId),
    deps.audioSettings.get(projectId),
    deps.textStyles.findByProject(projectId),
    deps.timelineClips.findByProject(projectId),
  ])
  const takes = await deps.takes.findByLines(lines.map((line) => line.id))
  const existing = clips.filter((clip) => lineOf(clip) !== null)
  const restyle = new Set<string>(options.restyle ?? [])
  const desired: readonly CreateTimelineClipInput[] = narrationTelopClips({
    projectId,
    lines: lines.map((line) => ({
      line,
      take: takes.find((take) => take.id === line.selectedTakeId) ?? null,
      style: (restyle.has(line.id) ? null : currentLook(line.id, existing)) ?? lookFor(line, voices, presets),
    })),
    dictionary: settings.readingDictionary,
    highlight: settings.telopHighlight,
  })
  const same =
    existing.length === desired.length &&
    existing.map(shapeOf).sort().join('\n') === desired.map(shapeOf).sort().join('\n')
  if (same) return { changed: false, count: desired.length }
  await deps.timelineClips.replace(
    existing.map((clip) => clip.id),
    desired,
  )
  return { changed: true, count: desired.length }
}

/**
 * 作り直す。API（行を動かした）と worker（声ができた）が同じ作品で重なると、先に差し替えた側が相手を消しているので、
 * 後の側は消す相手が無い（`DbNotFoundError`）。そのときは読み直して 1 度だけやり直す（後から来た内容で揃える）。
 */
export const syncNarrationTelops = async (
  deps: NarrationTelopSyncDeps,
  projectId: ProjectId,
  options: SyncOptions = {},
): Promise<SyncResult> => {
  try {
    return await syncOnce(deps, projectId, options)
  } catch (error) {
    if (!(error instanceof DbNotFoundError)) throw error
    return syncOnce(deps, projectId, options)
  }
}
