import type {
  CharacterId,
  CharacterLookId,
  LocationId,
  ProjectId,
  SequenceId,
  ShotId,
  TakeId,
} from '../common/ids.js'
import { NarrationLineId, TextStyleId } from '../common/ids.js'
import type { VoiceProfileId } from '../common/ids.js'
import type { CreateNarrationLineInput, NarrationLine } from '../narration/narration-line.js'
import type { NarrationTake } from '../narration/narration-take.js'
import type { CreateVoiceProfileInput, VoiceProfile } from '../narration/voice-profile.js'
import { computeSpecHash } from '../generation/spec-compiler.js'
import type { CreateTakeInput, Take } from '../generation/take.js'
import type {
  CreateShotInput,
  CreateTransitionInput,
  Shot,
  ShotCharacter,
  ShotStatus,
  Transition,
} from '../shot/shot.js'
import type { ShotSourceType } from '../shot/source-type.js'
import type { CreateTimelineClipInput, TimelineClip, TimelineClipContent } from '../timeline/timeline.js'

/**
 * 作品の複製で、行を新しい作品へ写す規則（制作者 2026-10-04）。**純粋関数だけを置く**（読み書きは API）。
 *
 * - ID は新しくし、元の ID から新しい ID への付け替え表（`ReadonlyMap`）で参照を張り直す
 * - 画像・動画のファイル（MediaAsset）は写さず、同じものを指す（同じ中身を 2 つ作れない作り）
 * - 持っていかなかったものへの参照は外し、外した数を返す（知らせに使う）
 */

type IdMap<T extends string> = ReadonlyMap<T, T>

const remapOrNull = <T extends string>(id: T | null, map: IdMap<T>): T | null =>
  id === null ? null : (map.get(id) ?? null)

/** 前の Take から作る指定だけが ID を持つ。ほかの作り方（画像・動画）は同じファイルを指したまま。 */
const remapSourceType = (sourceType: ShotSourceType, takes: IdMap<TakeId>): ShotSourceType =>
  sourceType.type === 'ai_image_to_video'
    ? { ...sourceType, keyframeTakeId: remapOrNull(sourceType.keyframeTakeId, takes) }
    : sourceType

export type ShotCopyContext = {
  readonly projectId: ProjectId
  /** 絵コンテ（説明・雰囲気・台詞）を持っていくか。 */
  readonly keepStoryboard: boolean
  /** 写したロケーション。持っていかなければ空。 */
  readonly locations: IdMap<LocationId>
  readonly sequences: IdMap<SequenceId>
  /** 写す Take（新しい ID を先に決めておく）。持っていかなければ空。 */
  readonly takes: IdMap<TakeId>
  /** 写した中身から決め直した状態（元の状態は写さない）。 */
  readonly status: ShotStatus
}

/** Shot を新しい作品の Shot にする。採用 Take とロックは作った後に付ける（作成の入力に無いため）。 */
export const copyShotInput = (
  shot: Shot,
  ctx: ShotCopyContext,
): { readonly input: CreateShotInput; readonly locationDropped: boolean } => {
  const locationId = remapOrNull(shot.locationId, ctx.locations)
  return {
    input: {
      projectId: ctx.projectId,
      sequenceId: remapOrNull(shot.sequenceId, ctx.sequences),
      order: shot.order,
      code: shot.code,
      startSec: shot.startSec,
      durationSec: shot.durationSec,
      sourceInSec: shot.sourceInSec,
      timing: shot.timing,
      description: ctx.keepStoryboard ? shot.description : '',
      dialogue: ctx.keepStoryboard ? shot.dialogue : null,
      camera: shot.camera,
      mood: ctx.keepStoryboard ? shot.mood : null,
      continuityMode: shot.continuityMode,
      locationId,
      sourceType: remapSourceType(shot.sourceType, ctx.takes),
      status: ctx.status,
    },
    locationDropped: shot.locationId !== null && locationId === null,
  }
}

/** Shot の登場人物 1 人ぶん（Shot はパスで渡す）。 */
export type CastEntry = Omit<ShotCharacter, 'shotId'>

/** 登場人物を写したキャラクター・Look へ付け替える。写していない人は外して数える。 */
export const copyCastEntries = (
  entries: readonly ShotCharacter[],
  maps: { readonly characters: IdMap<CharacterId>; readonly looks: IdMap<CharacterLookId> },
): { readonly entries: readonly CastEntry[]; readonly dropped: number } => {
  const copied = entries.flatMap((entry) => {
    const characterId = maps.characters.get(entry.characterId)
    const lookId = maps.looks.get(entry.lookId)
    return characterId === undefined || lookId === undefined
      ? []
      : [{ characterId, lookId, prominence: entry.prominence, order: entry.order }]
  })
  return { entries: copied, dropped: entries.length - copied.length }
}

