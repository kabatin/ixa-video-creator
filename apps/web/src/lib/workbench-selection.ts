import type {
  BrandAssetId,
  CharacterId,
  CharacterLookId,
  LocationId,
  MediaAssetId,
  MusicTrackId,
  ProjectId,
  ShotId,
  TimelineClipId,
  VoiceProfileId,
} from '@ixa/domain'

/**
 * インスペクターが見ている物（UI-WORKBENCH-2 §2 P1 / §5）。**React を含まない。**
 * Shot 専用ではなく、選んだ物の種類で右の中身が変わる。
 */
export type Inspected =
  | { readonly kind: 'shot'; readonly id: ShotId }
  | { readonly kind: 'character'; readonly id: CharacterId }
  | { readonly kind: 'look'; readonly id: CharacterLookId; readonly characterId: CharacterId }
  | { readonly kind: 'location'; readonly id: LocationId }
  | { readonly kind: 'brand-asset'; readonly id: BrandAssetId }
  | { readonly kind: 'track'; readonly id: MusicTrackId }
  /** テロップ（ADR-0028）。見た目・位置・フェードとスタイルを直す。 */
  | {
      readonly kind: 'text-clip'
      readonly id: TimelineClipId
      /** 開いたら文字の欄にフォーカスする（「＋テロップ」で置いた直後。すぐ打てるように）。 */
      readonly focusText?: boolean
    }
  /** 作品の方針（ADR-0030）。作品全体のコンセプト・ルック・手本画像・避けたいもの。 */
  | { readonly kind: 'project'; readonly id: ProjectId }
  /** 声（ADR-0038）。ナレーター・キャラクターの声。素材ビューアでは一文を読ませて聴く。 */
  | { readonly kind: 'voice'; readonly id: VoiceProfileId }
  /** 効果音のクリップ（ADR-0039）。位置・音量を直す。 */
  | { readonly kind: 'audio-clip'; readonly id: TimelineClipId }
  /** エフェクトのクリップ（ADR-0050）。型・強さ・位置・長さを直す。 */
  | { readonly kind: 'effect-clip'; readonly id: TimelineClipId }
  /** 効果音の素材（音 1 本。ADR-0052）。素材ツリーで選び、素材ビューアで聴く。置いたクリップを直すのは `audio-clip`。 */
  | { readonly kind: 'sfx'; readonly id: MediaAssetId }

export type InspectedKind = Inspected['kind']

/** 素材（Shot・テロップ・効果音とエフェクトのクリップ・作品の方針以外）か。素材ビューアに出せるのはこちら。 */
export const isAssetSelection = (
  selection: Inspected | null,
): selection is Exclude<Inspected, { kind: 'shot' | 'text-clip' | 'audio-clip' | 'effect-clip' | 'project' }> =>
  selection !== null &&
  selection.kind !== 'shot' &&
  selection.kind !== 'text-clip' &&
  selection.kind !== 'audio-clip' &&
  selection.kind !== 'effect-clip' &&
  selection.kind !== 'project'

export const sameSelection = (a: Inspected | null, b: Inspected | null): boolean =>
  a !== null && b !== null && a.kind === b.kind && a.id === b.id

export const INSPECTED_LABELS: Readonly<Record<InspectedKind, string>> = Object.freeze({
  shot: 'Shot',
  character: 'キャラクター',
  look: 'Look',
  location: 'ロケーション',
  'brand-asset': 'ブランド資産',
  track: '楽曲',
  'text-clip': 'テロップ',
  project: '作品の方針',
  voice: '声',
  'audio-clip': '効果音',
  'effect-clip': 'エフェクト',
  sfx: '効果音',
})
