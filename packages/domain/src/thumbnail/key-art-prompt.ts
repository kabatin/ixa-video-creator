import type { MediaAssetId } from '../common/ids.js'
import type { Character, CharacterIdentityImage, IdentityImageRole } from '../character/character.js'
import type { Project } from '../project/project.js'

/**
 * サムネイルの背景（キーアート）を AI に描かせる指示（ADR-0051）。**純粋な関数のみ。**
 *
 * 材料は作品の方針（コンセプト・ルック・避けたいもの）と登場人物。サムネイルの主役の絵として、
 * 顔を大きく・強いコントラスト・**左に大きな題名を置く余白**を言う（題名は後から Thumbnail コンポジションが載せる）。
 * 絵の中に文字を描かせない（題名と二重になり、AI の文字は崩れる）。
 */

export type KeyArtCastMember = Pick<Character, 'displayName' | 'description' | 'identityAnchors'>

export type KeyArtPromptInput = {
  readonly project: Pick<Project, 'name' | 'styleGuide' | 'avoid'>
  /** 作品のコンセプト・あらすじ（脚本のいまの版）。無ければ空。 */
  readonly concept: string
  readonly cast: readonly KeyArtCastMember[]
  /** 制作者の自由な指示。無ければ null。 */
  readonly instruction: string | null
}

const section = (label: string, value: string): readonly string[] => {
  const trimmed = value.trim()
  return trimmed === '' ? [] : ['', `${label}:`, trimmed]
}

const castLine = (member: KeyArtCastMember): string => {
  const traits = [...member.identityAnchors, member.description.trim()].filter((value) => value !== '')
  return traits.length === 0 ? `- ${member.displayName}` : `- ${member.displayName}: ${traits.join('、')}`
}

/**
 * コンセプトの上限（字）。脚本の全文が入ることがあり、長すぎるとモデルの上限で**末尾が切られる**。
 * 切られて困るもの（制作者の指示・避けること）は先に置き、コンセプトは縮めて最後に置く。
 */
export const KEY_ART_CONCEPT_MAX_LENGTH = 600

const capped = (value: string, max: number): string => {
  const chars = [...value.trim()]
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}…`
}

export const compileKeyArtPrompt = (input: KeyArtPromptInput): string =>
  [
    `これは作品「${input.project.name}」の YouTube サムネイルの主役の絵（key visual）。横長 16:9 の 1 枚。`,
    // 制作者が言ったことと避けることを先に。後ろほどモデルの上限で切られやすい。
    ...section('制作者の指示（いちばん優先する）', input.instruction ?? ''),
    ...section('避けること', input.project.avoid),
    '',
    '描き方:',
    '- 人物の顔を大きく、表情がはっきり分かるように描く',
    '- 強いコントラストと鮮やかな色で、小さく表示されても目を引く絵にする',
    '- 画面の左 3 分の 1 は大きな題名を置くための余白にする（人物と主な被写体は中央から右に置く）',
    '- 文字・ロゴ・字幕・署名・枠は描かない（題名は後から載せる）',
    ...(input.cast.length === 0
      ? []
      : ['', '登場人物（参照の画像の人物と同じ顔・髪型・服装で描く）:', ...input.cast.map(castLine)]),
    ...section('画風・光・質感', input.project.styleGuide),
    ...section('作品のコンセプト（抜粋）', capped(input.concept, KEY_ART_CONCEPT_MAX_LENGTH)),
  ].join('\n')

/** 顔が分かる画像ほど先に使う（サムネイルは顔が主役）。四面図は全身が小さいので後ろ。 */
const ROLE_ORDER: Readonly<Record<IdentityImageRole, number>> = {
  face_front: 0,
  face_three_quarter: 1,
  profile: 2,
  face_side: 3,
  full_body: 4,
  four_view: 5,
}

const bestIdentityImage = (images: readonly CharacterIdentityImage[]): CharacterIdentityImage | null =>
  [...images].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || Number(b.isPrimary) - Number(a.isPrimary) || a.order - b.order,
  )[0] ?? null

/**
 * 参照に添える画像。**人物 1 人につき 1 枚**（顔が分かるもの）を登場順に、余れば作品の手本画像で埋める。
 * モデルの上限（Codex 4 枚・klein 2 枚）を超えない。同じ素材は 2 度入れない。
 */
export const pickKeyArtReferences = (input: {
  readonly cast: readonly { readonly identityImages: readonly CharacterIdentityImage[] }[]
  readonly styleReferenceIds: readonly MediaAssetId[]
  readonly maxReferences: number
}): readonly MediaAssetId[] => {
  const faces = input.cast.flatMap((member) => {
    const image = bestIdentityImage(member.identityImages)
    return image === null ? [] : [image.mediaAssetId]
  })
  return [...new Set([...faces, ...input.styleReferenceIds])].slice(0, Math.max(0, input.maxReferences))
}