export type ClipCopyContext = {
  readonly projectId: ProjectId
  /** 写した文字の見た目（保存した見た目）。 */
  readonly styles: IdMap<TextStyleId>
  /** 歌詞（作品の方針）を持っていくか。持っていかなければ「何行目か」の結び付きを外す。 */
  readonly keepLyricLink: boolean
  /** 写したナレーションの行（ADR-0038）。写していない行への印は外す（手で置いたテロップになり、作り直しで消えない）。 */
  readonly narrationLines: IdMap<NarrationLineId>
}

/** 保存した見た目の付け替え。写していない・読めない印は null（上書きの見た目は残るので見た目は変わらない）。 */
const remapStyleId = (styleId: unknown, styles: IdMap<TextStyleId>): TextStyleId | null => {
  const parsed = TextStyleId.safeParse(styleId)
  return parsed.success ? (styles.get(parsed.data) ?? null) : null
}

/** テロップ（文字）の中身。見た目は付け替え、歌詞との結び付きは残すか外す。**文字と見た目の上書きは残す。** */
const copyTextParams = (
  params: Readonly<Record<string, unknown>>,
  ctx: ClipCopyContext,
): {
  readonly params: Record<string, unknown>
  readonly lyricLinkDropped: boolean
  readonly narrationLinkDropped: boolean
} => {
  const { lyricLine, styleId, narrationLineId, ...rest } = params
  const style = styleId === undefined ? {} : { styleId: remapStyleId(styleId, ctx.styles) }
  const keepLine = ctx.keepLyricLink && lyricLine !== undefined
  const parsedLine = NarrationLineId.safeParse(narrationLineId)
  const movedLine = parsedLine.success ? (ctx.narrationLines.get(parsedLine.data) ?? null) : null
  return {
    params: {
      ...rest,
      ...style,
      ...(keepLine ? { lyricLine } : {}),
      ...(movedLine === null ? {} : { narrationLineId: movedLine }),
    },
    lyricLinkDropped: !ctx.keepLyricLink && lyricLine !== undefined,
    narrationLinkDropped: movedLine === null && narrationLineId !== undefined,
  }
}

/** タイムラインのクリップを新しい作品のクリップにする。重ね素材は同じファイルを指したまま。 */
export const copyClipInput = (
  clip: TimelineClip,
  ctx: ClipCopyContext,
): {
  readonly input: CreateTimelineClipInput
  readonly lyricLinkDropped: boolean
  readonly narrationLinkDropped: boolean
} => {
  const text = clip.content.type === 'text' ? copyTextParams(clip.content.params, ctx) : null
  const content: TimelineClipContent =
    clip.content.type === 'text' && text !== null ? { ...clip.content, params: text.params } : clip.content
  return {
    input: {
      projectId: ctx.projectId,
      track: clip.track,
      startSec: clip.startSec,
      durationSec: clip.durationSec,
      layer: clip.layer,
      content,
      opacity: clip.opacity,
    },
    lyricLinkDropped: text?.lyricLinkDropped ?? false,
    narrationLinkDropped: text?.narrationLinkDropped ?? false,
  }
}

/**
 * 声（ADR-0038）を新しい作品の声にする。中身はそのまま写し、誰の声か・テロップの見た目は写した先へ指し直す。
 * 持っていかなかったものへの結び付きは外す（声そのものは残る）。
 */
export const copyVoiceInput = (
  voice: VoiceProfile,
  ctx: {
    readonly projectId: ProjectId
    readonly characters: IdMap<CharacterId>
    readonly styles: IdMap<TextStyleId>
  },
): CreateVoiceProfileInput => ({
  projectId: ctx.projectId,
  name: voice.name,
  tool: voice.tool,
  model: voice.model,
  voiceName: voice.voiceName,
  styleNote: voice.styleNote,
  speed: voice.speed,
  volume: voice.volume,
  language: voice.language,
  tuning: voice.tuning,
  textStyleId: remapOrNull(voice.textStyleId, ctx.styles),
  characterId: remapOrNull(voice.characterId, ctx.characters),
})

/** 原稿の行を新しい作品の行にする。話す声は写した先へ。写していなければ「声が未定」。 */
export const copyNarrationLineInput = (
  line: NarrationLine,
  ctx: { readonly projectId: ProjectId; readonly voices: IdMap<VoiceProfileId> },
): CreateNarrationLineInput => ({
  projectId: ctx.projectId,
  order: line.order,
  text: line.text,
  reading: line.reading,
  voiceProfileId: remapOrNull(line.voiceProfileId, ctx.voices),
  direction: line.direction,
  startSec: line.startSec,
  telop: line.telop,
})

/**
 * 声の Take を新しい行の Take にする。**音のファイルは同じものを指す**（元の作品で作ったので作り直さない）。
 * 出どころは「写したもの」にする（元のジョブは別の作品の記録なので指さない）。
 */
