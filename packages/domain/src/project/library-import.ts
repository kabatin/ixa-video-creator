import type { CharacterId, MediaAssetId, MusicTrackId, ProjectId, SfxJobId } from '../common/ids.js'
import type { CreateMusicAnalysisInput, CreateMusicTrackInput, MusicAnalysis, MusicTrack } from '../music/music.js'
import { VOICE_NAME_MAX, type CreateVoiceProfileInput, type VoiceProfile } from '../narration/voice-profile.js'
import { SFX_SEEDS_USED_KEY, sfxSeedsUsedOf, type SfxJob, type SfxJobSpec } from '../sfx/sfx-job.js'
import { copyVoiceInput } from './duplication-copy.js'

/**
 * ほかの作品から声・楽曲・効果音を取り込む規則（ADR-0053。ADR-0034 の取り込みを素材ツリーの残りの段へ広げる）。
 * 制作者 2026-10-19「素材ツリーにある各種項目の素材を他のプロジェクトから簡単にコピーできるといいなぁ。
 * 現にいま、戦子ちゃんにある声素材が欲しいと思ってしまった」。**純粋関数だけを置く**（読み書きは API）。
 *
 * - 設定（行）は複製し、音のファイル（MediaAsset）は写さず同じものを指す（同じ中身を 2 つ作れない作り）
 * - 複製した後は別物（片方を直しても、もう片方は変わらない）
 * - 作品ごとのもの（テロップの見た目・取り込んでいないキャラクター）への結び付きは外す
 */

const suffixed = (base: string, n: number, maxLength: number): string => {
  const suffix = `（${String(n)}）`
  return `${base.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`
}

/** 取り込み先に同じ名前があれば「（2）」「（3）」…と空いている名前にする。上限の文字数に収める。 */
export const unusedName = (name: string, taken: readonly string[], maxLength: number): string => {
  const base = name.trim()
  const used = new Set(taken.map((other) => other.trim()))
  if (!used.has(base)) return base
  const free = Array.from({ length: used.size + 1 }, (_, index) => suffixed(base, index + 2, maxLength)).find(
    (candidate) => !used.has(candidate),
  )
  // used.size + 1 個の候補のうち少なくとも 1 つは空いている（鳩の巣）。
  return free ?? suffixed(base, used.size + 2, maxLength)
}

/**
 * 声を取り込み先の声にする。中身（AI・声の種類・イメージ・速さ・音量・言語・調整）はそのまま写す。
 * 誰の声かは、同じ取り込みでそのキャラクターも写したときだけ写した方を指す。テロップの見た目は作品ごとなので外す
 * （「ナレーション」の見た目になる）。名前が取り込み先とぶつかればずらす（作品の中で声の名前は一意）。
 */
export const importVoiceInput = (
  voice: VoiceProfile,
  ctx: {
    readonly projectId: ProjectId
    readonly characters: ReadonlyMap<CharacterId, CharacterId>
    readonly takenNames: readonly string[]
  },
): CreateVoiceProfileInput => ({
  ...copyVoiceInput(voice, { projectId: ctx.projectId, characters: ctx.characters, styles: new Map() }),
  name: unusedName(voice.name, ctx.takenNames, VOICE_NAME_MAX),
})

/**
 * 楽曲を取り込み先の楽曲にする。同じ音を指し、調整（位置・音量・フェード・曲の終わり）を写す。
 * **マスターにはしない**（取り込み先の尺・拍の基準を黙って替えない）。ただし取り込み先に曲が 1 曲も無ければ、
 * 「最初の 1 曲は必ずマスター」の規則でリポジトリがマスターにする。
 */
export const importMusicTrackInput = (track: MusicTrack, projectId: ProjectId): CreateMusicTrackInput => ({
  projectId,
  mediaAssetId: track.mediaAssetId,
  title: track.title,
  isMaster: false,
  offsetSec: track.offsetSec,
  volume: track.volume,
  fadeInSec: track.fadeInSec ?? 0,
  fadeOutSec: track.fadeOutSec ?? 0,
  endSec: track.endSec ?? null,
})

/** 解析（拍・セクション）を写した曲に付け替える。解析し直さない。写す列は名前で並べる（ID を写さない）。 */
export const copyMusicAnalysisInput = (analysis: MusicAnalysis, musicTrackId: MusicTrackId): CreateMusicAnalysisInput => ({
  musicTrackId,
  analyzerVersion: analysis.analyzerVersion,
  durationSec: analysis.durationSec,
  bpm: analysis.bpm,
  bpmConfidence: analysis.bpmConfidence,
  beats: analysis.beats,
  downbeats: analysis.downbeats,
  sections: analysis.sections,
  energyCurve: analysis.energyCurve,
  onsets: analysis.onsets,
  drops: analysis.drops,
  waveformPeaksKey: analysis.waveformPeaksKey,
})

/** 取り込んだ効果音の元（作品とジョブ）を記録に入れる鍵。 */
export const SFX_IMPORTED_FROM_KEY = 'importedFrom'

/** 取り込んだ効果音 1 本を、取り込み先の「できた効果音」の行として記すときの中身。 */
export type ImportedSfxSound = {
  readonly projectId: ProjectId
  readonly tool: string
  readonly model: string | null
  readonly spec: SfxJobSpec
  readonly mediaAssetIds: readonly MediaAssetId[]
  readonly providerRecord: Record<string, unknown>
}

/**
 * 作った効果音の 1 本を、取り込み先の**置いていない候補**にする（効果音の段には置かない）。
 * 取り込み先では「1 本だけ作ったジョブ」の形にする（素材ツリーは、成功したジョブの音を候補として並べる）。
 * きっかけの文はそのまま名前になり、その音の種を残すので、取り込み先でも同じ音を作り直せる。
 * できていないジョブ・ジョブに無い音は null（取り込めない）。
 */
export const importSfxSoundInput = (
  job: SfxJob,
  mediaAssetId: MediaAssetId,
  projectId: ProjectId,
): ImportedSfxSound | null => {
  const index = job.mediaAssetIds.indexOf(mediaAssetId)
  if (job.status !== 'succeeded' || index < 0) return null
  const seed = sfxSeedsUsedOf(job)[index] ?? null
  const from: { readonly projectId: ProjectId; readonly sfxJobId: SfxJobId } = { projectId: job.projectId, sfxJobId: job.id }
  return {
    projectId,
    tool: job.tool,
    model: job.model,
    spec: { cue: job.spec.cue, count: 1, seed },
    mediaAssetIds: [mediaAssetId],
    providerRecord: { [SFX_SEEDS_USED_KEY]: [seed], [SFX_IMPORTED_FROM_KEY]: from },
  }
}