export const copyNarrationTakeInput = (
  take: NarrationTake,
  lines: IdMap<NarrationLineId>,
): Omit<NarrationTake, 'id' | 'index' | 'createdAt'> => {
  const lineId = lines.get(take.lineId)
  if (lineId === undefined) throw new Error('複製する声の Take の付け替え先がありません（行を写し損ねています）')
  return {
    lineId,
    source: { type: 'copied', fromTakeId: take.id },
    mediaAssetId: take.mediaAssetId,
    inSec: take.inSec,
    outSec: take.outSec,
    spokenText: take.spokenText,
    displayText: take.displayText,
    specHash: take.specHash,
    charTimes: take.charTimes,
    loudnessLufs: take.loudnessLufs,
    peaks: take.peaks,
    costUsd: take.costUsd,
  }
}

/** テロップ（文字のクリップ）か。それ以外（画像・動画・音・モーション）は「エフェクト・重ね素材・効果音」。 */
export const isTelopClip = (clip: Pick<TimelineClip, 'content'>): boolean => clip.content.type === 'text'

/** トランジションは、両側の Shot を写したときだけ写す。 */
export const copyTransitionInputs = (
  transitions: readonly Transition[],
  ctx: { readonly projectId: ProjectId; readonly shots: IdMap<ShotId> },
): readonly CreateTransitionInput[] =>
  transitions.flatMap((transition) => {
    const fromShotId = ctx.shots.get(transition.fromShotId)
    const toShotId = ctx.shots.get(transition.toShotId)
    return fromShotId === undefined || toShotId === undefined
      ? []
      : [{ projectId: ctx.projectId, fromShotId, toShotId, type: transition.type, durationSec: transition.durationSec }]
  })

/**
 * Take を新しい Shot の Take にする（ID は先に決めた付け替え表から）。
 *
 * 生成の記録（spec）の Shot も新しい Shot に書き換え、同じ生成かの判定（specHash）を計算し直す。
 * 書き換えないと、複製先で同じ指定の生成を「同じもの」と見分けられない。
 * 作り直しの元が写っていなければ外し、理由は残す（`lineagePairViolation` は理由だけの形を許す）。
 */
export const copyTakeInput = async (
  take: Take,
  maps: { readonly shots: IdMap<ShotId>; readonly takes: IdMap<TakeId> },
): Promise<CreateTakeInput & { readonly id: TakeId }> => {
  const id = maps.takes.get(take.id)
  const shotId = maps.shots.get(take.shotId)
  if (id === undefined || shotId === undefined) {
    throw new Error('複製する Take の付け替え先がありません（Take か Shot を写し損ねています）')
  }
  const spec = { ...take.spec, shotId }
  return {
    id,
    shotId,
    mediaAssetId: take.mediaAssetId,
    spec,
    specHash: await computeSpecHash(spec),
    providerId: take.providerId,
    modelId: take.modelId,
    providerParams: take.providerParams,
    seedUsed: take.seedUsed,
    costUsd: take.costUsd,
    generationTimeSec: take.generationTimeSec,
    parentTakeId: remapOrNull(take.parentTakeId, maps.takes),
    regenerationReason: take.regenerationReason,
    // 元の Take の印。この作品の費用・予算・作り直しの回数に数えない（`countsAsSpend`）。
    copiedFromTakeId: take.id,
  }
}

/** 外したものの数。 */
export type DuplicationDrops = {
  /** 登場人物を外した Shot の数。 */
  readonly castDropped: number
  /** ロケーションを外した Shot の数。 */
  readonly locationDropped: number
  /** 歌詞との結び付きを外したテロップの数。 */
  readonly lyricLinksDropped: number
  /** ナレーションとの結び付きを外したテロップの数（ADR-0038）。 */
  readonly narrationLinksDropped: number
  /** 声を持っていかなかったので、キャラクターから外した声の数。 */
  readonly characterVoicesDropped: number
}

/** 外したものを、数と理由で言う（ID を出さない）。何も外していなければ空。 */
export const duplicationNotes = (drops: DuplicationDrops): readonly string[] => [
  ...(drops.castDropped > 0
    ? [`キャラクターを持っていかなかったので、Shot ${String(drops.castDropped)} 件の登場人物を外しました`]
    : []),
  ...(drops.locationDropped > 0
    ? [`ロケーションを持っていかなかったので、Shot ${String(drops.locationDropped)} 件のロケーションを外しました`]
    : []),
  ...(drops.lyricLinksDropped > 0
    ? [
        `作品の方針を持っていかなかったので、テロップ ${String(drops.lyricLinksDropped)} 件の歌詞との結び付きを外しました（文字は残っています）`,
      ]
    : []),
  ...(drops.narrationLinksDropped > 0
    ? [
        `ナレーションを持っていかなかったので、テロップ ${String(drops.narrationLinksDropped)} 件のナレーションとの結び付きを外しました（文字は残り、作り直しで消えません）`,
      ]
    : []),
  ...(drops.characterVoicesDropped > 0
    ? [`声を持っていかなかったので、キャラクター ${String(drops.characterVoicesDropped)} 人の声を外しました`]
    : []),
]
